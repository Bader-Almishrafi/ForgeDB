using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

// Defines Project persistence operations independently of EF Core. The return contracts preserve
// intentional distinctions: null for a missing entity, false for an operation that changed no row,
// and exceptions where a caller treats absence as an invalid state.
public interface IProjectRepository
{
    // Lightweight Project lookup without workspace collections.
    Task<Project?> GetByIdAsync(int projectId, CancellationToken cancellationToken = default);
    // Project lookup with datasets, columns, and rows for aggregation/export work.
    Task<Project?> GetByIdWithWorkspaceAsync(int projectId, CancellationToken cancellationToken = default);
    // Ordered project collection for an existing owner.
    Task<IReadOnlyList<Project>> GetByUserIdAsync(int userId, CancellationToken cancellationToken = default);
    // Checks the foreign-key owner before project creation or listing.
    Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken = default);
    // Persists a new entity and its generated ID.
    Task AddAsync(Project project, CancellationToken cancellationToken = default);
    // Persists generated dashboard configuration or throws when the project is missing.
    Task UpdateDashboardConfigAsync(int projectId, string dashboardConfig, DateTime updatedAt, CancellationToken cancellationToken = default);
    // Updates editable details and returns null for a missing project.
    Task<Project?> UpdateDetailsAsync(int projectId, string name, string? description, DateTime updatedAt, CancellationToken cancellationToken = default);
    // Deletes a project and reports whether a row was found.
    Task<bool> DeleteAsync(int projectId, CancellationToken cancellationToken = default);
}
