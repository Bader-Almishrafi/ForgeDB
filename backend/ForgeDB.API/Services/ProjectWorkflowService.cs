using System.Text.Json;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Services;

public sealed class ProjectWorkflowService : IProjectWorkflowService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ForgeDbContext _context;
    private readonly IDeploymentRepository _deploymentRepository;

    public ProjectWorkflowService(ForgeDbContext context, IDeploymentRepository? deploymentRepository = null)
    {
        _context = context;
        _deploymentRepository = deploymentRepository ?? new DeploymentRepository(context);
    }

    public async Task<ProjectWorkflowResponseDto> GetWorkflowAsync(
        int projectId,
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (userId <= 0) throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
        var project = await GetProjectAsync(projectId, cancellationToken);
        if (project.UserId != userId)
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }

        return await EvaluateAsync(project, cancellationToken);
    }

    public async Task<ProjectWorkflowResponseDto> EvaluateAsync(int projectId, CancellationToken cancellationToken = default) =>
        await EvaluateAsync(await GetProjectAsync(projectId, cancellationToken), cancellationToken);

    public async Task EnsureCanCleanAsync(int projectId, CancellationToken cancellationToken = default) =>
        EnsureAllowed("clean data", await EvaluateAsync(projectId, cancellationToken), workflow => workflow.CanClean);

    public async Task EnsureCanBuildSchemaAsync(int projectId, CancellationToken cancellationToken = default) =>
        EnsureAllowed("build a schema", await EvaluateAsync(projectId, cancellationToken), workflow => workflow.CanBuildSchema);

    public async Task EnsureCanExportAsync(int projectId, CancellationToken cancellationToken = default) =>
        EnsureAllowed("export", await EvaluateAsync(projectId, cancellationToken), workflow => workflow.CanExport);

    public async Task EnsureCanDeployAsync(int projectId, CancellationToken cancellationToken = default) =>
        EnsureAllowed("deploy", await EvaluateAsync(projectId, cancellationToken), workflow => workflow.CanDeploy);

    private async Task<ProjectWorkflowResponseDto> EvaluateAsync(Project project, CancellationToken cancellationToken)
    {
        await _deploymentRepository.FailAbandonedRunningAsync(
            project.Id,
            DateTime.UtcNow - DeploymentRecoveryPolicy.AbandonedRunningTimeout,
            DeploymentRecoveryPolicy.AbandonedFailureMessage,
            cancellationToken);

        var datasetsInfo = await GetProjectDatasetsInfoAsync(project.Id, cancellationToken);
        var cleaningState = await _context.ProjectCleaningStates
            .AsNoTracking()
            .FirstOrDefaultAsync(state => state.ProjectId == project.Id, cancellationToken);
        var design = await _context.DesignModels
            .AsNoTracking()
            .Include(model => model.Tables)
            .FirstOrDefaultAsync(model => model.ProjectId == project.Id, cancellationToken);
        var latestDeployment = await _context.Deployments
            .AsNoTracking()
            .Where(deployment => deployment.ProjectId == project.Id)
            .OrderByDescending(deployment => deployment.StartedAt)
            .ThenByDescending(deployment => deployment.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var confirmedVersions = ParseVersionMap(cleaningState?.ConfirmedVersionsJson);
        var evaluations = datasetsInfo.Select(item => EvaluateDataset(item, confirmedVersions)).ToList();
        var summaries = evaluations.Select(item => item.Summary).ToList();
        var hasData = summaries.Count > 0;
        var allAnalyzed = hasData && summaries.All(dataset => dataset.HasCurrentAnalysis);
        var hasFirstAnalysisRequired = evaluations.Any(item => item.Summary.RequiresAnalysis && !item.IsStaleAnalysis);
        var hasStaleAnalysis = evaluations.Any(item => item.IsStaleAnalysis);
        var qualityConfirmed = allAnalyzed
            && cleaningState?.QualityConfirmedAt is not null
            && confirmedVersions.Count == summaries.Count
            && summaries.All(dataset => dataset.ActiveVersionId.HasValue
                && confirmedVersions.GetValueOrDefault(dataset.DatasetId) == dataset.ActiveVersionId.Value);

        foreach (var summary in summaries)
        {
            summary.IsQualityConfirmed = cleaningState?.QualityConfirmedAt is not null
                && summary.ActiveVersionId.HasValue
                && confirmedVersions.GetValueOrDefault(summary.DatasetId) == summary.ActiveVersionId.Value;
        }

        var schemaMatchesActiveVersions = design is not null && SchemaMatchesActiveVersions(design, summaries);
        var schemaIsValid = design is
        {
            Status: DesignStatus.Valid,
            ValidatedAt: not null
        } && design.Tables.Count > 0 && schemaMatchesActiveVersions;
        var deploymentInProgress = latestDeployment?.Status == DeploymentStatus.Running;

        var canImport = true;
        var canAnalyze = hasData;
        var canClean = allAnalyzed;
        var canBuildSchema = allAnalyzed && qualityConfirmed;
        var canExport = canBuildSchema && schemaIsValid;
        var canDeploy = canExport && !deploymentInProgress;
        var deployed = canDeploy
            && latestDeployment?.Status == DeploymentStatus.Completed
            && latestDeployment.DesignRevision == design!.Revision;

        var workflowState = ResolveState(
            hasData,
            hasFirstAnalysisRequired,
            hasStaleAnalysis,
            qualityConfirmed,
            design,
            schemaIsValid,
            canDeploy,
            deployed);
        var currentStep = ResolveCurrentStep(workflowState);
        var (blockerCodes, blockingReasons) = BuildBlockers(
            hasData,
            hasFirstAnalysisRequired,
            hasStaleAnalysis,
            allAnalyzed,
            qualityConfirmed,
            design,
            schemaMatchesActiveVersions,
            schemaIsValid,
            canExport,
            canDeploy,
            deploymentInProgress);

        return new ProjectWorkflowResponseDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            WorkflowState = workflowState,
            CurrentStep = currentStep,
            NextStep = ResolveNextStep(currentStep),
            RecommendedRoute = ResolveRoute(project.Id, currentStep),
            CanImport = canImport,
            CanAnalyze = canAnalyze,
            CanClean = canClean,
            CanBuildSchema = canBuildSchema,
            CanExport = canExport,
            CanDeploy = canDeploy,
            BlockerCodes = blockerCodes,
            BlockingReasons = blockingReasons,
            Datasets = summaries,
            SchemaStatus = design is null ? "None" : schemaMatchesActiveVersions ? design.Status : "Stale",
            LatestDeploymentStatus = latestDeployment?.Status
        };
    }

    private async Task<Project> GetProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0) throw new ArgumentException("ProjectId must be greater than zero.", nameof(projectId));
        return await _context.Projects.AsNoTracking().FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken)
            ?? throw new KeyNotFoundException("Project not found.");
    }

    private async Task<List<DatasetProjection>> GetProjectDatasetsInfoAsync(int projectId, CancellationToken cancellationToken)
    {
        var items = await _context.Datasets
            .AsNoTracking()
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderBy(dataset => dataset.Id)
            .Select(dataset => new
            {
                Id = dataset.Id,
                TableName = dataset.TableName,
                ActiveVersionId = dataset.ActiveVersionId,
                RowCount = dataset.RowCount,
                ColumnCount = dataset.ColumnCount,
                ActiveVersion = dataset.ActiveVersion == null ? null : new
                {
                    Id = dataset.ActiveVersion.Id,
                    IsActive = dataset.ActiveVersion.IsActive,
                    AnalyzedAt = dataset.ActiveVersion.AnalyzedAt,
                    HasAnalysis = dataset.ActiveVersion.AnalysisResultJson != null,
                    IsRawOriginal = dataset.ActiveVersion.IsRawOriginal,
                    VersionNumber = dataset.ActiveVersion.VersionNumber,
                    RowCount = dataset.ActiveVersion.RowCount,
                    ColumnCount = dataset.ActiveVersion.ColumnCount
                },
                ActiveVersionsCount = dataset.Versions.Count(v => v.IsActive),
                WasAnalyzedBefore = dataset.Versions.Any(v => v.Id != dataset.ActiveVersionId && v.AnalyzedAt != null && v.AnalysisResultJson != null)
            })
            .ToListAsync(cancellationToken);

        return items.Select(item => new DatasetProjection(
            item.Id,
            item.TableName,
            item.ActiveVersionId,
            item.RowCount,
            item.ColumnCount,
            item.ActiveVersion == null ? null : new ActiveVersionInfo(
                item.ActiveVersion.Id,
                item.ActiveVersion.IsActive,
                item.ActiveVersion.AnalyzedAt,
                item.ActiveVersion.HasAnalysis,
                item.ActiveVersion.IsRawOriginal,
                item.ActiveVersion.VersionNumber,
                item.ActiveVersion.RowCount,
                item.ActiveVersion.ColumnCount),
            item.ActiveVersionsCount,
            item.WasAnalyzedBefore
        )).ToList();
    }

    private static DatasetEvaluation EvaluateDataset(DatasetProjection item, IReadOnlyDictionary<int, int> confirmedVersions)
    {
        var active = item.ActiveVersion;
        var activeStateIsConsistent = active is not null
            && item.ActiveVersionId == active.Id
            && active.IsActive
            && item.ActiveVersionsCount == 1;
        var hasCurrentAnalysis = activeStateIsConsistent
            && active!.AnalyzedAt.HasValue
            && active.HasAnalysis;
        var isStaleAnalysis = !hasCurrentAnalysis && active is not null
            && (!active.IsRawOriginal || active.VersionNumber > 1 || item.WasAnalyzedBefore);

        return new DatasetEvaluation(
            new ProjectWorkflowDatasetDto
            {
                DatasetId = item.Id,
                DatasetName = item.TableName,
                ActiveVersionId = activeStateIsConsistent ? active!.Id : item.ActiveVersionId,
                ActiveVersionNumber = active?.VersionNumber,
                RowCount = active?.RowCount ?? item.RowCount,
                ColumnCount = active?.ColumnCount ?? item.ColumnCount,
                HasCurrentAnalysis = hasCurrentAnalysis,
                RequiresAnalysis = !hasCurrentAnalysis,
                IsQualityConfirmed = activeStateIsConsistent
                    && confirmedVersions.GetValueOrDefault(item.Id) == active!.Id
            },
            active,
            isStaleAnalysis);
    }

    private static bool SchemaMatchesActiveVersions(DesignModel design, IReadOnlyList<ProjectWorkflowDatasetDto> datasets)
    {
        if (datasets.Count == 0) return false;
        if (design.Tables.Any(table => table.Origin == DesignOrigin.Generated
            && (!table.SourceDatasetId.HasValue || !table.SourceDatasetVersionId.HasValue))) return false;

        var sourcedTables = design.Tables
            .Where(table => table.SourceDatasetId.HasValue && table.SourceDatasetVersionId.HasValue)
            .ToList();
        if (sourcedTables.GroupBy(table => table.SourceDatasetId!.Value).Any(group => group.Count() != 1)) return false;
        var schemaVersions = sourcedTables.ToDictionary(
            table => table.SourceDatasetId!.Value,
            table => table.SourceDatasetVersionId!.Value);
        return schemaVersions.Count == datasets.Count
            && datasets.All(dataset => dataset.ActiveVersionId.HasValue
                && schemaVersions.GetValueOrDefault(dataset.DatasetId) == dataset.ActiveVersionId.Value);
    }

    private static string ResolveState(
        bool hasData,
        bool hasFirstAnalysisRequired,
        bool hasStaleAnalysis,
        bool qualityConfirmed,
        DesignModel? design,
        bool schemaIsValid,
        bool canDeploy,
        bool deployed)
    {
        if (!hasData) return ProjectWorkflowStates.NoData;
        if (hasStaleAnalysis) return ProjectWorkflowStates.NeedsReanalysis;
        if (hasFirstAnalysisRequired) return ProjectWorkflowStates.NeedsAnalysis;
        if (!qualityConfirmed) return ProjectWorkflowStates.Analyzed;
        if (design is null) return ProjectWorkflowStates.ReadyForSchema;
        if (!schemaIsValid) return ProjectWorkflowStates.SchemaDraft;
        if (deployed) return ProjectWorkflowStates.Deployed;
        return canDeploy ? ProjectWorkflowStates.ReadyToDeploy : ProjectWorkflowStates.SchemaValid;
    }

    private static string ResolveCurrentStep(string state) => state switch
    {
        ProjectWorkflowStates.NoData => ProjectWorkflowSteps.Data,
        ProjectWorkflowStates.NeedsAnalysis or ProjectWorkflowStates.NeedsReanalysis => ProjectWorkflowSteps.Analyze,
        ProjectWorkflowStates.Analyzed => ProjectWorkflowSteps.Clean,
        ProjectWorkflowStates.ReadyForSchema or ProjectWorkflowStates.SchemaDraft => ProjectWorkflowSteps.Schema,
        _ => ProjectWorkflowSteps.ExportAndDeploy
    };

    private static string? ResolveNextStep(string currentStep) => currentStep switch
    {
        ProjectWorkflowSteps.Data => ProjectWorkflowSteps.Analyze,
        ProjectWorkflowSteps.Analyze => ProjectWorkflowSteps.Clean,
        ProjectWorkflowSteps.Clean => ProjectWorkflowSteps.Schema,
        ProjectWorkflowSteps.Schema => ProjectWorkflowSteps.ExportAndDeploy,
        _ => null
    };

    private static string ResolveRoute(int projectId, string currentStep) => currentStep switch
    {
        ProjectWorkflowSteps.Data => $"/projects/{projectId}/data",
        ProjectWorkflowSteps.Analyze => $"/projects/{projectId}/analyze",
        ProjectWorkflowSteps.Clean => $"/projects/{projectId}/clean",
        ProjectWorkflowSteps.Schema => $"/projects/{projectId}/schema",
        _ => $"/projects/{projectId}/export-deploy"
    };

    private static (List<string> Codes, List<string> Reasons) BuildBlockers(
        bool hasData,
        bool hasFirstAnalysisRequired,
        bool hasStaleAnalysis,
        bool allAnalyzed,
        bool qualityConfirmed,
        DesignModel? design,
        bool schemaMatchesActiveVersions,
        bool schemaIsValid,
        bool canExport,
        bool canDeploy,
        bool deploymentInProgress)
    {
        var codes = new List<string>();
        var reasons = new List<string>();
        void Add(string code, string reason)
        {
            if (codes.Contains(code, StringComparer.Ordinal)) return;
            codes.Add(code);
            reasons.Add(reason);
        }

        if (!hasData)
        {
            Add("no_data", "Import at least one dataset to begin the workflow.");
            return (codes, reasons);
        }
        if (hasFirstAnalysisRequired) Add("analysis_required", "Analyze every active dataset version before cleaning or building a schema.");
        if (hasStaleAnalysis) Add("analysis_stale", "An active dataset version changed and must be analyzed again.");
        if (design is not null && !schemaMatchesActiveVersions) Add("schema_stale", "The schema references dataset versions that are no longer active.");
        if (!allAnalyzed) return (codes, reasons);
        if (!qualityConfirmed)
        {
            Add("quality_confirmation_required", "Confirm data quality for the exact active dataset versions.");
            return (codes, reasons);
        }
        if (design is null)
        {
            Add("schema_required", "Generate a schema from the confirmed active dataset versions.");
            return (codes, reasons);
        }
        if (!schemaIsValid)
        {
            if (schemaMatchesActiveVersions) Add("schema_invalid", "Complete and validate the schema before export or deployment.");
            return (codes, reasons);
        }
        if (canExport && !canDeploy)
        {
            Add(
                deploymentInProgress ? "deployment_in_progress" : "deployment_not_ready",
                deploymentInProgress
                    ? "A deployment is already running for this project."
                    : "Deployment requirements are not yet satisfied.");
        }
        return (codes, reasons);
    }

    private static Dictionary<int, int> ParseVersionMap(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<int, int>>(json, JsonOptions) ?? new();
        }
        catch (JsonException)
        {
            return new();
        }
    }

    private static void EnsureAllowed(
        string actionName,
        ProjectWorkflowResponseDto workflow,
        Func<ProjectWorkflowResponseDto, bool> predicate)
    {
        if (!predicate(workflow)) throw new ProjectWorkflowBlockedException(actionName, workflow);
    }

    private sealed record ActiveVersionInfo(
        int Id,
        bool IsActive,
        DateTime? AnalyzedAt,
        bool HasAnalysis,
        bool IsRawOriginal,
        int VersionNumber,
        int RowCount,
        int ColumnCount);

    private sealed record DatasetProjection(
        int Id,
        string TableName,
        int? ActiveVersionId,
        int RowCount,
        int ColumnCount,
        ActiveVersionInfo? ActiveVersion,
        int ActiveVersionsCount,
        bool WasAnalyzedBefore);

    private sealed record DatasetEvaluation(
        ProjectWorkflowDatasetDto Summary,
        ActiveVersionInfo? ActiveVersion,
        bool IsStaleAnalysis);
}
