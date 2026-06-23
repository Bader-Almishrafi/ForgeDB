using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DeploymentService : IDeploymentService
{
    private readonly IDeploymentRepository _deploymentRepository;

    public DeploymentService(IDeploymentRepository deploymentRepository)
    {
        _deploymentRepository = deploymentRepository;
    }

    public Task<DeploymentResponseDto> DeploySchemaAsync(int schemaId, DeploymentRequestDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
