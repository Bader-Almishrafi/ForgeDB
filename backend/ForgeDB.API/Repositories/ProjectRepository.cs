using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class ProjectRepository : IProjectRepository
{
    private readonly ForgeDbContext _context;

    public ProjectRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<Project?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(Project project, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
