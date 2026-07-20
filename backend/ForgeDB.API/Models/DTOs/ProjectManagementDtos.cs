namespace ForgeDB.API.Models.DTOs;

public class ProjectCreateRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class ProjectUpdateRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class ProjectSummaryDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string WorkflowState { get; set; } = ProjectWorkflowStates.NoData;
    public string CurrentStep { get; set; } = ProjectWorkflowSteps.Data;
    public string RecommendedRoute { get; set; } = string.Empty;
    public int DatasetsCount { get; set; }
}

public sealed class ProjectDetailsDto : ProjectSummaryDto
{
}
