using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class ProjectRepository : IProjectRepository
{
    public Task<Project?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<Project>> GetByUserIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(Project project, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
