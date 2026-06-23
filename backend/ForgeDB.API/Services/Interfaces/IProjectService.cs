using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IProjectService
{
    Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default);
    Task<ProjectResponseDto?> GetProjectByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<IEnumerable<ProjectResponseDto>> GetProjectsByUserIdAsync(int userId, CancellationToken cancellationToken = default);
}
