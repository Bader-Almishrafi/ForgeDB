using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IDeploymentRepository
{
    Task<DatabaseDeployment?> GetByIdAsync(int deploymentId, CancellationToken cancellationToken = default);
    Task AddAsync(DatabaseDeployment deployment, CancellationToken cancellationToken = default);
}
