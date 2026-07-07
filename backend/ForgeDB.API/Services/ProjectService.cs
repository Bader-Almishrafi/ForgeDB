using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class ProjectService : IProjectService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IProjectRepository _projectRepository;
    private readonly IDesignService _designService;
    private readonly IRelationshipDetectionService _relationshipDetectionService;

    public ProjectService(
        IProjectRepository projectRepository,
        IDesignService designService,
        IRelationshipDetectionService relationshipDetectionService)
    {
        _projectRepository = projectRepository;
        _designService = designService;
        _relationshipDetectionService = relationshipDetectionService;
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
        var suggestions = await _relationshipDetectionService.GetSuggestionsAsync(projectId, status: null, cancellationToken);
        var acceptedRelationshipsCount = suggestions.Count(suggestion => suggestion.Status == "accepted");
        var design = await _designService.GetByProjectIdAsync(projectId, cancellationToken);
        var generatedSchemasCount = design is null ? 0 : 1;

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

    public async Task<ProjectExportPackageDto> GetProjectExportPackageAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        var dataQualityReportJson = BuildDataQualityReportJson(project);

        var artifacts = await _designService.PrepareExportArtifactsAsync(projectId, cancellationToken);
        if (artifacts is null)
        {
            return new ProjectExportPackageDto
            {
                ProjectId = project.Id,
                ProjectName = project.Name,
                Status = "Upload datasets and generate a design to build a package",
                GeneratedAt = DateTime.UtcNow,
                Sql = string.Empty,
                Dbml = string.Empty,
                JsonSchema = string.Empty,
                RelationshipReportJson = "[]",
                DataQualityReportJson = dataQualityReportJson
            };
        }

        var errorIssues = artifacts.ValidationIssues.Where(issue => issue.Severity == "error").ToList();
        if (errorIssues.Count > 0)
        {
            throw new DesignValidationFailedException(artifacts.ValidationIssues);
        }

        var suggestions = await _relationshipDetectionService.GetSuggestionsAsync(projectId, status: null, cancellationToken);
        var relationshipReport = BuildRelationshipReport(suggestions, artifacts.Relationships);

        return new ProjectExportPackageDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            Status = "Database Package Ready",
            GeneratedAt = DateTime.UtcNow,
            Sql = artifacts.Sql,
            Dbml = artifacts.Dbml,
            JsonSchema = artifacts.Json,
            RelationshipReportJson = JsonSerializer.Serialize(relationshipReport, JsonOptions),
            DataQualityReportJson = dataQualityReportJson
        };
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

    private static List<object> BuildRelationshipReport(
        IReadOnlyList<RelationshipSuggestionResponseDto> suggestions,
        IReadOnlyList<DesignRelationshipResponseDto> relationships)
    {
        var relationshipBySuggestionId = relationships
            .Where(relationship => relationship.SuggestionId.HasValue)
            .ToDictionary(relationship => relationship.SuggestionId!.Value);

        return suggestions.Select(suggestion => (object)new
        {
            suggestionId = suggestion.Id,
            sourceTable = suggestion.SourceTableName,
            sourceColumn = suggestion.SourceColumnName,
            targetTable = suggestion.TargetTableName,
            targetColumn = suggestion.TargetColumnName,
            score = suggestion.Score,
            status = suggestion.Status,
            decidedAt = suggestion.DecidedAt,
            createdAt = suggestion.CreatedAt,
            evidence = ParseEvidence(suggestion.EvidenceJson),
            relationship = relationshipBySuggestionId.TryGetValue(suggestion.Id, out var relationship)
                ? new
                {
                    relationship.Id,
                    relationship.FromTableName,
                    relationship.FromColumnName,
                    relationship.ToTableName,
                    relationship.ToColumnName,
                    relationship.Cardinality,
                    relationship.OnDelete
                }
                : null
        }).ToList();
    }

    private static JsonElement? ParseEvidence(string? evidenceJson)
    {
        if (string.IsNullOrWhiteSpace(evidenceJson))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(evidenceJson);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string BuildDataQualityReportJson(Project project)
    {
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

        return JsonSerializer.Serialize(dataQuality, JsonOptions);
    }

    private static IReadOnlyList<string> BuildNextRecommendedActions(
        Project project,
        IReadOnlyList<RelationshipSuggestionResponseDto> suggestions,
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
            actions.Add("Generate the project design.");
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
            return "Generate design";
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
}
