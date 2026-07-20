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
            var datasets = await _context.Datasets
                .Where(dataset => dataset.ProjectId == projectId)
                .ToListAsync(cancellationToken);
            var datasetIds = datasets.Select(dataset => dataset.Id).ToList();
            var versions = await _context.DatasetVersions
                .Where(version => datasetIds.Contains(version.DatasetId))
                .ToListAsync(cancellationToken);
            var batches = await _context.CleaningBatches
                .Where(batch => batch.ProjectId == projectId)
                .ToListAsync(cancellationToken);
            var batchIds = batches.Select(batch => batch.Id).ToList();
            var designModels = await _context.DesignModels
                .Where(design => design.ProjectId == projectId)
                .ToListAsync(cancellationToken);
            var designIds = designModels.Select(design => design.Id).ToList();
            var designTables = await _context.DesignTables
                .Where(table => designIds.Contains(table.DesignModelId))
                .ToListAsync(cancellationToken);
            var designTableIds = designTables.Select(table => table.Id).ToList();
            var designColumns = await _context.DesignColumns
                .Where(column => designTableIds.Contains(column.DesignTableId))
                .ToListAsync(cancellationToken);

            var designRelationships = await _context.DesignRelationships
                .Where(relationship => designIds.Contains(relationship.DesignModelId))
                .ToListAsync(cancellationToken);
            var suggestions = await _context.RelationshipSuggestions
                .Where(suggestion => suggestion.ProjectId == projectId)
                .ToListAsync(cancellationToken);
            var operations = await _context.CleaningOperations
                .Where(operation => batchIds.Contains(operation.CleaningBatchId)
                    || datasetIds.Contains(operation.DatasetId))
                .ToListAsync(cancellationToken);
            var cleaningState = await _context.ProjectCleaningStates
                .FirstOrDefaultAsync(state => state.ProjectId == projectId, cancellationToken);
            var deployments = await _context.Deployments
                .Where(deployment => deployment.ProjectId == projectId)
                .ToListAsync(cancellationToken);

            _context.DesignRelationships.RemoveRange(designRelationships);
            _context.RelationshipSuggestions.RemoveRange(suggestions);
            _context.CleaningOperations.RemoveRange(operations);
            if (cleaningState is not null) _context.ProjectCleaningStates.Remove(cleaningState);
            _context.Deployments.RemoveRange(deployments);

            foreach (var dataset in datasets)
            {
                dataset.ActiveVersionId = null;
                dataset.ActiveVersion = null;
            }

            foreach (var version in versions)
            {
                version.ParentVersionId = null;
                version.ParentVersion = null;
                version.CleaningBatchId = null;
                version.CleaningBatch = null;
            }

            await _context.SaveChangesAsync(cancellationToken);

            _context.DesignColumns.RemoveRange(designColumns);
            _context.DesignTables.RemoveRange(designTables);
            _context.DesignModels.RemoveRange(designModels);
            _context.CleaningBatches.RemoveRange(batches);
            await _context.SaveChangesAsync(cancellationToken);

            var rows = await _context.DatasetRows
                .Where(row => datasetIds.Contains(row.DatasetId))
                .ToListAsync(cancellationToken);
            var columns = await _context.DatasetColumns
                .Where(column => datasetIds.Contains(column.DatasetId))
                .ToListAsync(cancellationToken);
            _context.DatasetRows.RemoveRange(rows);
            _context.DatasetColumns.RemoveRange(columns);
            _context.DatasetVersions.RemoveRange(versions);
            _context.Datasets.RemoveRange(datasets);
            await _context.SaveChangesAsync(cancellationToken);

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
