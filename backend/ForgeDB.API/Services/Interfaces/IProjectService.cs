using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

// Defines Project business use cases independently of HTTP controllers and EF Core repositories;
// CancellationToken is passed through each asynchronous boundary to stop abandoned request work.
public interface IProjectService
{
    // Validates and persists a new project, then returns its API representation.
    Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default);
    // Returns one mapped project or null when it does not exist.
    Task<ProjectResponseDto?> GetProjectByIdAsync(int projectId, CancellationToken cancellationToken = default);
    // Returns null for a missing user and a possibly empty list for an existing user.
    Task<IReadOnlyList<ProjectResponseDto>?> GetProjectsByUserIdAsync(int userId, CancellationToken cancellationToken = default);
    // Aggregates datasets and downstream workflow progress for the overview page.
    Task<ProjectOverviewDto> GetProjectOverviewAsync(int projectId, CancellationToken cancellationToken = default);
    // Builds generated schema artifacts and supporting reports for export.
    Task<ProjectExportPackageDto> GetProjectExportPackageAsync(int projectId, CancellationToken cancellationToken = default);
    // Applies editable details and returns null when the project is absent.
    Task<ProjectResponseDto?> UpdateProjectAsync(int projectId, ProjectUpdateDto request, CancellationToken cancellationToken = default);
    // Returns false when no project was available to delete.
    Task<bool> DeleteProjectAsync(int projectId, CancellationToken cancellationToken = default);
}
