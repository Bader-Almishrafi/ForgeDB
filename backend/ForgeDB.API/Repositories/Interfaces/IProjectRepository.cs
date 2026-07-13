using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IProjectRepository
{
    Task<Project?> GetByIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task<Project?> GetByIdWithWorkspaceAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Project>> GetByUserIdAsync(int userId, CancellationToken cancellationToken = default);
    Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken = default);
    Task AddAsync(Project project, CancellationToken cancellationToken = default);
    Task UpdateDashboardConfigAsync(int projectId, string dashboardConfig, DateTime updatedAt, CancellationToken cancellationToken = default);
    Task DeleteAsync(int projectId, CancellationToken cancellationToken = default);
}
