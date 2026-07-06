using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IProjectService
{
    Task<ProjectResponseDto> CreateProjectAsync(ProjectCreateDto request, CancellationToken cancellationToken = default);
    Task<ProjectResponseDto?> GetProjectByIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectResponseDto>?> GetProjectsByUserIdAsync(int userId, CancellationToken cancellationToken = default);
    Task<ProjectOverviewDto> GetProjectOverviewAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> GetRelationshipSuggestionsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> AcceptRelationshipAsync(int projectId, ProjectRelationshipDecisionDto request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ProjectRelationshipSuggestionDto>> RejectRelationshipAsync(int projectId, ProjectRelationshipDecisionDto request, CancellationToken cancellationToken = default);
    Task<ProjectSchemaDto> GetProjectSchemaAsync(int projectId, CancellationToken cancellationToken = default);
    Task<ProjectSchemaDto> GenerateProjectSchemaAsync(int projectId, CancellationToken cancellationToken = default);
    Task<ProjectExportPackageDto> GetProjectExportPackageAsync(int projectId, CancellationToken cancellationToken = default);
}
