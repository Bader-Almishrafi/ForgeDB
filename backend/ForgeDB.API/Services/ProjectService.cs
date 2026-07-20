using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

// Contains Project business logic and coordinates project persistence, cleaning state,
// relationship discovery, and design generation. Project entities represent database state;
// create/update DTOs are input contracts, while response/overview/export DTOs are safe API output.
public class ProjectService : IProjectService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly IProjectRepository _projectRepository;
    private readonly IDesignService _designService;
    private readonly IRelationshipDetectionService _relationshipDetectionService;
    private readonly ICleaningRepository _cleaningRepository;
    private readonly IProjectWorkflowService _projectWorkflowService;

    public ProjectService(
        IProjectRepository projectRepository,
        IDesignService designService,
        IRelationshipDetectionService relationshipDetectionService,
        ICleaningRepository cleaningRepository,
        IProjectWorkflowService projectWorkflowService)
    {
        _projectRepository = projectRepository;
        _designService = designService;
        _relationshipDetectionService = relationshipDetectionService;
        _cleaningRepository = cleaningRepository;
        _projectWorkflowService = projectWorkflowService;
    }

    // -------------------------------------------------------------------------
    // Project CRUD operations
    // -------------------------------------------------------------------------

    public async Task<IReadOnlyList<ProjectSummaryDto>> GetProjectsAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);
        var projects = await _projectRepository.GetByUserIdAsync(userId, cancellationToken);
        var summaries = new List<ProjectSummaryDto>(projects.Count);

        // Project counts are expected to remain modest. Reusing the centralized workflow service
        // keeps one source of truth while avoiding the row/column workspace graph entirely.
        foreach (var project in projects)
        {
            var workflow = await _projectWorkflowService.EvaluateAsync(project.Id, cancellationToken);
            summaries.Add(MapToSummary(project, workflow));
        }

        return summaries;
    }

    public async Task<ProjectDetailsDto> CreateProjectAsync(
        int userId,
        ProjectCreateRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ValidateUserId(userId);
        ArgumentNullException.ThrowIfNull(request);
        var projectName = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(projectName))
        {
            throw new ArgumentException("Project name is required.", nameof(request));
        }

        if (!await _projectRepository.UserExistsAsync(userId, cancellationToken))
        {
            throw new UnauthorizedAccessException("The authenticated user no longer exists.");
        }

        var project = new Project
        {
            UserId = userId,
            Name = projectName,
            Description = NormalizeDescription(request.Description),
            CreatedAt = DateTime.UtcNow
        };

        await _projectRepository.AddAsync(project, cancellationToken);
        return MapToDetails(project, await _projectWorkflowService.EvaluateAsync(project.Id, cancellationToken));
    }

    public async Task<ProjectDetailsDto> GetProjectAsync(
        int projectId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        var project = await RequireOwnedProjectAsync(projectId, userId, cancellationToken);
        return MapToDetails(project, await _projectWorkflowService.EvaluateAsync(project.Id, cancellationToken));
    }

    public async Task<ProjectDetailsDto> UpdateProjectAsync(
        int projectId,
        int userId,
        ProjectUpdateRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await RequireOwnedProjectAsync(projectId, userId, cancellationToken);
        var name = request.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Project name is required.", nameof(request));
        }

        var project = await _projectRepository.UpdateDetailsAsync(
            projectId,
            name,
            NormalizeDescription(request.Description),
            DateTime.UtcNow,
            cancellationToken) ?? throw new KeyNotFoundException("Project not found.");
        return MapToDetails(project, await _projectWorkflowService.EvaluateAsync(project.Id, cancellationToken));
    }

    public async Task<bool> DeleteProjectAsync(
        int projectId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        await RequireOwnedProjectAsync(projectId, userId, cancellationToken);
        return await _projectRepository.DeleteAsync(projectId, cancellationToken);
    }

    // -------------------------------------------------------------------------
    // Overview generation
    // -------------------------------------------------------------------------

    // Combines the project and datasets with cleaning history/status, relationship suggestions,
    // generated design state, export readiness, and recommended next actions into one dashboard DTO.
    public async Task<ProjectOverviewDto> GetProjectOverviewAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await GetWorkspaceProjectAsync(projectId, cancellationToken);
        var suggestions = await _relationshipDetectionService.GetSuggestionsAsync(projectId, status: null, cancellationToken);
        var acceptedRelationshipsCount = suggestions.Count(suggestion => suggestion.Status == "accepted");
        var design = await _designService.GetByProjectIdAsync(projectId, cancellationToken);
        var generatedSchemasCount = design is null ? 0 : 1;
        var cleaningHistory = await _cleaningRepository.GetHistoryAsync(projectId, cancellationToken);
        var cleaningState = await _cleaningRepository.GetStateAsync(projectId, cancellationToken);
        var schemaReady = await _cleaningRepository.IsSchemaReadyAsync(projectId, cancellationToken);

        return new ProjectOverviewDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            DatasetsCount = project.Datasets.Count,
            TotalRows = project.Datasets.Sum(dataset => dataset.RowCount),
            TotalColumns = project.Datasets.Sum(dataset => dataset.ColumnCount),
            AnalyzedDatasetsCount = project.Datasets.Count(dataset => dataset.Status == "Analyzed"),
            CleaningBatchesCount = cleaningHistory.Count,
            QualityConfirmed = cleaningState?.QualityConfirmedAt is not null,
            SchemaReady = schemaReady,
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

    // -------------------------------------------------------------------------
    // Export package generation
    // -------------------------------------------------------------------------

    // Combines generated SQL, DBML, and JSON Schema with relationship and data-quality reports.
    // Design validation errors stop export so the package never presents invalid artifacts as ready.
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

    // -------------------------------------------------------------------------
    // Private workspace, report, recommendation, and mapping helpers
    // -------------------------------------------------------------------------

    // Loads the dataset-rich workspace graph needed by overview/export calculations and converts
    // the repository's null into the service-level missing-project exception.
    private async Task<Project> GetWorkspaceProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        var project = await _projectRepository.GetByIdWithWorkspaceAsync(projectId, cancellationToken);
        return project ?? throw new KeyNotFoundException("Project not found.");
    }

    // Joins relationship suggestions to accepted design relationships and shapes a serializable
    // report without exposing internal EF Core entities.
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

    // Parses stored evidence JSON when valid and tolerates legacy or malformed evidence by
    // returning null instead of failing the entire export package.
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

    // Summarizes dataset size, quality counters, and analysis state as the data-quality artifact
    // bundled with project exports.
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

    // Derives the next useful workflow actions from imported, analyzed, related, and designed state.
    private static IReadOnlyList<string> BuildNextRecommendedActions(
        Project project,
        IReadOnlyList<RelationshipSuggestionResponseDto> suggestions,
        int generatedSchemasCount,
        int acceptedRelationshipsCount)
    {
        var actions = new List<string>();
        if (project.Datasets.Count == 0)
        {
            actions.Add("Import one or more CSV, Excel, or API datasets to begin profiling and relationship discovery.");
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

    // Reduces current project progress to the export-readiness label shown in the overview.
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

    // Maps a Dataset entity to the public dataset contract used inside ProjectOverviewDto.
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

    private async Task<Project> RequireOwnedProjectAsync(
        int projectId,
        int userId,
        CancellationToken cancellationToken)
    {
        if (projectId <= 0)
        {
            throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        }

        ValidateUserId(userId);
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken)
            ?? throw new KeyNotFoundException("Project not found.");
        if (project.UserId != userId)
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }

        return project;
    }

    private static void ValidateUserId(int userId)
    {
        if (userId <= 0)
        {
            throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
        }
    }

    private static string? NormalizeDescription(string? description) =>
        string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    private static ProjectSummaryDto MapToSummary(Project project, ProjectWorkflowResponseDto workflow)
    {
        return new ProjectSummaryDto
        {
            Id = project.Id,
            Name = project.Name,
            Description = project.Description,
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt,
            WorkflowState = workflow.WorkflowState,
            CurrentStep = workflow.CurrentStep,
            RecommendedRoute = workflow.RecommendedRoute,
            DatasetsCount = workflow.Datasets.Count
        };
    }

    private static ProjectDetailsDto MapToDetails(Project project, ProjectWorkflowResponseDto workflow)
    {
        return new ProjectDetailsDto
        {
            Id = project.Id,
            Name = project.Name,
            Description = project.Description,
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt,
            WorkflowState = workflow.WorkflowState,
            CurrentStep = workflow.CurrentStep,
            RecommendedRoute = workflow.RecommendedRoute,
            DatasetsCount = workflow.Datasets.Count
        };
    }

}
