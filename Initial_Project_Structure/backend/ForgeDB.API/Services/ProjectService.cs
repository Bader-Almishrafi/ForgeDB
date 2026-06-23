using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class ProjectService : IProjectService
{
    private readonly IProjectRepository _projectRepository;

    public ProjectService(IProjectRepository projectRepository)
    {
        _projectRepository = projectRepository;
    }

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
