using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class DeploymentRepository : IDeploymentRepository
{
    private readonly ForgeDbContext _context;

    public DeploymentRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<DatabaseDeployment?> GetByIdAsync(int deploymentId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(DatabaseDeployment deployment, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
