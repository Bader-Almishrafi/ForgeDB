using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

public class DesignRepository : IDesignRepository
{
    private readonly ForgeDbContext _context;

    public DesignRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public async Task<DesignModel?> GetFullByIdAsync(int designModelId, bool track, CancellationToken cancellationToken = default)
    {
        return await Query(track).FirstOrDefaultAsync(design => design.Id == designModelId, cancellationToken);
    }

    public async Task<DesignModel?> GetFullByProjectIdAsync(int projectId, bool track, CancellationToken cancellationToken = default)
    {
        return await Query(track).FirstOrDefaultAsync(design => design.ProjectId == projectId, cancellationToken);
    }

    public Task<int?> FindDesignModelIdByTableIdAsync(int tableId, CancellationToken cancellationToken = default)
    {
        return _context.DesignTables
            .AsNoTracking()
            .Where(table => table.Id == tableId)
            .Select(table => (int?)table.DesignModelId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public Task<int?> FindDesignModelIdByColumnIdAsync(int columnId, CancellationToken cancellationToken = default)
    {
        return _context.DesignColumns
            .AsNoTracking()
            .Include(column => column.DesignTable)
            .Where(column => column.Id == columnId)
            .Select(column => (int?)column.DesignTable!.DesignModelId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public Task<int?> FindDesignModelIdByRelationshipIdAsync(int relationshipId, CancellationToken cancellationToken = default)
    {
        return _context.DesignRelationships
            .AsNoTracking()
            .Where(relationship => relationship.Id == relationshipId)
            .Select(relationship => (int?)relationship.DesignModelId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task AddAsync(DesignModel design, CancellationToken cancellationToken = default)
    {
        await _context.DesignModels.AddAsync(design, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<T> ExecuteInTransactionAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken = default)
    {
        // The InMemory provider used by focused unit tests has no transaction implementation.
        // PostgreSQL uses an explicit transaction so suggestion state, relationship creation,
        // and the design revision form one read/validate/write atomic boundary.
        if (!_context.Database.IsRelational())
        {
            return await operation();
        }

        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var result = await operation();
            await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public void ClearTracking() => _context.ChangeTracker.Clear();

    private IQueryable<DesignModel> Query(bool track)
    {
        IQueryable<DesignModel> query = _context.DesignModels
            .Include(design => design.Project)
            .Include(design => design.LastModifiedByUser)
            .Include(design => design.Tables)
                .ThenInclude(table => table.Columns)
            .Include(design => design.Tables)
                .ThenInclude(table => table.SourceDataset)
            .Include(design => design.Tables)
                .ThenInclude(table => table.SourceDatasetVersion)
            .Include(design => design.Relationships)
                .ThenInclude(relationship => relationship.FromColumn)
                    .ThenInclude(column => column!.DesignTable)
            .Include(design => design.Relationships)
                .ThenInclude(relationship => relationship.ToColumn)
                    .ThenInclude(column => column!.DesignTable)
            .AsSplitQuery();

        return track ? query : query.AsNoTracking();
    }
}
