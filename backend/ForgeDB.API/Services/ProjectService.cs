using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class ProjectService : IProjectService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IProjectRepository _projectRepository;

    public ProjectService(IProjectRepository projectRepository)
    {
        _projectRepository = projectRepository;
    }

    public async Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var projectName = request.Name?.Trim();
        if (request.UserId <= 0)
        {
            throw new ArgumentException("UserId is required.", nameof(request));
        }

        if (string.IsNullOrWhiteSpace(projectName))
        {
            throw new ArgumentException("Project name is required.", nameof(request));
        }

        if (!await _projectRepository.UserExistsAsync(request.UserId, cancellationToken))
        {
            throw new ArgumentException("UserId does not reference an existing user.", nameof(request));
        }

        var project = new Project
        {
            UserId = request.UserId,
            Name = projectName,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        await _projectRepository.AddAsync(project, cancellationToken);

        return MapToResponse(project);
    }

    public async Task<ProjectResponseDto?> GetProjectByIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);

        return project is null ? null : MapToResponse(project);
    }

    public async Task<IReadOnlyList<ProjectResponseDto>?> GetProjectsByUserIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        if (userId <= 0)
        {
            throw new ArgumentException("UserId must be greater than zero.", nameof(userId));
        }

        if (!await _projectRepository.UserExistsAsync(userId, cancellationToken))
        {
            return null;
        }

        var projects = await _projectRepository.GetByUserIdAsync(userId, cancellationToken);

        return projects.Select(MapToResponse).ToList();
    }

    public async Task<ProjectOverviewDto> GetProjectOverviewAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        var suggestions = BuildRelationshipSuggestions(project);
        var acceptedRelationshipsCount = suggestions.Count(suggestion => suggestion.Status == "accepted");
        var generatedSchemasCount = project.DatabaseSchemas.Count;

        return new ProjectOverviewDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            DatasetsCount = project.Datasets.Count,
            TotalRows = project.Datasets.Sum(dataset => dataset.RowCount),
            TotalColumns = project.Datasets.Sum(dataset => dataset.ColumnCount),
            AnalyzedDatasetsCount = project.Datasets.Count(dataset => dataset.Status == "Analyzed"),
            GeneratedSchemasCount = generatedSchemasCount,
            RelationshipSuggestionsCount = suggestions.Count,
            AcceptedRelationshipsCount = acceptedRelationshipsCount,
            ExportReadinessStatus = ResolveExportReadiness(project, acceptedRelationshipsCount, generatedSchemasCount),
            RecentDatasets = project.Datasets
                .OrderByDescending(dataset => dataset.CreatedAt)
                .Take(5)
                .Select(MapDatasetToResponse)
                .ToList(),
            NextRecommendedActions = BuildNextRecommendedActions(project, suggestions, generatedSchemasCount, acceptedRelationshipsCount)
        };
    }

    public async Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> GetRelationshipSuggestionsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        return BuildRelationshipSuggestions(project);
    }

    public Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> AcceptRelationshipAsync(
        int projectId,
        ProjectRelationshipDecisionDto request,
        CancellationToken cancellationToken = default)
    {
        return SaveRelationshipDecisionAsync(projectId, request, "accepted", cancellationToken);
    }

    public Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> RejectRelationshipAsync(
        int projectId,
        ProjectRelationshipDecisionDto request,
        CancellationToken cancellationToken = default)
    {
        return SaveRelationshipDecisionAsync(projectId, request, "rejected", cancellationToken);
    }

    public async Task<ProjectSchemaDto> GetProjectSchemaAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        return BuildProjectSchema(project);
    }

    public Task<ProjectSchemaDto> GenerateProjectSchemaAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return GetProjectSchemaAsync(projectId, cancellationToken);
    }

    public async Task<ProjectExportPackageDto> GetProjectExportPackageAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        var schema = BuildProjectSchema(project);
        var dataQuality = project.Datasets
            .OrderBy(dataset => dataset.TableName, StringComparer.OrdinalIgnoreCase)
            .Select(dataset => new
            {
                datasetId = dataset.Id,
                tableName = dataset.TableName,
                rowCount = dataset.RowCount,
                columnCount = dataset.ColumnCount,
                missingValuesCount = dataset.MissingValuesCount,
                duplicateRowsCount = dataset.DuplicateRowsCount,
                status = dataset.Status,
                analyzedAt = dataset.AnalyzedAt
            })
            .ToList();

        return new ProjectExportPackageDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            Status = schema.Tables.Any() ? "Database Package Ready" : "Upload datasets to build package",
            GeneratedAt = DateTime.UtcNow,
            Sql = schema.SqlPreview,
            Dbml = schema.DbmlPreview,
            JsonSchema = schema.JsonPreview,
            RelationshipReportJson = JsonSerializer.Serialize(schema.Relationships, JsonOptions),
            DataQualityReportJson = JsonSerializer.Serialize(dataQuality, JsonOptions)
        };
    }

    public async Task DeleteProjectAsync(int projectId, CancellationToken cancellationToken = default)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        await _projectRepository.DeleteAsync(projectId, cancellationToken);
    }

    private async Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> SaveRelationshipDecisionAsync(
        int projectId,
        ProjectRelationshipDecisionDto request,
        string status,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        var suggestions = BuildRelationshipSuggestions(project);
        var requestSuggestionId = string.IsNullOrWhiteSpace(request.SuggestionId)
            ? BuildSuggestionId(request.FromDatasetId, request.FromTable, request.FromColumn, request.ToDatasetId, request.ToTable, request.ToColumn)
            : request.SuggestionId.Trim();
        var suggestion = suggestions.FirstOrDefault(item => item.SuggestionId.Equals(requestSuggestionId, StringComparison.OrdinalIgnoreCase))
            ?? new ProjectRelationshipSuggestionDto
            {
                SuggestionId = requestSuggestionId,
                FromDatasetId = request.FromDatasetId,
                FromTable = request.FromTable.Trim(),
                FromColumn = request.FromColumn.Trim(),
                ToDatasetId = request.ToDatasetId,
                ToTable = request.ToTable.Trim(),
                ToColumn = request.ToColumn.Trim(),
                RelationshipType = string.IsNullOrWhiteSpace(request.RelationshipType) ? "many-to-one" : request.RelationshipType.Trim(),
                Confidence = 0.5m,
                Reasons = new[] { "Manually reviewed relationship." },
                Status = status
            };

        var config = ReadWorkspaceConfig(project.DashboardConfig);
        config.RelationshipDecisions.RemoveAll(decision => decision.SuggestionId.Equals(suggestion.SuggestionId, StringComparison.OrdinalIgnoreCase));
        config.RelationshipDecisions.Add(new ProjectRelationshipStoredDecision
        {
            SuggestionId = suggestion.SuggestionId,
            FromDatasetId = suggestion.FromDatasetId,
            FromTable = suggestion.FromTable,
            FromColumn = suggestion.FromColumn,
            ToDatasetId = suggestion.ToDatasetId,
            ToTable = suggestion.ToTable,
            ToColumn = suggestion.ToColumn,
            RelationshipType = suggestion.RelationshipType,
            Status = status,
            UpdatedAt = DateTime.UtcNow
        });

        await _projectRepository.UpdateDashboardConfigAsync(
            projectId,
            JsonSerializer.Serialize(config, JsonOptions),
            DateTime.UtcNow,
            cancellationToken);

        var updatedProject = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        return BuildRelationshipSuggestions(updatedProject);
    }

    private async Task<Project> GetWorkspaceProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        var project = await _projectRepository.GetByIdWithWorkspaceAsync(projectId, cancellationToken);
        return project ?? throw new KeyNotFoundException("Project not found.");
    }

    private static IReadOnlyList<ProjectRelationshipSuggestionDto> BuildRelationshipSuggestions(Project project)
    {
        var config = ReadWorkspaceConfig(project.DashboardConfig);
        var decisionMap = config.RelationshipDecisions
            .GroupBy(decision => decision.SuggestionId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.OrdinalIgnoreCase);
        var profiles = project.Datasets
            .SelectMany(dataset => dataset.Columns.Select(column => BuildColumnProfile(dataset, column)))
            .ToList();
        var suggestions = new Dictionary<string, ProjectRelationshipSuggestionDto>(StringComparer.OrdinalIgnoreCase);

        foreach (var left in profiles)
        {
            foreach (var right in profiles)
            {
                if (left.Dataset.Id >= right.Dataset.Id || left.Dataset.Id == right.Dataset.Id)
                {
                    continue;
                }

                var suggestion = TryBuildRelationshipSuggestion(left, right)
                    ?? TryBuildRelationshipSuggestion(right, left);
                if (suggestion is null)
                {
                    continue;
                }

                if (decisionMap.TryGetValue(suggestion.SuggestionId, out var decision))
                {
                    suggestion.Status = decision.Status;
                    suggestion.RelationshipType = decision.RelationshipType;
                }

                suggestions[suggestion.SuggestionId] = suggestion;
            }
        }

        foreach (var decision in config.RelationshipDecisions)
        {
            if (!suggestions.ContainsKey(decision.SuggestionId))
            {
                suggestions[decision.SuggestionId] = new ProjectRelationshipSuggestionDto
                {
                    SuggestionId = decision.SuggestionId,
                    FromDatasetId = decision.FromDatasetId,
                    FromTable = decision.FromTable,
                    FromColumn = decision.FromColumn,
                    ToDatasetId = decision.ToDatasetId,
                    ToTable = decision.ToTable,
                    ToColumn = decision.ToColumn,
                    RelationshipType = decision.RelationshipType,
                    Confidence = 0.5m,
                    Reasons = new[] { "Stored relationship decision." },
                    Status = decision.Status
                };
            }
        }

        return suggestions.Values
            .OrderByDescending(suggestion => suggestion.Status == "accepted")
            .ThenByDescending(suggestion => suggestion.Confidence)
            .ThenBy(suggestion => suggestion.FromTable, StringComparer.OrdinalIgnoreCase)
            .ThenBy(suggestion => suggestion.FromColumn, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static ProjectRelationshipSuggestionDto? TryBuildRelationshipSuggestion(
        DatasetColumnProfile left,
        DatasetColumnProfile right)
    {
        return new[]
            {
                ScoreRelationshipCandidate(left, right),
                ScoreRelationshipCandidate(right, left)
            }
            .Where(candidate => candidate is not null)
            .Select(candidate => candidate!)
            .OrderByDescending(candidate => candidate.Confidence)
            .FirstOrDefault();
    }

    private static ProjectRelationshipSuggestionDto? ScoreRelationshipCandidate(
        DatasetColumnProfile source,
        DatasetColumnProfile target)
    {
        if (!target.IsUnique || source.Dataset.Id == target.Dataset.Id)
        {
            return null;
        }

        var sameName = ColumnNamesMatch(source.Column.ColumnName, target.Column.ColumnName);
        var nameSimilarity = CalculateColumnNameSimilarity(source.Column.ColumnName, target.Column.ColumnName);
        var similarName = !sameName && nameSimilarity >= 0.67m;
        var sourceReferencesTargetTable = ColumnPrefixMatchesTable(source.Column.ColumnName, target.Dataset.TableName);
        var sourceKeyLike = IsKeyLikeColumn(source.Column.ColumnName);
        var targetKeyLike = IsKeyLikeColumn(target.Column.ColumnName);
        var sourceRepeated = source.HasRepeatedValues;
        var overlap = CalculateOverlap(source.Values, target.Values);

        var hasNameEvidence = sameName || similarName || sourceReferencesTargetTable;
        var hasValueEvidence = overlap >= 0.25m;
        var hasShapeEvidence = sourceRepeated || source.Dataset.RowCount >= target.Dataset.RowCount;
        var hasKeyEvidence = sourceKeyLike || targetKeyLike;

        if ((!hasNameEvidence && !hasValueEvidence)
            || (!hasShapeEvidence && overlap < 0.8m)
            || (!hasKeyEvidence && overlap < 0.5m))
        {
            return null;
        }

        var reasons = new List<string>();
        var confidence = 0.2m;

        if (sameName)
        {
            confidence += 0.22m;
            reasons.Add("Column names match across datasets.");
        }
        else if (similarName)
        {
            confidence += 0.16m;
            reasons.Add("Column names are similar after normalization.");
        }

        if (sourceReferencesTargetTable)
        {
            confidence += 0.12m;
            reasons.Add("Source column name appears to reference the target table.");
        }

        if (sourceKeyLike || targetKeyLike)
        {
            confidence += sourceKeyLike && targetKeyLike ? 0.16m : 0.1m;
            reasons.Add("Candidate columns use identifier, code, key, number, or reference naming.");
        }

        confidence += 0.2m;
        reasons.Add("Target column values are unique, making it a lookup/master key candidate.");

        if (sourceRepeated)
        {
            confidence += 0.14m;
            reasons.Add("Source column has repeated values, making it a detail/transaction reference candidate.");
        }

        if (overlap > 0)
        {
            confidence += Math.Min(0.25m, Math.Round(overlap * 0.25m, 4));
            reasons.Add($"Value overlap is {Math.Round(overlap * 100, 0)}% based on stored rows.");
        }

        if (source.Dataset.RowCount >= target.Dataset.RowCount)
        {
            confidence += 0.05m;
            reasons.Add("Dataset shape suggests source records reference a smaller lookup/master dataset.");
        }

        if (confidence < 0.55m)
        {
            return null;
        }

        return new ProjectRelationshipSuggestionDto
        {
            SuggestionId = BuildSuggestionId(source.Dataset.Id, source.TableName, source.Column.ColumnName, target.Dataset.Id, target.TableName, target.Column.ColumnName),
            FromDatasetId = source.Dataset.Id,
            FromTable = source.TableName,
            FromColumn = source.Column.ColumnName,
            ToDatasetId = target.Dataset.Id,
            ToTable = target.TableName,
            ToColumn = target.Column.ColumnName,
            RelationshipType = "many-to-one",
            Confidence = Math.Min(0.99m, confidence),
            Reasons = reasons,
            Status = "suggested"
        };
    }

    private static ProjectSchemaDto BuildProjectSchema(Project project)
    {
        var relationships = BuildRelationshipSuggestions(project)
            .Where(suggestion => suggestion.Status == "accepted")
            .ToList();
        var tables = project.Datasets
            .OrderBy(dataset => dataset.TableName, StringComparer.OrdinalIgnoreCase)
            .Select(dataset =>
            {
                var primaryKeyCandidates = BuildPrimaryKeyCandidates(dataset);
                return new ProjectSchemaTableDto
                {
                    DatasetId = dataset.Id,
                    TableName = NormalizeIdentifier(dataset.TableName, $"dataset_{dataset.Id}"),
                    Status = dataset.Columns.Count == 0 ? "missing columns" : "generated",
                    PrimaryKeyCandidates = primaryKeyCandidates,
                    Columns = dataset.Columns
                        .OrderBy(column => column.Id)
                        .Select(column =>
                        {
                            var detectedType = ResolveDetectedDataType(dataset, column);
                            var columnName = NormalizeIdentifier(column.ColumnName, $"column_{column.Id}");
                            return new ProjectSchemaColumnDto
                            {
                                Name = columnName,
                                SourceColumnName = column.ColumnName,
                                DetectedDataType = detectedType,
                                SqlType = MapToSqlType(detectedType),
                                IsNullable = column.IsNullable,
                                IsPrimaryKeyCandidate = primaryKeyCandidates.Contains(column.ColumnName, StringComparer.OrdinalIgnoreCase)
                            };
                        })
                        .ToList()
                };
            })
            .ToList();
        var sql = GenerateProjectSql(tables, relationships);
        var dbml = GenerateProjectDbml(project, tables, relationships);
        var jsonObject = new
        {
            projectId = project.Id,
            projectName = project.Name,
            tables,
            relationships,
            generatedAt = DateTime.UtcNow
        };

        return new ProjectSchemaDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            Status = tables.Any() ? "generated" : "empty",
            Tables = tables,
            Relationships = relationships,
            SqlPreview = sql,
            DbmlPreview = dbml,
            JsonPreview = JsonSerializer.Serialize(jsonObject, JsonOptions)
        };
    }

    private static string GenerateProjectSql(
        IReadOnlyList<ProjectSchemaTableDto> tables,
        IReadOnlyList<ProjectRelationshipSuggestionDto> relationships)
    {
        var builder = new StringBuilder();
        foreach (var table in tables)
        {
            builder.AppendLine($"CREATE TABLE {QuoteIdentifier(table.TableName)} (");
            var columns = table.Columns.ToList();
            for (var index = 0; index < columns.Count; index++)
            {
                var column = columns[index];
                var comma = index == columns.Count - 1 ? string.Empty : ",";
                builder.AppendLine($"    {QuoteIdentifier(column.Name)} {column.SqlType} {(column.IsNullable ? "NULL" : "NOT NULL")}{comma}");
            }
            builder.AppendLine(");");
            builder.AppendLine();
        }

        foreach (var relationship in relationships)
        {
            var constraintName = NormalizeIdentifier(
                $"fk_{relationship.FromTable}_{relationship.FromColumn}_{relationship.ToTable}_{relationship.ToColumn}",
                "fk_relationship");
            builder.AppendLine(
                $"ALTER TABLE {QuoteIdentifier(NormalizeIdentifier(relationship.FromTable, relationship.FromTable))} ADD CONSTRAINT {QuoteIdentifier(constraintName)} FOREIGN KEY ({QuoteIdentifier(NormalizeIdentifier(relationship.FromColumn, relationship.FromColumn))}) REFERENCES {QuoteIdentifier(NormalizeIdentifier(relationship.ToTable, relationship.ToTable))} ({QuoteIdentifier(NormalizeIdentifier(relationship.ToColumn, relationship.ToColumn))});");
        }

        return builder.ToString().TrimEnd();
    }

    private static string GenerateProjectDbml(
        Project project,
        IReadOnlyList<ProjectSchemaTableDto> tables,
        IReadOnlyList<ProjectRelationshipSuggestionDto> relationships)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"Project {DbmlIdentifier(project.Name)} {{");
        builder.AppendLine("  database_type: \"PostgreSQL\"");
        builder.AppendLine("}");
        builder.AppendLine();

        foreach (var table in tables)
        {
            builder.AppendLine($"Table {DbmlIdentifier(table.TableName)} {{");
            foreach (var column in table.Columns)
            {
                var settings = column.IsNullable ? string.Empty : " [not null]";
                builder.AppendLine($"  {DbmlIdentifier(column.Name)} {column.SqlType.ToLowerInvariant()}{settings}");
            }
            builder.AppendLine("}");
            builder.AppendLine();
        }

        foreach (var relationship in relationships)
        {
            builder.AppendLine(
                $"Ref: {DbmlIdentifier(NormalizeIdentifier(relationship.FromTable, relationship.FromTable))}.{DbmlIdentifier(NormalizeIdentifier(relationship.FromColumn, relationship.FromColumn))} > {DbmlIdentifier(NormalizeIdentifier(relationship.ToTable, relationship.ToTable))}.{DbmlIdentifier(NormalizeIdentifier(relationship.ToColumn, relationship.ToColumn))}");
        }

        return builder.ToString().TrimEnd();
    }

    private static IReadOnlyList<string> BuildNextRecommendedActions(
        Project project,
        IReadOnlyList<ProjectRelationshipSuggestionDto> suggestions,
        int generatedSchemasCount,
        int acceptedRelationshipsCount)
    {
        var actions = new List<string>();
        if (project.Datasets.Count == 0)
        {
            actions.Add("Upload one or more raw CSV datasets to begin profiling and relationship discovery.");
            return actions;
        }

        var importedDatasets = project.Datasets.Count(dataset => dataset.Status != "Analyzed");
        if (importedDatasets > 0)
        {
            actions.Add($"Analyze {importedDatasets} dataset(s) to unlock profiles and chart insights.");
        }

        if (suggestions.Any() && acceptedRelationshipsCount == 0)
        {
            actions.Add("Review relationship suggestions and accept the useful ones.");
        }

        if (generatedSchemasCount == 0)
        {
            actions.Add("Generate the project-level schema.");
        }

        if (!actions.Any())
        {
            actions.Add("Open Exports and download the database package.");
        }

        return actions;
    }

    private static string ResolveExportReadiness(Project project, int acceptedRelationshipsCount, int generatedSchemasCount)
    {
        if (project.Datasets.Count == 0)
        {
            return "Upload datasets";
        }

        if (project.Datasets.Any(dataset => dataset.Status != "Analyzed"))
        {
            return "Analyze datasets";
        }

        if (generatedSchemasCount == 0)
        {
            return "Generate schema";
        }

        return acceptedRelationshipsCount > 0 ? "Ready" : "Ready without accepted relationships";
    }

    private static DatasetResponseDto MapDatasetToResponse(Dataset dataset)
    {
        return new DatasetResponseDto
        {
            Id = dataset.Id,
            ProjectId = dataset.ProjectId,
            TableName = dataset.TableName,
            SourceType = dataset.SourceType,
            SourceName = dataset.SourceName,
            RowCount = dataset.RowCount,
            ColumnCount = dataset.ColumnCount,
            MissingValuesCount = dataset.MissingValuesCount,
            DuplicateRowsCount = dataset.DuplicateRowsCount,
            Status = dataset.Status,
            CreatedAt = dataset.CreatedAt
        };
    }

    private static DatasetColumnProfile BuildColumnProfile(Dataset dataset, DatasetColumn column)
    {
        var values = dataset.Rows
            .OrderBy(row => row.RowNumber)
            .Select(row => TryGetRowValue(row.RowData, column.ColumnName))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToList();

        var distinctCount = values.Distinct(StringComparer.OrdinalIgnoreCase).Count();

        return new DatasetColumnProfile(
            dataset,
            column,
            NormalizeIdentifier(dataset.TableName, $"dataset_{dataset.Id}"),
            values,
            values.Count > 0 && distinctCount == values.Count,
            values.Count > 0 && distinctCount < values.Count);
    }

    private static decimal CalculateOverlap(IReadOnlyList<string> sourceValues, IReadOnlyList<string> targetValues)
    {
        if (sourceValues.Count == 0 || targetValues.Count == 0)
        {
            return 0;
        }

        var targetSet = targetValues.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sourceDistinct = sourceValues.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var overlapCount = sourceDistinct.Count(targetSet.Contains);

        return sourceDistinct.Count == 0 ? 0 : Math.Round((decimal)overlapCount / sourceDistinct.Count, 4);
    }

    private static IReadOnlyList<string> BuildPrimaryKeyCandidates(Dataset dataset)
    {
        return dataset.Columns
            .Select(column => BuildColumnProfile(dataset, column))
            .Where(profile => IsKeyLikeColumn(profile.Column.ColumnName) && profile.IsUnique)
            .OrderBy(profile => profile.Column.ColumnName.Equals("id", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(profile => profile.Column.ColumnName, StringComparer.OrdinalIgnoreCase)
            .Select(profile => profile.Column.ColumnName)
            .ToList();
    }

    private static string ResolveDetectedDataType(Dataset dataset, DatasetColumn column)
    {
        var analysisTypes = ResolveAnalysisTypes(dataset.AnalysisResultJson);
        return analysisTypes.TryGetValue(column.ColumnName, out var analysisType)
            ? analysisType
            : string.IsNullOrWhiteSpace(column.DetectedDataType)
                ? "string"
                : column.DetectedDataType.Trim().ToLowerInvariant();
    }

    private static Dictionary<string, string> ResolveAnalysisTypes(string? analysisResultJson)
    {
        var types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(analysisResultJson))
        {
            return types;
        }

        try
        {
            using var document = JsonDocument.Parse(analysisResultJson);
            if (!document.RootElement.TryGetProperty("columns", out var columns) || columns.ValueKind != JsonValueKind.Array)
            {
                return types;
            }

            foreach (var column in columns.EnumerateArray())
            {
                var name = column.TryGetProperty("columnName", out var nameProperty) ? nameProperty.GetString() : null;
                var type = column.TryGetProperty("detectedDataType", out var typeProperty) ? typeProperty.GetString() : null;
                if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(type))
                {
                    types[name] = type.Trim().ToLowerInvariant();
                }
            }
        }
        catch (JsonException)
        {
            return types;
        }

        return types;
    }

    private static string? TryGetRowValue(string rowData, string columnName)
    {
        try
        {
            using var document = JsonDocument.Parse(rowData);
            return document.RootElement.TryGetProperty(columnName, out var value)
                ? value.ValueKind == JsonValueKind.Null ? null : value.ToString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static ProjectWorkspaceConfig ReadWorkspaceConfig(string? dashboardConfig)
    {
        if (string.IsNullOrWhiteSpace(dashboardConfig))
        {
            return new ProjectWorkspaceConfig();
        }

        try
        {
            return JsonSerializer.Deserialize<ProjectWorkspaceConfig>(dashboardConfig, JsonOptions)
                ?? new ProjectWorkspaceConfig();
        }
        catch (JsonException)
        {
            return new ProjectWorkspaceConfig();
        }
    }

    private static string BuildSuggestionId(
        int fromDatasetId,
        string fromTable,
        string fromColumn,
        int toDatasetId,
        string toTable,
        string toColumn)
    {
        return $"{fromDatasetId}:{fromTable}.{fromColumn}->{toDatasetId}:{toTable}.{toColumn}".ToLowerInvariant();
    }

    private static bool ColumnPrefixMatchesTable(string columnName, string tableName)
    {
        var columnTokens = SplitIdentifierTokens(columnName)
            .Where(token => !IsKeyToken(token))
            .ToList();
        var tableTokens = SplitIdentifierTokens(tableName)
            .Select(SingularizeToken)
            .Where(token => !IsTableNoiseToken(token))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!columnTokens.Any() || !tableTokens.Any())
        {
            return false;
        }

        return columnTokens
            .Select(SingularizeToken)
            .Any(tableTokens.Contains);
    }

    private static bool ColumnNamesMatch(string left, string right)
    {
        return string.Equals(
            NormalizeNameForComparison(left),
            NormalizeNameForComparison(right),
            StringComparison.OrdinalIgnoreCase);
    }

    private static decimal CalculateColumnNameSimilarity(string left, string right)
    {
        var leftTokens = SplitIdentifierTokens(left).Select(NormalizeComparisonToken).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rightTokens = SplitIdentifierTokens(right).Select(NormalizeComparisonToken).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (leftTokens.Count == 0 || rightTokens.Count == 0)
        {
            return 0;
        }

        var intersection = leftTokens.Count(rightTokens.Contains);
        var union = leftTokens.Union(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        if (union == 0)
        {
            return 0;
        }

        return Math.Round((decimal)intersection / union, 4);
    }

    private static bool IsKeyLikeColumn(string columnName)
    {
        var tokens = SplitIdentifierTokens(columnName);
        if (tokens.Any(IsKeyToken))
        {
            return true;
        }

        var normalized = Regex.Replace(columnName.Trim().ToLowerInvariant(), "[^a-z0-9]+", string.Empty);
        return normalized.Length > 2
            && !normalized.EndsWith("paid", StringComparison.Ordinal)
            && (normalized.EndsWith("id", StringComparison.Ordinal)
                || normalized.EndsWith("key", StringComparison.Ordinal)
                || normalized.EndsWith("code", StringComparison.Ordinal)
                || normalized.EndsWith("ref", StringComparison.Ordinal)
                || normalized.EndsWith("no", StringComparison.Ordinal)
                || normalized.EndsWith("num", StringComparison.Ordinal)
                || normalized.EndsWith("number", StringComparison.Ordinal));
    }

    private static IReadOnlyList<string> SplitIdentifierTokens(string value)
    {
        var camelSeparated = Regex.Replace(value.Trim(), "([a-z0-9])([A-Z])", "$1_$2");
        return Regex.Split(camelSeparated.ToLowerInvariant(), "[^a-z0-9]+")
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .ToList();
    }

    private static string NormalizeNameForComparison(string value)
    {
        return string.Join("_", SplitIdentifierTokens(value).Select(NormalizeComparisonToken));
    }

    private static string NormalizeComparisonToken(string token)
    {
        var singular = SingularizeToken(token);
        return IsKeyToken(singular) ? "key" : singular;
    }

    private static string SingularizeToken(string token)
    {
        return token.EndsWith("s", StringComparison.OrdinalIgnoreCase) && token.Length > 3
            ? token[..^1]
            : token;
    }

    private static bool IsKeyToken(string token)
    {
        return token is "id" or "key" or "code" or "ref" or "no" or "num" or "number" or "uuid" or "guid";
    }

    private static bool IsTableNoiseToken(string token)
    {
        return token is "raw" or "export" or "final" or "dump" or "file" or "data" or "dataset" or "csv";
    }

    private static string MapToSqlType(string detectedDataType)
    {
        return detectedDataType.Trim().ToLowerInvariant() switch
        {
            "integer" => "INTEGER",
            "decimal" => "NUMERIC",
            "double" => "NUMERIC",
            "float" => "NUMERIC",
            "boolean" => "BOOLEAN",
            "date" => "TIMESTAMP",
            "datetime" => "TIMESTAMP",
            "string" => "TEXT",
            "text" => "TEXT",
            _ => "TEXT"
        };
    }

    private static string NormalizeIdentifier(string value, string fallback)
    {
        var normalized = Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9_]+", "_");
        normalized = Regex.Replace(normalized, "_+", "_").Trim('_');

        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = fallback;
        }

        if (char.IsDigit(normalized[0]))
        {
            normalized = $"t_{normalized}";
        }

        return normalized;
    }

    private static string QuoteIdentifier(string identifier)
    {
        return $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }

    private static string DbmlIdentifier(string value)
    {
        var identifier = value.Trim();
        return Regex.IsMatch(identifier, "^[A-Za-z_][A-Za-z0-9_]*$")
            ? identifier
            : $"\"{identifier.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }

    private static ProjectResponseDto MapToResponse(Project project)
    {
        return new ProjectResponseDto
        {
            Id = project.Id,
            UserId = project.UserId,
            Name = project.Name,
            Description = project.Description,
            DashboardConfig = project.DashboardConfig,
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt
        };
    }

    private sealed record DatasetColumnProfile(
        Dataset Dataset,
        DatasetColumn Column,
        string TableName,
        IReadOnlyList<string> Values,
        bool IsUnique,
        bool HasRepeatedValues);

    private sealed class ProjectWorkspaceConfig
    {
        public List<ProjectRelationshipStoredDecision> RelationshipDecisions { get; set; } = new();
    }

    private sealed class ProjectRelationshipStoredDecision
    {
        public string SuggestionId { get; set; } = string.Empty;
        public int FromDatasetId { get; set; }
        public string FromTable { get; set; } = string.Empty;
        public string FromColumn { get; set; } = string.Empty;
        public int ToDatasetId { get; set; }
        public string ToTable { get; set; } = string.Empty;
        public string ToColumn { get; set; } = string.Empty;
        public string RelationshipType { get; set; } = "many-to-one";
        public string Status { get; set; } = "suggested";
        public DateTime UpdatedAt { get; set; }
    }
}
