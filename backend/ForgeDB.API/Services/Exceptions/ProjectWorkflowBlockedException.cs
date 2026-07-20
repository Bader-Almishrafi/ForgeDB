using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Exceptions;

public sealed class ProjectWorkflowBlockedException : InvalidOperationException
{
    public string ActionName { get; }
    public IReadOnlyList<string> BlockerCodes { get; }

    public ProjectWorkflowBlockedException(string actionName, ProjectWorkflowResponseDto workflow)
        : base(workflow.BlockingReasons.FirstOrDefault() ?? $"The project is not ready to {actionName}.")
    {
        ActionName = actionName;
        BlockerCodes = workflow.BlockerCodes;
    }
}
