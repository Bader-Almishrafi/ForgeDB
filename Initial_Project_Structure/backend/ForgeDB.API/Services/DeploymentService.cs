using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DeploymentService : IDeploymentService
{
    public Task<DeploymentResponseDto> DeploySchemaAsync(DeploymentRequestDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<DeploymentResponseDto>> GetProjectDeploymentsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
