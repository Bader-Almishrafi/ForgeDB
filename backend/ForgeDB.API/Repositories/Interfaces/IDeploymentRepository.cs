using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IDeploymentRepository
{
    Task<DatabaseDeployment?> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<IEnumerable<DatabaseDeployment>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task AddAsync(DatabaseDeployment deployment, CancellationToken cancellationToken = default);
}
