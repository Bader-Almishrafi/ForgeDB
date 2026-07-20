using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDeploymentService
{
    Task<DeploymentPreviewDto> GetPreviewAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<DeploymentResponseDto> DeployAsync(int projectId, int userId, int ifMatchRevision, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DeploymentResponseDto>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DeploymentResponseDto?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default);
    Task<DeploymentResponseDto?> GetAsync(int projectId, int deploymentId, CancellationToken cancellationToken = default);
    Task<DeploymentSqlFileDto?> GetSqlFileAsync(int projectId, int deploymentId, string fileName, CancellationToken cancellationToken = default);
}
