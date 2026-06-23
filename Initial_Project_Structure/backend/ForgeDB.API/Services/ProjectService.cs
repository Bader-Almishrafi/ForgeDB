using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class ProjectService : IProjectService
{
    public Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<ProjectResponseDto?> GetProjectByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<ProjectResponseDto>> GetProjectsByUserIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
