using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.Extensions.Logging.Abstractions;

namespace ForgeDB.API.Services;

public class DeploymentService : IDeploymentService
{
    private const int MaxErrorMessageLength = 2000;

    private readonly IDeploymentRepository _deploymentRepository;
    private readonly IDesignRepository _designRepository;
    private readonly IDesignService _designService;
    private readonly ICleaningRepository _cleaningRepository;
    private readonly ILogger<DeploymentService> _logger;

    public DeploymentService(
        IDeploymentRepository deploymentRepository,
        IDesignRepository designRepository,
        IDesignService designService,
        ICleaningRepository cleaningRepository,
        ILogger<DeploymentService>? logger = null)
    {
        _deploymentRepository = deploymentRepository;
        _designRepository = designRepository;
        _designService = designService;
        _cleaningRepository = cleaningRepository;
        _logger = logger ?? NullLogger<DeploymentService>.Instance;
    }

    public async Task<DeploymentResponseDto> DeployAsync(int projectId, int userId, int ifMatchRevision, CancellationToken cancellationToken = default)
    {
        if (await _deploymentRepository.GetOwnedProjectAsync(projectId, userId, cancellationToken) is null)
        {
            throw new UnauthorizedAccessException("The project does not exist or does not belong to the authenticated user.");
        }

        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken)
            ?? throw new KeyNotFoundException("Generate a schema design before deploying.");

        if (design.Revision != ifMatchRevision)
        {
            throw new DesignConcurrencyException(design.Revision);
        }

        if (design.Tables.Count == 0)
        {
            throw new InvalidOperationException("The design has no tables to deploy.");
        }

        if (design.Status != DesignStatus.Valid || design.ValidatedAt is null)
        {
            throw new InvalidOperationException("Validate and approve the final schema before deploying.");
        }

        if (!await _cleaningRepository.IsSchemaReadyAsync(projectId, cancellationToken))
        {
            throw new InvalidOperationException("No finalized cleaned dataset is approved for this schema. Confirm data quality again before deploying.");
        }

        var artifacts = await _designService.PrepareExportArtifactsAsync(projectId, cancellationToken)
            ?? throw new KeyNotFoundException("Generate a schema design before deploying.");

        var errorIssues = artifacts.ValidationIssues.Where(issue => issue.Severity == "error").ToList();
        if (errorIssues.Count > 0)
        {
            throw new DesignValidationFailedException(artifacts.ValidationIssues);
        }

        var schemaName = DeploymentPlanBuilder.BuildSchemaName(projectId);
        var orderedTables = DeploymentPlanBuilder.OrderTablesForInsertion(design.Tables.ToList(), design.Relationships.ToList());
        var insertPlans = await BuildInsertPlansAsync(projectId, orderedTables, cancellationToken);
        var sqlArtifacts = PostgreSqlDeploymentSqlGenerator.Generate(schemaName, artifacts.Sql, insertPlans, design.Relationships.ToList());
        var plannedRows = insertPlans.Sum(plan => plan.Rows.Count);
        var deployment = await _deploymentRepository.AddRunningAsync(new Deployment
        {
            ProjectId = projectId,
            DesignRevision = design.Revision,
            SchemaName = schemaName,
            Status = DeploymentStatus.Running,
            GeneratedSql = sqlArtifacts.SchemaSql,
            SeedSql = sqlArtifacts.SeedSql,
            DeploySql = sqlArtifacts.DeploySql,
            TriggeredByUserId = userId,
            StartedAt = DateTime.UtcNow,
        }, cancellationToken);

        try
        {
            _logger.LogInformation(
                "Starting deployment {DeploymentId} for project {ProjectId}: {TableCount} tables and {RowCount} finalized rows.",
                deployment.Id, projectId, orderedTables.Count, plannedRows);
            var rowCounts = await _deploymentRepository.ExecuteDeploymentTransactionAsync(
                schemaName,
                sqlArtifacts.PreSeedDdlSql,
                insertPlans,
                sqlArtifacts.PostSeedDdlSql,
                cancellationToken);
            var createdTables = orderedTables.Select(table => table.Name).ToList();

            await _deploymentRepository.MarkSucceededAsync(
                deployment.Id,
                rowCounts,
                createdTables,
                design.Relationships.Count,
                cancellationToken);
            _logger.LogInformation("Completed deployment {DeploymentId} for project {ProjectId}.", deployment.Id, projectId);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The deployment transaction has already rolled back at this point (or never opened
            // one), so this failure is a real, displayable outcome rather than an HTTP error —
            // persist it and let the caller render a failed deployment card with details.
            _logger.LogError(exception, "Deployment {DeploymentId} failed for project {ProjectId}; the database transaction was rolled back.", deployment.Id, projectId);
            await _deploymentRepository.MarkFailedAsync(deployment.Id, Truncate(exception.Message), plannedRows, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            await _deploymentRepository.MarkFailedAsync(
                deployment.Id,
                "Deployment was cancelled and rolled back.",
                plannedRows,
                CancellationToken.None);
            throw;
        }

        return await GetAsync(projectId, deployment.Id, cancellationToken)
            ?? throw new InvalidOperationException("Deployment record could not be reloaded.");
    }

    public async Task<IReadOnlyList<DeploymentResponseDto>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var deployments = await _deploymentRepository.GetHistoryAsync(projectId, cancellationToken);
        return deployments.Select(MapToResponse).ToList();
    }

    public async Task<DeploymentResponseDto?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var deployment = await _deploymentRepository.GetLatestAsync(projectId, cancellationToken);
        return deployment is null ? null : MapToResponse(deployment);
    }

    public async Task<DeploymentResponseDto?> GetAsync(int projectId, int deploymentId, CancellationToken cancellationToken = default)
    {
        var deployment = await _deploymentRepository.GetAsync(projectId, deploymentId, cancellationToken);
        return deployment is null ? null : MapToResponse(deployment);
    }

    public async Task<DeploymentSqlFileDto?> GetSqlFileAsync(
        int projectId,
        int deploymentId,
        string fileName,
        CancellationToken cancellationToken = default)
    {
        var deployment = await _deploymentRepository.GetAsync(projectId, deploymentId, cancellationToken);
        if (deployment is null) return null;

        var normalized = fileName.Trim().ToLowerInvariant();
        var content = normalized switch
        {
            "schema.sql" => deployment.GeneratedSql,
            "seed.sql" => deployment.SeedSql,
            "deploy.sql" => deployment.DeploySql,
            _ => throw new ArgumentException("SQL file must be schema.sql, seed.sql, or deploy.sql.", nameof(fileName))
        };

        return string.IsNullOrWhiteSpace(content) ? null : new DeploymentSqlFileDto(normalized, content);
    }

    private async Task<List<TableInsertPlan>> BuildInsertPlansAsync(
        int projectId,
        IReadOnlyList<DesignTable> orderedTables,
        CancellationToken cancellationToken)
    {
        var plans = new List<TableInsertPlan>();
        var state = await _cleaningRepository.GetStateAsync(projectId, cancellationToken)
            ?? throw new InvalidOperationException("No finalized cleaned dataset is approved for this project.");
        var confirmedVersions = string.IsNullOrWhiteSpace(state.ConfirmedVersionsJson)
            ? new Dictionary<int, int>()
            : JsonSerializer.Deserialize<Dictionary<int, int>>(state.ConfirmedVersionsJson)
                ?? new Dictionary<int, int>();
        var activeVersions = (await _cleaningRepository.GetActiveProjectVersionsAsync(projectId, cancellationToken))
            .ToDictionary(item => item.Dataset.Id, item => item.Version.Id);

        var sourcedTables = orderedTables.Where(table => table.SourceDatasetId.HasValue).ToList();
        if (sourcedTables.GroupBy(table => table.SourceDatasetId!.Value).Any(group => group.Count() != 1)
            || confirmedVersions.Keys.Any(datasetId => sourcedTables.All(table => table.SourceDatasetId != datasetId)))
        {
            throw new InvalidOperationException("The finalized dataset-to-table mappings are incomplete or ambiguous.");
        }

        foreach (var table in orderedTables)
        {
            if (table.SourceDatasetId is null && table.SourceDatasetVersionId is null)
            {
                if (table.Origin == DesignOrigin.Generated)
                {
                    throw new InvalidOperationException($"Generated table '{table.Name}' is missing its finalized dataset mapping.");
                }

                plans.Add(new TableInsertPlan(table.Name, Array.Empty<string>(), Array.Empty<string>(), Array.Empty<object[]>()));
                continue;
            }

            if (table.SourceDatasetId is null || table.SourceDatasetVersionId is null)
            {
                throw new InvalidOperationException($"Table '{table.Name}' has an incomplete finalized dataset mapping.");
            }

            if (!confirmedVersions.TryGetValue(table.SourceDatasetId.Value, out var confirmedVersionId)
                || confirmedVersionId != table.SourceDatasetVersionId.Value)
            {
                throw new InvalidOperationException($"Table '{table.Name}' is not mapped to the approved finalized dataset version.");
            }
            if (!activeVersions.TryGetValue(table.SourceDatasetId.Value, out var activeVersionId)
                || activeVersionId != table.SourceDatasetVersionId.Value)
            {
                throw new InvalidOperationException($"Table '{table.Name}' is mapped to a stale dataset version. Regenerate the schema from the active version.");
            }

            var version = await _cleaningRepository.GetVersionAsync(table.SourceDatasetId.Value, table.SourceDatasetVersionId.Value, cancellationToken);
            if (version is null || version.IsRawOriginal)
            {
                throw new InvalidOperationException($"Table '{table.Name}' has no finalized cleaned dataset. Raw uploaded data cannot be deployed.");
            }

            if (version.AnalyzedAt is null)
            {
                throw new InvalidOperationException($"The active cleaned dataset for table '{table.Name}' must be re-analyzed before deployment.");
            }

            var rows = CleaningSnapshotSerializer.DeserializeRows(version.RowsJson);
            var sourceColumns = CleaningSnapshotSerializer.DeserializeColumns(version.ColumnsJson)
                .Select(column => column.Name)
                .ToHashSet(StringComparer.Ordinal);
            var mappedColumns = table.Columns
                .Where(column => !string.IsNullOrWhiteSpace(column.SourceColumnName))
                .OrderBy(column => column.Ordinal)
                .ToList();

            var mappedSourceNames = mappedColumns.Select(column => column.SourceColumnName!).ToList();
            if (mappedSourceNames.Count != mappedSourceNames.Distinct(StringComparer.Ordinal).Count()
                || mappedSourceNames.Any(name => !sourceColumns.Contains(name))
                || sourceColumns.Any(name => !mappedSourceNames.Contains(name, StringComparer.Ordinal)))
            {
                throw new InvalidOperationException($"Table '{table.Name}' does not completely map its finalized cleaned columns.");
            }

            var columnNames = mappedColumns.Select(column => column.Name).ToList();
            var columnSqlTypes = mappedColumns.Select(column => column.SqlType).ToList();
            var rowValues = rows
                .Select((row, rowIndex) => mappedColumns
                    .Select(column => ConvertFinalizedValue(row, rowIndex, table, column))
                    .ToArray())
                .ToList();

            plans.Add(new TableInsertPlan(table.Name, columnNames, columnSqlTypes, rowValues)
            {
                IdentityColumnNames = mappedColumns
                    .Where(column => column.IsAutoIncrement)
                    .Select(column => column.Name)
                    .ToList()
            });
        }

        return plans;
    }

    private static object ConvertFinalizedValue(
        IReadOnlyDictionary<string, object?> row,
        int rowIndex,
        DesignTable table,
        DesignColumn column)
    {
        if (!row.TryGetValue(column.SourceColumnName!, out var raw))
        {
            throw new InvalidOperationException(
                $"Finalized row {rowIndex + 1} for table '{table.Name}' is missing mapped column '{column.SourceColumnName}'.");
        }

        try
        {
            return DeploymentPlanBuilder.ConvertValue(raw, column.SqlType);
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException(
                $"Finalized row {rowIndex + 1}, column '{column.Name}' in table '{table.Name}' cannot be converted to {column.SqlType}.",
                exception);
        }
    }

    private static string Truncate(string value) =>
        value.Length <= MaxErrorMessageLength ? value : value[..MaxErrorMessageLength] + "...";

    private static DeploymentResponseDto MapToResponse(Deployment deployment) => new()
    {
        DeploymentId = deployment.Id,
        Id = deployment.Id,
        ProjectId = deployment.ProjectId,
        DesignRevision = deployment.DesignRevision,
        SchemaName = deployment.SchemaName,
        Status = deployment.Status,
        GeneratedSql = deployment.GeneratedSql,
        ErrorMessage = deployment.ErrorMessage,
        CreatedTables = JsonSerializer.Deserialize<List<string>>(deployment.CreatedTablesJson) ?? new(),
        InsertedRowCounts = JsonSerializer.Deserialize<Dictionary<string, int>>(deployment.InsertedRowCountsJson) ?? new(),
        TablesCreated = deployment.TablesCreated,
        RowsSeeded = deployment.TotalRowsInserted,
        TotalRowsInserted = deployment.TotalRowsInserted,
        RelationshipsCreated = deployment.RelationshipsCreated,
        FailedRows = deployment.FailedRows,
        SchemaSqlAvailable = !string.IsNullOrWhiteSpace(deployment.GeneratedSql),
        SeedSqlAvailable = !string.IsNullOrWhiteSpace(deployment.SeedSql),
        DeploySqlAvailable = !string.IsNullOrWhiteSpace(deployment.DeploySql),
        StartedAt = deployment.StartedAt,
        CompletedAt = deployment.CompletedAt,
    };
}
