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
    Task AddAsync(RelationshipSuggestion suggestion, CancellationToken cancellationToken = default);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
