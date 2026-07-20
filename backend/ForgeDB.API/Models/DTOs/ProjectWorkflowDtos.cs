namespace ForgeDB.API.Models.DTOs;

public static class ProjectWorkflowStates
{
    public const string NoData = "NoData";
    public const string NeedsAnalysis = "NeedsAnalysis";
    public const string Analyzed = "Analyzed";
    public const string NeedsReanalysis = "NeedsReanalysis";
    public const string ReadyForSchema = "ReadyForSchema";
    public const string SchemaDraft = "SchemaDraft";
    public const string SchemaValid = "SchemaValid";
    public const string ReadyToDeploy = "ReadyToDeploy";
    public const string Deployed = "Deployed";
}

public static class ProjectWorkflowSteps
{
    public const string Data = "Data";
    public const string Analyze = "Analyze";
    public const string Clean = "Clean";
    public const string Schema = "Schema";
    public const string ExportAndDeploy = "Export & Deploy";
}

public sealed class ProjectWorkflowResponseDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public string WorkflowState { get; set; } = ProjectWorkflowStates.NoData;
    public string CurrentStep { get; set; } = ProjectWorkflowSteps.Data;
    public string? NextStep { get; set; }
    public string RecommendedRoute { get; set; } = string.Empty;
    public bool CanImport { get; set; }
    public bool CanAnalyze { get; set; }
    public bool CanClean { get; set; }
    public bool CanBuildSchema { get; set; }
    public bool CanExport { get; set; }
    public bool CanDeploy { get; set; }
    public List<string> BlockerCodes { get; set; } = new();
    public List<string> BlockingReasons { get; set; } = new();
    public List<ProjectWorkflowDatasetDto> Datasets { get; set; } = new();
    public string SchemaStatus { get; set; } = "None";
    public string? LatestDeploymentStatus { get; set; }
}

public sealed class ProjectWorkflowDatasetDto
{
    public int DatasetId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public int? ActiveVersionId { get; set; }
    public int? ActiveVersionNumber { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public bool HasCurrentAnalysis { get; set; }
    public bool RequiresAnalysis { get; set; }
    public bool IsQualityConfirmed { get; set; }
}
