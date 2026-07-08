using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

public class RelationshipSuggestionRepository : IRelationshipSuggestionRepository
{
    private readonly ForgeDbContext _context;

    public RelationshipSuggestionRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public async Task<List<RelationshipSuggestion>> GetByProjectIdAsync(int projectId, string? status, CancellationToken cancellationToken = default)
    {
        var query = _context.RelationshipSuggestions
            .AsNoTracking()
            .Include(suggestion => suggestion.SourceDataset)
            .Include(suggestion => suggestion.TargetDataset)
            .Where(suggestion => suggestion.ProjectId == projectId);

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(suggestion => suggestion.Status == status);
        }

        return await query
            .OrderByDescending(suggestion => suggestion.Status == "accepted")
            .ThenByDescending(suggestion => suggestion.Score)
            .ToListAsync(cancellationToken);
    }

    public Task<RelationshipSuggestion?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _context.RelationshipSuggestions
            .Include(suggestion => suggestion.SourceDataset)
            .Include(suggestion => suggestion.TargetDataset)
            .FirstOrDefaultAsync(suggestion => suggestion.Id == id, cancellationToken);
    }

    public Task<RelationshipSuggestion?> FindByKeyAsync(
        int projectId,
        int sourceDatasetId,
        string sourceColumnName,
        int targetDatasetId,
        string targetColumnName,
        CancellationToken cancellationToken = default)
    {
        return _context.RelationshipSuggestions.FirstOrDefaultAsync(
            suggestion => suggestion.ProjectId == projectId
                && suggestion.SourceDatasetId == sourceDatasetId
                && suggestion.SourceColumnName == sourceColumnName
                && suggestion.TargetDatasetId == targetDatasetId
                && suggestion.TargetColumnName == targetColumnName,
            cancellationToken);
    }

    public void Add(RelationshipSuggestion suggestion)
    {
        _context.RelationshipSuggestions.Add(suggestion);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _context.SaveChangesAsync(cancellationToken);
    }
}
