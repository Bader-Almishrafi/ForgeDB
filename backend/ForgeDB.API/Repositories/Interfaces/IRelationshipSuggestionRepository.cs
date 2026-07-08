using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IRelationshipSuggestionRepository
{
    Task<List<RelationshipSuggestion>> GetByProjectIdAsync(int projectId, string? status, CancellationToken cancellationToken = default);
    Task<RelationshipSuggestion?> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<RelationshipSuggestion?> FindByKeyAsync(
        int projectId,
        int sourceDatasetId,
        string sourceColumnName,
        int targetDatasetId,
        string targetColumnName,
        CancellationToken cancellationToken = default);
    /// <summary>Tracks the suggestion as a pending insert without saving — callers that add many
    /// suggestions in a loop (e.g. detection) should call SaveChangesAsync once afterward so they
    /// all commit in a single transaction instead of one round trip each.</summary>
    void Add(RelationshipSuggestion suggestion);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
