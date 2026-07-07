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

    public DesignService(
        IDesignRepository designRepository,
        IDatasetRepository datasetRepository,
        IDesignSchemaGeneratorResolver generatorResolver,
        IDesignValidationService validationService)
    {
        _designRepository = designRepository;
        _datasetRepository = datasetRepository;
        _generatorResolver = generatorResolver;
        _validationService = validationService;
    }

    public async Task<DesignResponseDto?> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        return design is null ? null : BuildResponse(design);
    }

    public async Task<DesignResponseDto> GenerateAsync(int projectId, GenerateDesignRequestDto request, CancellationToken cancellationToken = default)
    {
        var mode = NormalizeMode(request.Mode);

        if (!await _datasetRepository.ProjectExistsAsync(projectId, cancellationToken))
        {
            throw new KeyNotFoundException("Project not found.");
        }

        var datasets = await _datasetRepository.GetByProjectIdWithColumnsAsync(projectId, cancellationToken);
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: true, cancellationToken);

        if (design is null)
        {
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

        if (mode == "replace")
        {
            ReplaceGeneratedEntities(design);
        }

        ApplyGeneration(design, datasets);

        // Generate is not gated by If-Match (see prompt §4: it is listed separately from the
        // "Mutate (all require If-Match)" group) but still atomically bumps the revision.
        design.Revision += 1;
        design.UpdatedAt = DateTime.UtcNow;
        await _designRepository.SaveChangesAsync(cancellationToken);

        return BuildResponse(design);
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
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        if (design is null)
        {
            return null;
        }

        var snapshot = BuildSnapshot(design);
        var issues = _validationService.Validate(snapshot).Select(MapIssue).ToList();

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
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ArgumentException("Table name is required.");
        }

        var design = await LoadTrackedAsync(designId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        design.Tables.Add(new DesignTable
        {
            DesignModelId = design.Id,
            Name = request.Name.Trim(),
            Comment = NormalizeOptional(request.Comment),
            Origin = DesignOrigin.User
        });

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> UpdateTableAsync(int tableId, int ifMatchRevision, UpdateDesignTableRequestDto request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new ArgumentException("Table name is required.");
        }

        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        table.Name = request.Name.Trim();
        table.Comment = NormalizeOptional(request.Comment);
        table.Origin = DesignOrigin.User;

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
        ValidateColumnFields(request.Name, request.SqlType);

        var designModelId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var table = design.Tables.FirstOrDefault(t => t.Id == tableId)
            ?? throw new KeyNotFoundException("Design table not found.");

        table.Columns.Add(new DesignColumn
        {
            DesignTableId = table.Id,
            Name = request.Name.Trim(),
            SqlType = request.SqlType.Trim(),
            IsNullable = request.IsNullable,
            IsPrimaryKey = request.IsPrimaryKey,
            IsUnique = request.IsUnique,
            Ordinal = request.Ordinal,
            SourceColumnName = NormalizeOptional(request.SourceColumnName),
            Origin = DesignOrigin.User
        });

        return await SaveAndBuildResponseAsync(design, cancellationToken);
    }

    public async Task<DesignResponseDto> UpdateColumnAsync(int columnId, int ifMatchRevision, UpdateDesignColumnRequestDto request, CancellationToken cancellationToken = default)
    {
        ValidateColumnFields(request.Name, request.SqlType);

        var designModelId = await _designRepository.FindDesignModelIdByColumnIdAsync(columnId, cancellationToken)
            ?? throw new KeyNotFoundException("Design column not found.");
        var design = await LoadTrackedAsync(designModelId, cancellationToken);
        CheckRevision(design, ifMatchRevision);

        var column = design.Tables.SelectMany(t => t.Columns).FirstOrDefault(c => c.Id == columnId)
            ?? throw new KeyNotFoundException("Design column not found.");

        column.Name = request.Name.Trim();
        column.SqlType = request.SqlType.Trim();
        column.IsNullable = request.IsNullable;
        column.IsPrimaryKey = request.IsPrimaryKey;
        column.IsUnique = request.IsUnique;
        column.Ordinal = request.Ordinal;
        column.Origin = DesignOrigin.User;

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

        return await SaveAndBuildResponseAsync(design, cancellationToken);
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

        relationship.Cardinality = request.Cardinality;
        relationship.OnDelete = request.OnDelete;

        return await SaveAndBuildResponseAsync(design, cancellationToken);
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

    private static void ApplyGeneration(DesignModel design, IReadOnlyList<Dataset> datasets)
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
                Origin = DesignOrigin.Generated
            };

            var usedColumnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var orderedColumns = dataset.Columns.OrderBy(column => column.Id).ToList();
            var primaryKeyAssigned = false;

            for (var index = 0; index < orderedColumns.Count; index++)
            {
                var column = orderedColumns[index];
                var detectedType = DatasetHeuristics.ResolveDetectedDataType(dataset, column);
                var isFullyUnique = dataset.RowCount > 0 && column.UniqueValuesCount == dataset.RowCount;
                var isPrimaryKeyCandidate = !primaryKeyAssigned && isFullyUnique && DatasetHeuristics.IsKeyLikeColumn(column.ColumnName);

                table.Columns.Add(new DesignColumn
                {
                    Name = DatasetHeuristics.MakeUniqueIdentifier(column.ColumnName, usedColumnNames, $"column_{index + 1}"),
                    SqlType = DatasetHeuristics.MapToSqlType(detectedType),
                    IsNullable = column.IsNullable,
                    IsPrimaryKey = isPrimaryKeyCandidate,
                    IsUnique = isFullyUnique,
                    Ordinal = index,
                    SourceColumnName = column.ColumnName,
                    Origin = DesignOrigin.Generated
                });

                if (isPrimaryKeyCandidate)
                {
                    primaryKeyAssigned = true;
                }
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

    private async Task<DesignResponseDto> SaveAndBuildResponseAsync(DesignModel design, CancellationToken cancellationToken)
    {
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

    private static void ValidateColumnFields(string name, string sqlType)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Column name is required.");
        }

        if (string.IsNullOrWhiteSpace(sqlType))
        {
            throw new ArgumentException("Column sqlType is required.");
        }
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

    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
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
                        Ordinal = column.Ordinal
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
}
