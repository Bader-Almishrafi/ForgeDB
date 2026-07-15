using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IRelationshipDetectionService
{
    Task<List<RelationshipSuggestionResponseDto>> GetSuggestionsAsync(int projectId, string? status, CancellationToken cancellationToken = default);
    Task<List<RelationshipSuggestionResponseDto>> DetectAsync(int projectId, CancellationToken cancellationToken = default);
    Task<AcceptSuggestionResponseDto> AcceptAsync(int suggestionId, int ifMatchRevision, AcceptSuggestionRequestDto? request, CancellationToken cancellationToken = default);
    Task<RelationshipSuggestionResponseDto> RejectAsync(int suggestionId, CancellationToken cancellationToken = default);
}
