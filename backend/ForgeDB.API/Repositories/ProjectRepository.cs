using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

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

    // Returns false when no row exists; otherwise Remove marks it Deleted and SaveChangesAsync
    // executes the SQL DELETE (including configured relational cascade behavior).
    public async Task<bool> DeleteAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var project = await _context.Projects
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);

        if (project is null)
        {
            return false;
        }

        _context.Projects.Remove(project);
        await _context.SaveChangesAsync(cancellationToken);
        return true;
    }
}
