using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

// Defines Project business use cases independently of HTTP controllers and EF Core repositories;
// CancellationToken is passed through each asynchronous boundary to stop abandoned request work.
public interface IProjectService
{
    Task<IReadOnlyList<ProjectSummaryDto>> GetProjectsAsync(int userId, CancellationToken cancellationToken = default);
    Task<ProjectDetailsDto> CreateProjectAsync(int userId, ProjectCreateRequestDto request, CancellationToken cancellationToken = default);
    Task<ProjectDetailsDto> GetProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<ProjectDetailsDto> UpdateProjectAsync(int projectId, int userId, ProjectUpdateRequestDto request, CancellationToken cancellationToken = default);
    Task<bool> DeleteProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    // Aggregates datasets and downstream workflow progress for the overview page.
    Task<ProjectOverviewDto> GetProjectOverviewAsync(int projectId, CancellationToken cancellationToken = default);
    // Builds generated schema artifacts and supporting reports for export.
    Task<ProjectExportPackageDto> GetProjectExportPackageAsync(int projectId, CancellationToken cancellationToken = default);
}
