using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

public class DatasetRepository : IDatasetRepository
{
    private readonly ForgeDbContext _context;

    public DatasetRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<bool> ProjectExistsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return _context.Projects
            .AsNoTracking()
            .AnyAsync(project => project.Id == projectId, cancellationToken);
    }

    public Task<Dataset?> GetByIdAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        return _context.Datasets
            .AsNoTracking()
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
    }

    public Task<Dataset?> GetByIdWithColumnsAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        return _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
    }

    public Task<Dataset?> GetByIdWithPreviewAsync(int datasetId, int rowLimit, CancellationToken cancellationToken = default)
    {
        var safeRowLimit = Math.Max(0, rowLimit);

        return _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id)
                .Take(safeRowLimit))
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
    }

    public Task<Dataset?> GetByIdWithRowsAndColumnsAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        return _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id))
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
    }

    public async Task<IReadOnlyList<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        return await _context.Datasets
            .AsNoTracking()
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderByDescending(dataset => dataset.CreatedAt)
            .ThenByDescending(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task AddAsync(Dataset dataset, CancellationToken cancellationToken = default)
    {
        await _context.Datasets.AddAsync(dataset, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task SaveAnalysisResultAsync(
        int datasetId,
        string analysisResultJson,
        int missingValuesCount,
        int duplicateRowsCount,
        DateTime analyzedAt,
        CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);

        if (dataset is null)
        {
            return;
        }

        dataset.AnalysisResultJson = analysisResultJson;
        dataset.MissingValuesCount = missingValuesCount;
        dataset.DuplicateRowsCount = duplicateRowsCount;
        dataset.AnalyzedAt = analyzedAt;
        dataset.Status = "Analyzed";

        await _context.SaveChangesAsync(cancellationToken);
    }
}
