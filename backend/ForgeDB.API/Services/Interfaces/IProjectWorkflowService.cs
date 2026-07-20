using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IProjectWorkflowService
{
    Task<ProjectWorkflowResponseDto> GetWorkflowAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<ProjectWorkflowResponseDto> EvaluateAsync(int projectId, CancellationToken cancellationToken = default);
    Task EnsureCanCleanAsync(int projectId, CancellationToken cancellationToken = default);
    Task EnsureCanBuildSchemaAsync(int projectId, CancellationToken cancellationToken = default);
    Task EnsureCanExportAsync(int projectId, CancellationToken cancellationToken = default);
    Task EnsureCanDeployAsync(int projectId, CancellationToken cancellationToken = default);
}
