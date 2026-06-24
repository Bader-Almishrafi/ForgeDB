using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IProjectRepository
{
    Task<Project?> GetByIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task AddAsync(Project project, CancellationToken cancellationToken = default);
}
