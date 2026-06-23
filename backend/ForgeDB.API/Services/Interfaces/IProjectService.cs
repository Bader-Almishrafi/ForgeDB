using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IProjectService
{
    Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default);
    Task<ProjectResponseDto?> GetProjectByIdAsync(int projectId, CancellationToken cancellationToken = default);
}
