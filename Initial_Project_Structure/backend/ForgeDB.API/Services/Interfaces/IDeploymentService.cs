using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDeploymentService
{
    Task<DeploymentResponseDto> DeploySchemaAsync(DeploymentRequestDto request, CancellationToken cancellationToken = default);
    Task<IEnumerable<DeploymentResponseDto>> GetProjectDeploymentsAsync(int projectId, CancellationToken cancellationToken = default);
}
