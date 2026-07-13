using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DeploymentService : IDeploymentService
{
    private const int MaxErrorMessageLength = 2000;

    private readonly IDeploymentRepository _deploymentRepository;
    private readonly IDesignRepository _designRepository;
    private readonly IDesignService _designService;
    private readonly ICleaningRepository _cleaningRepository;

    public DeploymentService(
        IDeploymentRepository deploymentRepository,
        IDesignRepository designRepository,
        IDesignService designService,
        ICleaningRepository cleaningRepository)
    {
        _deploymentRepository = deploymentRepository;
        _designRepository = designRepository;
        _designService = designService;
        _cleaningRepository = cleaningRepository;
    }

    public async Task<DeploymentResponseDto> DeployAsync(int projectId, int userId, int ifMatchRevision, CancellationToken cancellationToken = default)
    {
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

        var artifacts = await _designService.PrepareExportArtifactsAsync(projectId, cancellationToken)
            ?? throw new KeyNotFoundException("Generate a schema design before deploying.");

        var errorIssues = artifacts.ValidationIssues.Where(issue => issue.Severity == "error").ToList();
        if (errorIssues.Count > 0)
        {
            throw new DesignValidationFailedException(artifacts.ValidationIssues);
        }

        var schemaName = DeploymentPlanBuilder.BuildSchemaName(projectId);
        var deployment = await _deploymentRepository.AddRunningAsync(new Deployment
        {
            ProjectId = projectId,
            DesignRevision = design.Revision,
            SchemaName = schemaName,
            Status = DeploymentStatus.Running,
            GeneratedSql = artifacts.Sql,
            TriggeredByUserId = userId,
            StartedAt = DateTime.UtcNow,
        }, cancellationToken);

        try
        {
            var orderedTables = DeploymentPlanBuilder.OrderTablesForInsertion(design.Tables.ToList(), design.Relationships.ToList());
            var insertPlans = await BuildInsertPlansAsync(orderedTables, cancellationToken);
            var ddlSql = DeploymentPlanBuilder.StripTransactionWrapper(artifacts.Sql);

            var rowCounts = await _deploymentRepository.ExecuteDeploymentTransactionAsync(schemaName, ddlSql, insertPlans, cancellationToken);
            var createdTables = orderedTables.Select(table => table.Name).ToList();

            await _deploymentRepository.MarkSucceededAsync(deployment.Id, rowCounts, createdTables, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The deployment transaction has already rolled back at this point (or never opened
            // one), so this failure is a real, displayable outcome rather than an HTTP error —
            // persist it and let the caller render a failed deployment card with details.
            await _deploymentRepository.MarkFailedAsync(deployment.Id, Truncate(exception.Message), cancellationToken);
        }

        return await GetLatestAsync(projectId, cancellationToken)
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

    private async Task<List<TableInsertPlan>> BuildInsertPlansAsync(IReadOnlyList<DesignTable> orderedTables, CancellationToken cancellationToken)
    {
        var plans = new List<TableInsertPlan>();

        foreach (var table in orderedTables)
        {
            if (table.SourceDatasetId is null || table.SourceDatasetVersionId is null)
            {
                plans.Add(new TableInsertPlan(table.Name, Array.Empty<string>(), Array.Empty<object[]>()));
                continue;
            }

            var version = await _cleaningRepository.GetVersionAsync(table.SourceDatasetId.Value, table.SourceDatasetVersionId.Value, cancellationToken);
            if (version is null)
            {
                plans.Add(new TableInsertPlan(table.Name, Array.Empty<string>(), Array.Empty<object[]>()));
                continue;
            }

            var rows = CleaningSnapshotSerializer.DeserializeRows(version.RowsJson);
            var insertableColumns = table.Columns
                .Where(column => !column.IsAutoIncrement)
                .OrderBy(column => column.Ordinal)
                .ToList();

            var columnNames = insertableColumns.Select(column => column.Name).ToList();
            var rowValues = rows
                .Select(row => insertableColumns
                    .Select(column => DeploymentPlanBuilder.ConvertValue(
                        row.GetValueOrDefault(column.SourceColumnName ?? column.Name),
                        column.SqlType))
                    .ToArray())
                .ToList();

            plans.Add(new TableInsertPlan(table.Name, columnNames, rowValues));
        }

        return plans;
    }

    private static string Truncate(string value) =>
        value.Length <= MaxErrorMessageLength ? value : value[..MaxErrorMessageLength] + "...";

    private static DeploymentResponseDto MapToResponse(Deployment deployment) => new()
    {
        Id = deployment.Id,
        ProjectId = deployment.ProjectId,
        DesignRevision = deployment.DesignRevision,
        SchemaName = deployment.SchemaName,
        Status = deployment.Status,
        GeneratedSql = deployment.GeneratedSql,
        ErrorMessage = deployment.ErrorMessage,
        CreatedTables = JsonSerializer.Deserialize<List<string>>(deployment.CreatedTablesJson) ?? new(),
        InsertedRowCounts = JsonSerializer.Deserialize<Dictionary<string, int>>(deployment.InsertedRowCountsJson) ?? new(),
        TotalRowsInserted = deployment.TotalRowsInserted,
        StartedAt = deployment.StartedAt,
        CompletedAt = deployment.CompletedAt,
    };
}
