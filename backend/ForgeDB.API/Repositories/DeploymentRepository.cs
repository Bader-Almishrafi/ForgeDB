using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

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
        return _context.DatabaseDeployments
            .AsNoTracking()
            .FirstOrDefaultAsync(deployment => deployment.Id == deploymentId, cancellationToken);
    }

    public async Task AddAsync(DatabaseDeployment deployment, CancellationToken cancellationToken = default)
    {
        await _context.DatabaseDeployments.AddAsync(deployment, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }
}
