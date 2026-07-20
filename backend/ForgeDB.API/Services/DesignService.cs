using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Interfaces;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Services;

public class DesignService : IDesignService
{
    private readonly IDesignRepository _designRepository;
    private readonly IDatasetRepository _datasetRepository;
    private readonly IDesignSchemaGeneratorResolver _generatorResolver;
    private readonly IDesignValidationService _validationService;
    private readonly ICleaningRepository? _cleaningRepository;
    private readonly IProjectWorkflowService? _workflowService;

    public DesignService(
        IDesignRepository designRepository,
        IDatasetRepository datasetRepository,
        IDesignSchemaGeneratorResolver generatorResolver,
        IDesignValidationService validationService,
        ICleaningRepository? cleaningRepository = null,
        IProjectWorkflowService? workflowService = null)
    {
        _designRepository = designRepository;
        _datasetRepository = datasetRepository;
        _generatorResolver = generatorResolver;
        _validationService = validationService;
        _cleaningRepository = cleaningRepository;
        _workflowService = workflowService;
    }

    public async Task<DesignResponseDto?> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        return design is null ? null : BuildResponse(design);
    }

    public async Task<DesignResponseDto?> GetSchemaWorkspaceAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        return design is null ? null : await BuildSchemaResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> GenerateSchemaAsync(
        int projectId,
        int userId,
        int? ifMatchRevision,
        CancellationToken cancellationToken = default)
    {
        var cleaning = RequireCleaningRepository();
        await EnsureSchemaGenerationAllowedAsync(projectId, cleaning, cancellationToken);

        var activeVersions = await cleaning.GetActiveProjectVersionsAsync(projectId, cancellationToken);
        var sourceVersions = activeVersions
            .ToDictionary(item => item.Dataset.Id, item => item.Version.Id);
        var datasets = (await _datasetRepository.GetByProjectIdWithColumnsAsync(projectId, cancellationToken)).ToList();

        if (datasets.Count == 0)
        {
            throw new InvalidOperationException("No confirmed datasets are available for schema generation.");
        }
        if (datasets.Count != sourceVersions.Count
            || datasets.Any(dataset => dataset.ActiveVersionId is null
                || sourceVersions.GetValueOrDefault(dataset.Id) != dataset.ActiveVersionId.Value))
        {
            throw new InvalidOperationException("Active dataset versions changed before schema generation. Confirm data quality and try again.");
        }

        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: true, cancellationToken);
        var now = DateTime.UtcNow;
        if (design is null)
        {
            design = new DesignModel
            {
                ProjectId = projectId,
                Revision = 1,
                CreatedAt = now,
                UpdatedAt = now
            };
        }
        else
        {
            if (ifMatchRevision is null) throw new DesignPreconditionRequiredException();
            CheckRevision(design, ifMatchRevision.Value);
            design.Relationships.Clear();
            design.Tables.Clear();
            design.Revision += 1;
            design.UpdatedAt = now;
        }

        ApplyGeneration(design, datasets, sourceVersions);
        design.Status = DesignStatus.Draft;
        design.GeneratedAt = now;
        design.ValidatedAt = null;
        design.LastModifiedByUserId = userId;
        design.SourceVersionsJson = JsonSerializer.Serialize(sourceVersions);

        if (design.Id == 0)
        {
            await _designRepository.AddAsync(design, cancellationToken);
        }
        else
        {
            await _designRepository.SaveChangesAsync(cancellationToken);
        }

        var reloaded = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken)
            ?? throw new InvalidOperationException("Generated schema could not be reloaded.");
        return await BuildSchemaResponseAsync(reloaded, cancellationToken);
    }

    public async Task<DesignResponseDto> SaveSchemaDraftAsync(
        int projectId,
        int userId,
        int ifMatchRevision,
        SaveDesignDraftRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ValidateRenameWhitelist(request);
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: true, cancellationToken)
            ?? throw new KeyNotFoundException("Schema draft not found.");
        CheckRevision(design, ifMatchRevision);

        foreach (var rename in request.Tables)
        {
            var table = design.Tables.FirstOrDefault(item => item.Id == rename.Id)
                ?? throw new ArgumentException($"Table {rename.Id} does not belong to this schema.");
            table.Name = ValidateEditableIdentifier(rename.Name, "Table");
        }

        foreach (var rename in request.Columns)
        {
            var column = design.Tables.SelectMany(table => table.Columns).FirstOrDefault(item => item.Id == rename.Id)
                ?? throw new ArgumentException($"Column {rename.Id} does not belong to this schema.");
            column.Name = ValidateEditableIdentifier(rename.Name, "Column");

            if (!SchemaColumnRules.TryNormalizeSqlType(rename.DataType, out var normalizedType))
            {
                throw new ArgumentException($"Column '{column.Name}' uses unsupported PostgreSQL type '{rename.DataType}'.");
            }
            if (rename.IsPrimaryKey && rename.IsNullable)
            {
                throw new ArgumentException($"Primary-key column '{column.Name}' cannot be nullable.");
            }
            if (rename.IsAutoIncrement && !SchemaColumnRules.IsIdentityCompatible(normalizedType))
            {
                throw new ArgumentException($"Auto Increment for column '{column.Name}' requires SMALLINT, INTEGER, or BIGINT.");
            }
            if (rename.IsAutoIncrement && rename.IsNullable)
            {
                throw new ArgumentException($"Auto Increment column '{column.Name}' must be NOT NULL.");
            }
            if (rename.IsAutoIncrement && !string.IsNullOrWhiteSpace(rename.DefaultValue))
            {
                throw new ArgumentException($"Auto Increment column '{column.Name}' cannot also define a default value.");
            }
            if (!SchemaColumnRules.TryNormalizeDefault(rename.DefaultValue, normalizedType, out var normalizedDefault, out var defaultError))
            {
                throw new ArgumentException($"Column '{column.Name}' has an invalid default value. {defaultError}");
            }

            column.SqlType = normalizedType;
            column.IsNullable = rename.IsNullable;
            column.IsPrimaryKey = rename.IsPrimaryKey;
            column.IsUnique = !rename.IsPrimaryKey && rename.IsUnique;
            column.DefaultValue = normalizedDefault;
            column.IsAutoIncrement = rename.IsAutoIncrement;
        }

        EnsureUniqueNames(design);
        design.Status = DesignStatus.Draft;
        design.ValidatedAt = null;
        design.LastModifiedByUserId = userId;
        await SaveAndBuildResponseAsync(design, cancellationToken);
        return await GetSchemaWorkspaceAsync(projectId, cancellationToken)
            ?? throw new InvalidOperationException("Saved schema draft could not be reloaded.");
    }

    public async Task<DesignResponseDto> ValidateSchemaAsync(
        int projectId,
        int userId,
        int ifMatchRevision,
        CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: true, cancellationToken)
            ?? throw new KeyNotFoundException("Schema draft not found.");
        CheckRevision(design, ifMatchRevision);
        var stale = await IsStaleAsync(design, cancellationToken);
        var issues = BuildValidationIssues(design, stale);
        design.Status = issues.Any(issue => issue.Severity == ValidationSeverity.Error)
            ? DesignStatus.Invalid
            : DesignStatus.Valid;
        design.ValidatedAt = DateTime.UtcNow;
        design.LastModifiedByUserId = userId;
        await SaveAndBuildResponseAsync(design, cancellationToken, preserveValidationStatus: true);
        return await GetSchemaWorkspaceAsync(projectId, cancellationToken)
            ?? throw new InvalidOperationException("Validated schema could not be reloaded.");
    }

    public async Task<SchemaSqlPreviewDto> GetSchemaSqlAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken)
            ?? throw new KeyNotFoundException("Schema draft not found.");
        return new SchemaSqlPreviewDto
        {
            DesignId = design.Id,
            Revision = design.Revision,
            Sql = _generatorResolver.Generate("sql", BuildSnapshot(design))
        };
    }

    public async Task<DesignResponseDto> GenerateAsync(int projectId, GenerateDesignRequestDto request, int? ifMatchRevision, CancellationToken cancellationToken = default)
    {
        var mode = NormalizeMode(request.Mode);

        if (!await _datasetRepository.ProjectExistsAsync(projectId, cancellationToken))
        {
            throw new KeyNotFoundException("Project not found.");
        }

        if (_workflowService is not null)
        {
            await _workflowService.EnsureCanBuildSchemaAsync(projectId, cancellationToken);
        }
        else if (_cleaningRepository is not null && !await _cleaningRepository.IsSchemaReadyAsync(projectId, cancellationToken))
        {
            throw new InvalidOperationException("Confirm the cleaned, re-analyzed dataset versions before generating a schema.");
        }

        var datasets = await _datasetRepository.GetByProjectIdWithColumnsAsync(projectId, cancellationToken);
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: true, cancellationToken);

        if (design is null)
        {
            // Fresh create has nothing to compare a revision against, so it is the one generate
            // case allowed with no precondition at all (prompt FIX 2 / decision D2). Any If-Match
            // header the caller sent is ignored.
            var now = DateTime.UtcNow;
            design = new DesignModel
            {
                ProjectId = projectId,
                Revision = 1,
                CreatedAt = now,
                UpdatedAt = now
            };

            ApplyGeneration(design, datasets);
            await _designRepository.AddAsync(design, cancellationToken);

            var reloaded = await _designRepository.GetFullByIdAsync(design.Id, track: false, cancellationToken)
                ?? throw new InvalidOperationException("Design model was created but could not be reloaded.");
            return BuildResponse(reloaded);
        }

        // A DesignModel already exists: regenerating over it is a mutation like any other and
        // requires If-Match, for both merge and replace modes (prompt FIX 2 / decision D2).
        if (ifMatchRevision is null)
        {
            throw new DesignPreconditionRequiredException();
        }

        CheckRevision(design, ifMatchRevision.Value);

        if (mode == "replace")
        {
            ReplaceGeneratedEntities(design);
        }

        ApplyGeneration(design, datasets);

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<string> PreviewAsync(int designId, string format, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByIdAsync(designId, track: false, cancellationToken)
            ?? throw new KeyNotFoundException("Design not found.");

        var snapshot = BuildSnapshot(design);
        return _generatorResolver.Generate(format, snapshot);
    }

    public async Task<List<ValidationIssueDto>> GetValidationAsync(int designId, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByIdAsync(designId, track: false, cancellationToken)
            ?? throw new KeyNotFoundException("Design not found.");

        return _validationService.Validate(BuildSnapshot(design)).Select(MapIssue).ToList();
    }

    public async Task<DesignExportArtifacts?> PrepareExportArtifactsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        if (_workflowService is not null)
        {
            await _workflowService.EnsureCanExportAsync(projectId, cancellationToken);
        }
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        if (design is null)
        {
            return null;
        }

        var snapshot = BuildSnapshot(design);
        var stale = await IsStaleAsync(design, cancellationToken);
        var issues = BuildValidationIssues(design, stale).Select(MapIssue).ToList();

        return new DesignExportArtifacts
        {
            DesignId = design.Id,
            Revision = design.Revision,
            ValidationIssues = issues,
            Relationships = design.Relationships.OrderBy(relationship => relationship.Id).Select(MapRelationship).ToList(),
            Sql = _generatorResolver.Generate("sql", snapshot),
            Dbml = _generatorResolver.Generate("dbml", snapshot),
            Json = _generatorResolver.Generate("json", snapshot)
        };
    }

    public async Task<DesignResponseDto> CreateTableAsync(int designId, int ifMatchRevision, CreateDesignTableRequestDto request, CancellationToken cancellationToken = default)
    {
        var name = ValidateEditableIdentifier(request.Name, "Table");

        var design = await LoadTrackedAsync(designId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        design.Tables.Add(new DesignTable
        {
            DesignModelId = design.Id,
            Name = name,
            Comment = NormalizeOptional(request.Comment),
            Origin = DesignOrigin.User
        });

        EnsureUniqueNames(design);
        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> UpdateTableAsync(int tableId, int ifMatchRevision, UpdateDesignTableRequestDto request, CancellationToken cancellationToken = default)
    {
        var name = ValidateEditableIdentifier(request.Name, "Table");

        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        table.Name = name;
        table.Comment = NormalizeOptional(request.Comment);
        table.Origin = DesignOrigin.User;

        EnsureUniqueNames(design);
        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> DeleteTableAsync(int tableId, int ifMatchRevision, CancellationToken cancellationToken = default)
    {
        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        var columnIds = table.Columns.Select(column => column.Id).ToHashSet();
        RemoveRelationshipsTouchingColumns(design, columnIds);
        design.Tables.Remove(table);

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> CreateColumnAsync(int tableId, int ifMatchRevision, CreateDesignColumnRequestDto request, CancellationToken cancellationToken = default)
    {
        var name = ValidateEditableIdentifier(request.Name, "Column");
        if (!SchemaColumnRules.TryNormalizeSqlType(request.SqlType, out var normalizedType))
        {
            throw new ArgumentException($"Column '{name}' uses unsupported PostgreSQL type '{request.SqlType}'.");
        }
        if (request.IsPrimaryKey && request.IsNullable)
        {
            throw new ArgumentException($"Primary-key column '{name}' cannot be nullable.");
        }

        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        table.Columns.Add(new DesignColumn
        {
            DesignTableId = table.Id,
            Name = name,
            SqlType = normalizedType,
            IsNullable = request.IsNullable,
            IsPrimaryKey = request.IsPrimaryKey,
            IsUnique = !request.IsPrimaryKey && request.IsUnique,
            Ordinal = request.Ordinal,
            SourceColumnName = NormalizeOptional(request.SourceColumnName),
            Origin = DesignOrigin.User
        });

        EnsureUniqueNames(design);
        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> UpdateColumnAsync(int columnId, int ifMatchRevision, UpdateDesignColumnRequestDto request, CancellationToken cancellationToken = default)
    {
        var name = ValidateEditableIdentifier(request.Name, "Column");
        if (!SchemaColumnRules.TryNormalizeSqlType(request.SqlType, out var normalizedType))
        {
            throw new ArgumentException($"Column '{name}' uses unsupported PostgreSQL type '{request.SqlType}'.");
        }
        if (request.IsPrimaryKey && request.IsNullable)
        {
            throw new ArgumentException($"Primary-key column '{name}' cannot be nullable.");
        }

        var designModelId = await _designRepository.FindDesignModelIdByColumnIdAsync(columnId, cancellationToken)
            ?? throw new KeyNotFoundException("Design column not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var column = design.Tables.SelectMany(t => t.Columns).FirstOrDefault(c => c.Id == columnId)
            ?? throw new KeyNotFoundException("Design column not found.");

        column.Name = name;
        column.SqlType = normalizedType;
        column.IsNullable = request.IsNullable;
        column.IsPrimaryKey = request.IsPrimaryKey;
        column.IsUnique = !request.IsPrimaryKey && request.IsUnique;
        column.Ordinal = request.Ordinal;
        column.Origin = DesignOrigin.User;

        // The legacy request DTO has no DefaultValue/IsAutoIncrement fields, so a type change here
        // can strand a previously-set value that is no longer valid for the new type; re-validate
        // rather than leave stale, type-incompatible metadata behind.
        if (column.IsAutoIncrement && !SchemaColumnRules.IsIdentityCompatible(normalizedType))
        {
            column.IsAutoIncrement = false;
        }
        if (!string.IsNullOrWhiteSpace(column.DefaultValue))
        {
            column.DefaultValue = SchemaColumnRules.TryNormalizeDefault(column.DefaultValue, normalizedType, out var normalizedDefault, out _)
                ? normalizedDefault
                : null;
        }

        EnsureUniqueNames(design);
        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> DeleteColumnAsync(int columnId, int ifMatchRevision, CancellationToken cancellationToken = default)
    {
        var designModelId = await _designRepository.FindDesignModelIdByColumnIdAsync(columnId, cancellationToken)
            ?? throw new KeyNotFoundException("Design column not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Columns.Any(c => c.Id == columnId))
            ?? throw new KeyNotFoundException("Design column not found.");
        var column = table.Columns.First(c => c.Id == columnId);

        RemoveRelationshipsTouchingColumns(design, new HashSet<int> { columnId });
        table.Columns.Remove(column);

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> ReorderColumnsAsync(int tableId, int ifMatchRevision, ReorderDesignColumnsRequestDto request, CancellationToken cancellationToken = default)
    {
        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        var requestedIds = request.ColumnIds ?? new List<int>();
        var existingIds = table.Columns.Select(column => column.Id).ToHashSet();

        // "Set equality" means exactly the existing columns, each exactly once: the count check
        // catches a padded/short list (e.g. a duplicated id) that SetEquals alone would miss
        // because it only compares distinct elements.
        if (requestedIds.Count != existingIds.Count || !existingIds.SetEquals(requestedIds))
        {
            throw new ArgumentException("columnIds must contain exactly the existing columns of this table, each exactly once.");
        }

        for (var index = 0; index < requestedIds.Count; index++)
        {
            var column = table.Columns.First(c => c.Id == requestedIds[index]);
            column.Ordinal = index;
        }

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> CreateRelationshipAsync(int designId, int ifMatchRevision, CreateDesignRelationshipRequestDto request, CancellationToken cancellationToken = default)
    {
        ValidateCardinality(request.Cardinality);
        ValidateOnDelete(request.OnDelete);

        var design = await LoadTrackedAsync(designId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var fromColumn = design.Tables.SelectMany(t => t.Columns).FirstOrDefault(c => c.Id == request.FromColumnId)
            ?? throw new ArgumentException("fromColumnId does not reference a column in this design.");
        var toColumn = design.Tables.SelectMany(t => t.Columns).FirstOrDefault(c => c.Id == request.ToColumnId)
            ?? throw new ArgumentException("toColumnId does not reference a column in this design.");

        ValidateRelationshipEndpoints(fromColumn, toColumn);
        if (DesignRelationshipRules.IsDuplicate(design.Relationships, fromColumn.Id, toColumn.Id, request.Cardinality))
        {
            throw new DesignRelationshipConflictException("An identical relationship already exists in this design.");
        }

        design.Relationships.Add(new DesignRelationship
        {
            DesignModelId = design.Id,
            FromColumnId = fromColumn.Id,
            FromColumn = fromColumn,
            ToColumnId = toColumn.Id,
            ToColumn = toColumn,
            Cardinality = request.Cardinality,
            OnDelete = request.OnDelete,
            Origin = DesignOrigin.User
        });

        try
        {
            return await SaveAndBuildResponseAsync(design, cancellationToken);
        }
        catch (DbUpdateException exception) when (DesignRelationshipRules.IsUniqueConstraintViolation(exception))
        {
            throw new DesignRelationshipConflictException("An identical relationship was created concurrently. Refresh the design and try again.");
        }
    }

    public async Task<DesignResponseDto> UpdateRelationshipAsync(int relationshipId, int ifMatchRevision, UpdateDesignRelationshipRequestDto request, CancellationToken cancellationToken = default)
    {
        ValidateCardinality(request.Cardinality);
        ValidateOnDelete(request.OnDelete);

        var designModelId = await _designRepository.FindDesignModelIdByRelationshipIdAsync(relationshipId, cancellationToken)
            ?? throw new KeyNotFoundException("Design relationship not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var relationship = design.Relationships.FirstOrDefault(r => r.Id == relationshipId)
            ?? throw new KeyNotFoundException("Design relationship not found.");

        ValidateRelationshipEndpoints(relationship.FromColumn!, relationship.ToColumn!);
        if (DesignRelationshipRules.IsDuplicate(
            design.Relationships,
            relationship.FromColumnId,
            relationship.ToColumnId,
            request.Cardinality,
            relationship.Id))
        {
            throw new DesignRelationshipConflictException("Updating this relationship would create an identical relationship.");
        }

        relationship.Cardinality = request.Cardinality;
        relationship.OnDelete = request.OnDelete;

        try
        {
            return await SaveAndBuildResponseAsync(design, cancellationToken);
        }
        catch (DbUpdateException exception) when (DesignRelationshipRules.IsUniqueConstraintViolation(exception))
        {
            throw new DesignRelationshipConflictException("An identical relationship was created concurrently. Refresh the design and try again.");
        }
    }

    public async Task<DesignResponseDto> DeleteRelationshipAsync(int relationshipId, int ifMatchRevision, CancellationToken cancellationToken = default)
    {
        var designModelId = await _designRepository.FindDesignModelIdByRelationshipIdAsync(relationshipId, cancellationToken)
            ?? throw new KeyNotFoundException("Design relationship not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var relationship = design.Relationships.FirstOrDefault(r => r.Id == relationshipId)
            ?? throw new KeyNotFoundException("Design relationship not found.");

        design.Relationships.Remove(relationship);

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> UpdateLayoutAsync(int designId, int ifMatchRevision, UpdateDesignLayoutRequestDto request, CancellationToken cancellationToken = default)
    {
        var design = await LoadTrackedAsync(designId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        design.LayoutJson = request.Layout.HasValue ? request.Layout.Value.GetRawText() : null;

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    // ---- generation ----

    private static void ApplyGeneration(
        DesignModel design,
        IReadOnlyList<Dataset> datasets,
        IReadOnlyDictionary<int, int>? sourceVersions = null)
    {
        var existingDatasetIds = design.Tables
            .Where(table => table.SourceDatasetId.HasValue)
            .Select(table => table.SourceDatasetId!.Value)
            .ToHashSet();

        var usedTableNames = new HashSet<string>(design.Tables.Select(table => table.Name), StringComparer.OrdinalIgnoreCase);

        foreach (var dataset in datasets)
        {
            if (existingDatasetIds.Contains(dataset.Id))
            {
                continue;
            }

            var table = new DesignTable
            {
                DesignModelId = design.Id,
                Name = DatasetHeuristics.MakeUniqueIdentifier(dataset.TableName, usedTableNames, $"dataset_{dataset.Id}"),
                SourceDatasetId = dataset.Id,
                SourceDatasetVersionId = sourceVersions?.GetValueOrDefault(dataset.Id) ?? dataset.ActiveVersionId,
                Origin = DesignOrigin.Generated
            };

            var usedColumnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var orderedColumns = dataset.Columns.OrderBy(column => column.Id).ToList();

            for (var index = 0; index < orderedColumns.Count; index++)
            {
                var column = orderedColumns[index];
                var detectedType = DatasetHeuristics.ResolveDetectedDataType(dataset, column);
                table.Columns.Add(new DesignColumn
                {
                    Name = DatasetHeuristics.MakeUniqueIdentifier(column.ColumnName, usedColumnNames, $"column_{index + 1}"),
                    SqlType = DatasetHeuristics.MapToSqlType(detectedType),
                    IsNullable = column.IsNullable,
                    IsPrimaryKey = false,
                    IsUnique = false,
                    DefaultValue = null,
                    IsAutoIncrement = false,
                    Ordinal = index,
                    SourceColumnName = column.ColumnName,
                    Origin = DesignOrigin.Generated
                });

            }

            design.Tables.Add(table);
        }
    }

    /// <summary>
    /// "replace" mode: strips every Origin=Generated column (from any table, even one the user
    /// otherwise kept) and any relationship touching them, then drops tables that are themselves
    /// Origin=Generated and now empty. Tables/columns with Origin=User are never touched.
    /// Known limitation: a table containing a mix of user and generated columns keeps its
    /// SourceDatasetId, so ApplyGeneration will not recreate the generated columns it just lost —
    /// see report "Known limitations".
    /// </summary>
    private static void ReplaceGeneratedEntities(DesignModel design)
    {
        var columnsToRemove = design.Tables
            .SelectMany(table => table.Columns)
            .Where(column => column.Origin == DesignOrigin.Generated)
            .ToList();

        if (columnsToRemove.Count == 0)
        {
            return;
        }

        RemoveRelationshipsTouchingColumns(design, columnsToRemove.Select(column => column.Id).ToHashSet());

        foreach (var column in columnsToRemove)
        {
            var table = design.Tables.First(t => t.Columns.Contains(column));
            table.Columns.Remove(column);
        }

        var emptyGeneratedTables = design.Tables
            .Where(table => table.Origin == DesignOrigin.Generated && table.Columns.Count == 0)
            .ToList();

        foreach (var table in emptyGeneratedTables)
        {
            design.Tables.Remove(table);
        }
    }

    // ---- shared mutation plumbing ----

    private async Task<DesignModel> LoadTrackedAsync(int designModelId, CancellationToken cancellationToken)
    {
        return await _designRepository.GetFullByIdAsync(designModelId, track: true, cancellationToken)
            ?? throw new KeyNotFoundException("Design not found.");
    }

    private static void CheckRevision(DesignModel design, int ifMatchRevision)
    {
        if (design.Revision != ifMatchRevision)
        {
            throw new DesignConcurrencyException(design.Revision);
        }
    }

    private async Task<DesignResponseDto> SaveAndBuildResponseAsync(DesignModel design, CancellationToken cancellationToken, bool preserveValidationStatus = false)
    {
        if (!preserveValidationStatus)
        {
            design.Status = DesignStatus.Draft;
            design.ValidatedAt = null;
        }
        design.Revision += 1;
        design.UpdatedAt = DateTime.UtcNow;

        try
        {
            await _designRepository.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            var current = await _designRepository.GetFullByIdAsync(design.Id, track: false, cancellationToken);
            throw new DesignConcurrencyException(current?.Revision ?? design.Revision);
        }

        return BuildResponse(design);
    }

    private static void RemoveRelationshipsTouchingColumns(DesignModel design, ISet<int> columnIds)
    {
        var toRemove = design.Relationships
            .Where(relationship => columnIds.Contains(relationship.FromColumnId) || columnIds.Contains(relationship.ToColumnId))
            .ToList();

        foreach (var relationship in toRemove)
        {
            design.Relationships.Remove(relationship);
        }
    }

    private static string NormalizeMode(string? mode)
    {
        var normalized = string.IsNullOrWhiteSpace(mode) ? "merge" : mode.Trim().ToLowerInvariant();
        if (normalized is not ("merge" or "replace"))
        {
            throw new ArgumentException("mode must be 'merge' or 'replace'.");
        }

        return normalized;
    }

    private static void ValidateCardinality(string cardinality)
    {
        if (cardinality is not (DesignCardinality.ManyToOne or DesignCardinality.OneToOne))
        {
            throw new ArgumentException("cardinality must be 'many-to-one' or 'one-to-one'.");
        }
    }

    private static void ValidateOnDelete(string onDelete)
    {
        if (onDelete is not (DesignOnDelete.NoAction or DesignOnDelete.Cascade or DesignOnDelete.SetNull))
        {
            throw new ArgumentException("onDelete must be 'no-action', 'cascade', or 'set-null'.");
        }
    }

    private static void ValidateRelationshipEndpoints(DesignColumn fromColumn, DesignColumn toColumn)
    {
        if (fromColumn.Id == toColumn.Id)
        {
            throw new ArgumentException("A relationship cannot use the same source and target column.");
        }

        if (!DesignRelationshipRules.IsValidTarget(toColumn))
        {
            var target = $"{toColumn.DesignTable?.Name ?? "unknown"}.{toColumn.Name}";
            throw new ArgumentException($"Relationship target '{target}' must be a Primary Key or Unique column.");
        }

        if (!DesignRelationshipRules.HaveCompatibleTypes(fromColumn, toColumn))
        {
            throw new ArgumentException(
                $"Relationship columns must use the same PostgreSQL type; source is '{fromColumn.SqlType}' and target is '{toColumn.SqlType}'.");
        }
    }

    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private ICleaningRepository RequireCleaningRepository()
    {
        return _cleaningRepository
            ?? throw new InvalidOperationException("Cleaning version metadata is unavailable.");
    }

    private async Task EnsureSchemaGenerationAllowedAsync(
        int projectId,
        ICleaningRepository cleaningRepository,
        CancellationToken cancellationToken)
    {
        if (_workflowService is not null)
        {
            await _workflowService.EnsureCanBuildSchemaAsync(projectId, cancellationToken);
            return;
        }

        if (!await cleaningRepository.IsSchemaReadyAsync(projectId, cancellationToken))
        {
            throw new InvalidOperationException("Confirm the cleaned, re-analyzed dataset versions before generating a schema.");
        }
    }

    private static void ValidateRenameWhitelist(SaveDesignDraftRequestDto request)
    {
        if (request.UnsupportedFields?.Count > 0
            || request.Tables.Any(item => item.UnsupportedFields?.Count > 0)
            || request.Columns.Any(item => item.UnsupportedFields?.Count > 0))
        {
            throw new ArgumentException("Only whitelisted table names and column schema properties are supported.");
        }

        if (request.Tables.GroupBy(item => item.Id).Any(group => group.Count() > 1)
            || request.Columns.GroupBy(item => item.Id).Any(group => group.Count() > 1))
        {
            throw new ArgumentException("Each table or column can appear only once in a save request.");
        }
    }

    private static string ValidateEditableIdentifier(string? value, string kind)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (!SqlIdentifiers.IsValidEditableIdentifier(trimmed))
        {
            throw new ArgumentException($"{kind} name '{trimmed}' must start with a letter or underscore, contain only letters, digits, or underscores, be at most 63 characters, and not be a PostgreSQL reserved keyword.");
        }

        return trimmed;
    }

    private static void EnsureUniqueNames(DesignModel design)
    {
        var duplicateTable = design.Tables
            .GroupBy(table => table.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicateTable is not null)
        {
            throw new ArgumentException($"Table name '{duplicateTable.Key}' is already used in this schema.");
        }

        foreach (var table in design.Tables)
        {
            var duplicateColumn = table.Columns
                .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault(group => group.Count() > 1);
            if (duplicateColumn is not null)
            {
                throw new ArgumentException($"Column name '{duplicateColumn.Key}' is already used in table '{table.Name}'.");
            }
        }
    }

    private async Task<bool> IsStaleAsync(DesignModel design, CancellationToken cancellationToken)
    {
        if (_cleaningRepository is null) return false;
        if (!await _cleaningRepository.IsSchemaReadyAsync(design.ProjectId, cancellationToken)) return true;

        var active = await _cleaningRepository.GetActiveProjectVersionsAsync(design.ProjectId, cancellationToken);
        var activeVersions = active.ToDictionary(item => item.Dataset.Id, item => item.Version.Id);
        var schemaVersions = design.Tables
            .Where(table => table.SourceDatasetId.HasValue && table.SourceDatasetVersionId.HasValue)
            .ToDictionary(table => table.SourceDatasetId!.Value, table => table.SourceDatasetVersionId!.Value);

        return activeVersions.Count != schemaVersions.Count
            || activeVersions.Any(pair => !schemaVersions.TryGetValue(pair.Key, out var versionId) || versionId != pair.Value);
    }

    private List<Validation.ValidationIssue> BuildValidationIssues(DesignModel design, bool stale)
    {
        var issues = _validationService.Validate(BuildSnapshot(design));
        if (stale)
        {
            issues.Add(new Validation.ValidationIssue
            {
                Code = "stale-cleaned-versions",
                Severity = ValidationSeverity.Error,
                Message = "The confirmed active cleaned dataset versions no longer match this schema. Regenerate the schema from Data Cleaning."
            });
        }

        return issues;
    }

    private async Task<DesignResponseDto> BuildSchemaResponseAsync(DesignModel design, CancellationToken cancellationToken)
    {
        var stale = await IsStaleAsync(design, cancellationToken);
        var issues = BuildValidationIssues(design, stale);
        var response = BuildResponse(design);
        response.IsStale = stale;
        response.ValidationIssues = issues.Select(MapIssue).ToList();
        response.CanContinue = design.Status == DesignStatus.Valid
            && !stale
            && !issues.Any(issue => issue.Severity == ValidationSeverity.Error);
        response.SqlPreview = _generatorResolver.Generate("sql", BuildSnapshot(design));
        return response;
    }

    // ---- mapping ----

    private DesignModelSnapshot BuildSnapshot(DesignModel design)
    {
        return new DesignModelSnapshot
        {
            ProjectId = design.ProjectId,
            ProjectName = design.Project?.Name ?? string.Empty,
            Revision = design.Revision,
            GeneratedAt = DateTime.UtcNow,
            Tables = design.Tables.Select(table => new DesignTableSnapshot
            {
                Id = table.Id,
                Name = table.Name,
                Comment = table.Comment,
                SourceName = table.SourceDataset?.TableName,
                Columns = table.Columns
                    .OrderBy(column => column.Ordinal)
                    .Select(column => new DesignColumnSnapshot
                    {
                        Id = column.Id,
                        TableId = column.DesignTableId,
                        Name = column.Name,
                        SqlType = column.SqlType,
                        IsNullable = column.IsNullable,
                        IsPrimaryKey = column.IsPrimaryKey,
                        IsUnique = column.IsUnique,
                        DefaultValue = column.DefaultValue,
                        IsAutoIncrement = column.IsAutoIncrement,
                        Ordinal = column.Ordinal,
                        SourceName = column.SourceColumnName
                    })
                    .ToList()
            }).ToList(),
            Relationships = design.Relationships.Select(relationship => new DesignRelationshipSnapshot
            {
                Id = relationship.Id,
                FromTableId = relationship.FromColumn!.DesignTableId,
                FromTableName = relationship.FromColumn.DesignTable!.Name,
                FromColumnId = relationship.FromColumnId,
                FromColumnName = relationship.FromColumn.Name,
                ToTableId = relationship.ToColumn!.DesignTableId,
                ToTableName = relationship.ToColumn.DesignTable!.Name,
                ToColumnId = relationship.ToColumnId,
                ToColumnName = relationship.ToColumn.Name,
                Cardinality = relationship.Cardinality,
                OnDelete = relationship.OnDelete
            }).ToList()
        };
    }

    private DesignResponseDto BuildResponse(DesignModel design)
    {
        var snapshot = BuildSnapshot(design);
        var issues = _validationService.Validate(snapshot);

        return new DesignResponseDto
        {
            Id = design.Id,
            ProjectId = design.ProjectId,
            Revision = design.Revision,
            Status = design.Status,
            GeneratedAt = design.GeneratedAt,
            ValidatedAt = design.ValidatedAt,
            LastModifiedBy = design.LastModifiedByUser is null
                ? null
                : $"{design.LastModifiedByUser.FirstName} {design.LastModifiedByUser.LastName}".Trim(),
            SourceVersions = ParseSourceVersions(design.SourceVersionsJson),
            Layout = ParseLayout(design.LayoutJson),
            CreatedAt = design.CreatedAt,
            UpdatedAt = design.UpdatedAt,
            Tables = design.Tables.OrderBy(table => table.Id).Select(MapTable).ToList(),
            Relationships = design.Relationships.OrderBy(relationship => relationship.Id).Select(MapRelationship).ToList(),
            ValidationIssues = issues.Select(MapIssue).ToList()
        };
    }

    private static DesignTableResponseDto MapTable(DesignTable table)
    {
        return new DesignTableResponseDto
        {
            Id = table.Id,
            Name = table.Name,
            Comment = table.Comment,
            SourceDatasetId = table.SourceDatasetId,
            SourceDatasetVersionId = table.SourceDatasetVersionId,
            SourceName = table.SourceDataset?.SourceName ?? table.SourceDataset?.TableName,
            RowCount = table.SourceDatasetVersion?.RowCount ?? table.SourceDataset?.RowCount ?? 0,
            Origin = table.Origin,
            Columns = table.Columns.OrderBy(column => column.Ordinal).Select(MapColumn).ToList()
        };
    }

    private static DesignColumnResponseDto MapColumn(DesignColumn column)
    {
        return new DesignColumnResponseDto
        {
            Id = column.Id,
            Name = column.Name,
            SqlType = column.SqlType,
            IsNullable = column.IsNullable,
            IsPrimaryKey = column.IsPrimaryKey,
            IsUnique = column.IsUnique,
            DefaultValue = column.DefaultValue,
            IsAutoIncrement = column.IsAutoIncrement,
            Ordinal = column.Ordinal,
            SourceColumnName = column.SourceColumnName,
            Origin = column.Origin
        };
    }

    private static DesignRelationshipResponseDto MapRelationship(DesignRelationship relationship)
    {
        return new DesignRelationshipResponseDto
        {
            Id = relationship.Id,
            FromColumnId = relationship.FromColumnId,
            FromTableId = relationship.FromColumn!.DesignTableId,
            FromTableName = relationship.FromColumn.DesignTable!.Name,
            FromColumnName = relationship.FromColumn.Name,
            ToColumnId = relationship.ToColumnId,
            ToTableId = relationship.ToColumn!.DesignTableId,
            ToTableName = relationship.ToColumn.DesignTable!.Name,
            ToColumnName = relationship.ToColumn.Name,
            Cardinality = relationship.Cardinality,
            OnDelete = relationship.OnDelete,
            Origin = relationship.Origin,
            SuggestionId = relationship.SuggestionId
        };
    }

    private static ValidationIssueDto MapIssue(Validation.ValidationIssue issue)
    {
        return new ValidationIssueDto
        {
            Code = issue.Code,
            Severity = issue.Severity,
            Message = issue.Message,
            TableId = issue.TableId,
            ColumnId = issue.ColumnId,
            RelationshipId = issue.RelationshipId
        };
    }

    private static JsonElement? ParseLayout(string? layoutJson)
    {
        if (string.IsNullOrWhiteSpace(layoutJson))
        {
            return null;
        }

        using var document = JsonDocument.Parse(layoutJson);
        return document.RootElement.Clone();
    }

    private static Dictionary<int, int> ParseSourceVersions(string? sourceVersionsJson)
    {
        if (string.IsNullOrWhiteSpace(sourceVersionsJson)) return new();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<int, int>>(sourceVersionsJson) ?? new();
        }
        catch (JsonException)
        {
            return new();
        }
    }
}
