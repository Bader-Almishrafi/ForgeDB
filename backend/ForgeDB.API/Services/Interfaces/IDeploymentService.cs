using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDeploymentService
{
    Task<DeploymentResponseDto> DeployAsync(int projectId, int userId, int ifMatchRevision, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DeploymentResponseDto>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DeploymentResponseDto?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default);
}
