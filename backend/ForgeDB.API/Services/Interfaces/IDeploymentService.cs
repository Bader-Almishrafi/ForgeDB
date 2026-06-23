using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IDeploymentService
{
    Task<DeploymentResponseDto> DeploySchemaAsync(int schemaId, DeploymentRequestDto request, CancellationToken cancellationToken = default);
}
