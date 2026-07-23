using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace ForgeDB.API.Repositories;

// Owns direct EF Core access to Project records in PostgreSQL. It translates persistence needs
// into focused queries and commands while leaving validation and business decisions to services.
public class ProjectRepository : IProjectRepository
{
    private readonly ForgeDbContext _context;

    public ProjectRepository(ForgeDbContext context)
    {
        _context = context;
    }

    // Uses AsNoTracking for a read-only lookup so EF Core does not allocate change-tracking state
    // for an entity that will only be inspected or mapped.
    public Task<Project?> GetByIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return _context.Projects
            .AsNoTracking()
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);
    }

    // Loads a Project plus dataset columns and rows for workspace calculations. Include selects
    // related collections, ThenInclude continues through Dataset, and AsSplitQuery avoids one
    // large Cartesian joined result when loading several collection paths.
    public Task<Project?> GetByIdWithWorkspaceAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return _context.Projects
            .AsNoTracking()
            .AsSplitQuery()
            .Include(project => project.Datasets.OrderByDescending(dataset => dataset.CreatedAt))
                .ThenInclude(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(project => project.Datasets.OrderByDescending(dataset => dataset.CreatedAt))
                .ThenInclude(dataset => dataset.Rows.OrderBy(row => row.RowNumber).ThenBy(row => row.Id))
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);
    }

    // Returns an ordered, read-only list for one user; an existing user with no projects produces
    // an empty list rather than null.
    public async Task<IReadOnlyList<Project>> GetByUserIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        return await _context.Projects
            .AsNoTracking()
            .Where(project => project.UserId == userId)
            .OrderByDescending(project => project.CreatedAt)
            .ThenByDescending(project => project.Id)
            .ToListAsync(cancellationToken);
    }

    // Performs an efficient existence query without materializing or tracking a User entity.
    public Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken = default)
    {
        return _context.Users
            .AsNoTracking()
            .AnyAsync(user => user.Id == userId, cancellationToken);
    }

    // AddAsync marks the entity as Added in EF Core; SaveChangesAsync executes the SQL INSERT.
    // PostgreSQL's generated project ID is populated back onto the entity after the save.
    public async Task AddAsync(Project project, CancellationToken cancellationToken = default)
    {
        await _context.Projects.AddAsync(project, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    // Updates tracked dashboard state and throws when absence is exceptional for the caller's flow.
    public async Task UpdateDashboardConfigAsync(int projectId, string dashboardConfig, DateTime updatedAt, CancellationToken cancellationToken = default)
    {
        var project = await _context.Projects
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);

        if (project is null)
        {
            throw new KeyNotFoundException("Project not found.");
        }

        project.DashboardConfig = dashboardConfig;
        project.UpdatedAt = updatedAt;

        await _context.SaveChangesAsync(cancellationToken);
    }

    // Returns null when no row can be edited, allowing the service/controller to report 404
    // without using an exception for this expected lookup outcome.
    public async Task<Project?> UpdateDetailsAsync(int projectId, string name, string? description, DateTime updatedAt, CancellationToken cancellationToken = default)
    {
        var project = await _context.Projects
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);

        if (project is null)
        {
            return null;
        }

        project.Name = name;
        project.Description = description;
        project.UpdatedAt = updatedAt;

        await _context.SaveChangesAsync(cancellationToken);
        return project;
    }

    // Restrict relationships from cleaning operations, version ancestry, suggestions, and design
    // relationships make a blind project delete unsafe. Remove those edges explicitly and keep
    // all phases atomic on relational providers.
    public async Task<bool> DeleteAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await _context.Projects
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);

        if (project is null)
        {
            return false;
        }

        IDbContextTransaction? transaction = _context.Database.IsRelational()
            ? await _context.Database.BeginTransactionAsync(cancellationToken)
            : null;

        try
        {
            var datasetsQuery = _context.Datasets.Where(d => d.ProjectId == projectId);
            var datasetIdsQuery = datasetsQuery.Select(d => d.Id);
            var batchIdsQuery = _context.CleaningBatches.Where(b => b.ProjectId == projectId).Select(b => b.Id);
            var designIdsQuery = _context.DesignModels.Where(m => m.ProjectId == projectId).Select(m => m.Id);
            var designTableIdsQuery = _context.DesignTables.Where(t => designIdsQuery.Contains(t.DesignModelId)).Select(t => t.Id);

            // Remove leaf dependencies first to avoid constraint violations
            await _context.DesignRelationships.Where(r => designIdsQuery.Contains(r.DesignModelId)).ExecuteDeleteAsync(cancellationToken);
            await _context.RelationshipSuggestions.Where(s => s.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);
            await _context.CleaningOperations.Where(o => batchIdsQuery.Contains(o.CleaningBatchId) || datasetIdsQuery.Contains(o.DatasetId)).ExecuteDeleteAsync(cancellationToken);
            await _context.ProjectCleaningStates.Where(s => s.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);
            await _context.Deployments.Where(d => d.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);

            // Break circular/self-referencing dependencies via ExecuteUpdate
            await datasetsQuery.ExecuteUpdateAsync(s => s.SetProperty(d => d.ActiveVersionId, (int?)null), cancellationToken);
            
            await _context.DatasetVersions.Where(v => datasetIdsQuery.Contains(v.DatasetId))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(v => v.ParentVersionId, (int?)null)
                    .SetProperty(v => v.CleaningBatchId, (int?)null), cancellationToken);

            // Delete schema definitions
            await _context.DesignColumns.Where(c => designTableIdsQuery.Contains(c.DesignTableId)).ExecuteDeleteAsync(cancellationToken);
            await _context.DesignTables.Where(t => designIdsQuery.Contains(t.DesignModelId)).ExecuteDeleteAsync(cancellationToken);
            await _context.DesignModels.Where(m => m.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);
            
            // Delete cleaning batches
            await _context.CleaningBatches.Where(b => b.ProjectId == projectId).ExecuteDeleteAsync(cancellationToken);

            // Bulk delete all massive data rows and columns directly in database
            await _context.DatasetRows.Where(r => datasetIdsQuery.Contains(r.DatasetId)).ExecuteDeleteAsync(cancellationToken);
            await _context.DatasetColumns.Where(c => datasetIdsQuery.Contains(c.DatasetId)).ExecuteDeleteAsync(cancellationToken);
            
            // Delete versions, then datasets
            await _context.DatasetVersions.Where(v => datasetIdsQuery.Contains(v.DatasetId)).ExecuteDeleteAsync(cancellationToken);
            await datasetsQuery.ExecuteDeleteAsync(cancellationToken);

            // Delete the project entity
            _context.Projects.Remove(project);
            await _context.SaveChangesAsync(cancellationToken);

            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();
        }
    }
}
