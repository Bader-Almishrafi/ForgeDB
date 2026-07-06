using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

public class ProjectRepository : IProjectRepository
{
    private readonly ForgeDbContext _context;

    public ProjectRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<Project?> GetByIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return _context.Projects
            .AsNoTracking()
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);
    }

    public Task<Project?> GetByIdWithWorkspaceAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return _context.Projects
            .AsNoTracking()
            .AsSplitQuery()
            .Include(project => project.Datasets.OrderByDescending(dataset => dataset.CreatedAt))
                .ThenInclude(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(project => project.Datasets.OrderByDescending(dataset => dataset.CreatedAt))
                .ThenInclude(dataset => dataset.Rows.OrderBy(row => row.RowNumber).ThenBy(row => row.Id))
            .Include(project => project.DatabaseSchemas.OrderByDescending(schema => schema.CreatedAt))
            .FirstOrDefaultAsync(project => project.Id == projectId, cancellationToken);
    }

    public async Task<IReadOnlyList<Project>> GetByUserIdAsync(int userId, CancellationToken cancellationToken = default)
    {
        return await _context.Projects
            .AsNoTracking()
            .Where(project => project.UserId == userId)
            .OrderByDescending(project => project.CreatedAt)
            .ThenByDescending(project => project.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken = default)
    {
        return _context.Users
            .AsNoTracking()
            .AnyAsync(user => user.Id == userId, cancellationToken);
    }

    public async Task AddAsync(Project project, CancellationToken cancellationToken = default)
    {
        await _context.Projects.AddAsync(project, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

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
}
