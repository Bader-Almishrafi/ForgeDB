using System.Text.Json;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Services;

public sealed class ProjectWorkflowService : IProjectWorkflowService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ForgeDbContext _context;

    public ProjectWorkflowService(ForgeDbContext context)
    {
        _context = context;
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
        var datasets = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.ActiveVersion)
            .Include(dataset => dataset.Versions)
            .Where(dataset => dataset.ProjectId == project.Id)
            .OrderBy(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
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
        var evaluations = datasets.Select(dataset => EvaluateDataset(dataset, confirmedVersions)).ToList();
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
        var allVersionsDeployable = evaluations.All(item => item.ActiveVersion is { IsRawOriginal: false });
        var deploymentInProgress = latestDeployment?.Status == DeploymentStatus.Running;

        var canImport = true;
        var canAnalyze = hasData;
        var canClean = allAnalyzed;
        var canBuildSchema = allAnalyzed && qualityConfirmed;
        var canExport = canBuildSchema && schemaIsValid;
        var canDeploy = canExport && allVersionsDeployable && !deploymentInProgress;
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
            deploymentInProgress,
            allVersionsDeployable);

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

    private static DatasetEvaluation EvaluateDataset(Dataset dataset, IReadOnlyDictionary<int, int> confirmedVersions)
    {
        var active = dataset.ActiveVersion;
        var activeStateIsConsistent = active is not null
            && dataset.ActiveVersionId == active.Id
            && active.IsActive
            && dataset.Versions.Count(version => version.IsActive) == 1;
        var hasCurrentAnalysis = activeStateIsConsistent
            && active!.AnalyzedAt.HasValue
            && !string.IsNullOrWhiteSpace(active.AnalysisResultJson);
        var wasAnalyzedBefore = dataset.Versions.Any(version => version.Id != active?.Id
            && version.AnalyzedAt.HasValue
            && !string.IsNullOrWhiteSpace(version.AnalysisResultJson));
        var isStaleAnalysis = !hasCurrentAnalysis && active is not null
            && (!active.IsRawOriginal || active.VersionNumber > 1 || wasAnalyzedBefore);

        return new DatasetEvaluation(
            new ProjectWorkflowDatasetDto
            {
                DatasetId = dataset.Id,
                DatasetName = dataset.TableName,
                ActiveVersionId = activeStateIsConsistent ? active!.Id : dataset.ActiveVersionId,
                ActiveVersionNumber = active?.VersionNumber,
                RowCount = active?.RowCount ?? dataset.RowCount,
                ColumnCount = active?.ColumnCount ?? dataset.ColumnCount,
                HasCurrentAnalysis = hasCurrentAnalysis,
                RequiresAnalysis = !hasCurrentAnalysis,
                IsQualityConfirmed = activeStateIsConsistent
                    && confirmedVersions.GetValueOrDefault(dataset.Id) == active!.Id
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
        bool deploymentInProgress,
        bool allVersionsDeployable)
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
            var reason = deploymentInProgress
                ? "A deployment is already running for this project."
                : allVersionsDeployable
                    ? "Deployment requirements are not yet satisfied."
                    : "Deployment requires analyzed active cleaned versions rather than raw imports.";
            Add("deployment_not_ready", reason);
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

    private sealed record DatasetEvaluation(
        ProjectWorkflowDatasetDto Summary,
        DatasetVersion? ActiveVersion,
        bool IsStaleAnalysis);
}
