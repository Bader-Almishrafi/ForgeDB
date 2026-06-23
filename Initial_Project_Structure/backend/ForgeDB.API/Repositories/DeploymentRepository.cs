using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class DeploymentRepository : IDeploymentRepository
{
    public Task<DatabaseDeployment?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<DatabaseDeployment>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(DatabaseDeployment deployment, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
