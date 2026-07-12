using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using System.Text.Json;
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

    public async Task<Dataset?> GetByIdWithColumnsAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.ActiveVersion)
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
        ApplyActiveVersion(dataset, includeRows: false);
        return dataset;
    }

    public async Task<Dataset?> GetByIdWithPreviewAsync(int datasetId, int rowLimit, CancellationToken cancellationToken = default)
    {
        var safeRowLimit = Math.Max(0, rowLimit);

        var dataset = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id)
                .Take(safeRowLimit))
            .Include(dataset => dataset.ActiveVersion)
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
        ApplyActiveVersion(dataset, includeRows: true, safeRowLimit);
        return dataset;
    }

    public async Task<Dataset?> GetByIdWithRowsAndColumnsAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows
                .OrderBy(row => row.RowNumber)
                .ThenBy(row => row.Id))
            .Include(dataset => dataset.ActiveVersion)
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);
        ApplyActiveVersion(dataset, includeRows: true);
        return dataset;
    }

    public async Task<IReadOnlyList<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var datasets = await _context.Datasets
            .AsNoTracking()
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderByDescending(dataset => dataset.CreatedAt)
            .ThenByDescending(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
        return datasets;
    }

    public async Task<IReadOnlyList<Dataset>> GetByProjectIdWithColumnsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var datasets = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.ActiveVersion)
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderBy(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
        foreach (var dataset in datasets) ApplyActiveVersion(dataset, includeRows: false);
        return datasets;
    }

    public async Task<IReadOnlyList<Dataset>> GetByProjectIdWithRowsAndColumnsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var datasets = await _context.Datasets
            .AsNoTracking()
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows.OrderBy(row => row.RowNumber).ThenBy(row => row.Id))
            .Include(dataset => dataset.ActiveVersion)
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderBy(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
        foreach (var dataset in datasets) ApplyActiveVersion(dataset, includeRows: true);
        return datasets;
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
            .Include(item => item.ActiveVersion)
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

        if (dataset.ActiveVersion is not null)
        {
            dataset.ActiveVersion.AnalysisResultJson = analysisResultJson;
            dataset.ActiveVersion.MissingValuesCount = missingValuesCount;
            dataset.ActiveVersion.DuplicateRowsCount = duplicateRowsCount;
            dataset.ActiveVersion.AnalyzedAt = analyzedAt;
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    private static void ApplyActiveVersion(Dataset? dataset, bool includeRows, int? rowLimit = null)
    {
        if (dataset?.ActiveVersion is null) return;
        var version = dataset.ActiveVersion;
        var columns = CleaningSnapshotSerializer.DeserializeColumns(version.ColumnsJson);
        var analysisColumns = ParseAnalysisColumns(version.AnalysisResultJson);
        dataset.Columns = columns.Select((column, index) => new DatasetColumn
        {
            Id = index + 1,
            DatasetId = dataset.Id,
            ColumnName = column.Name,
            DetectedDataType = column.DataType,
            IsNullable = analysisColumns.GetValueOrDefault(column.Name)?.IsNullable ?? false,
            UniqueValuesCount = analysisColumns.GetValueOrDefault(column.Name)?.UniqueValuesCount ?? 0
        }).ToList();
        if (includeRows)
        {
            var rows = CleaningSnapshotSerializer.DeserializeRows(version.RowsJson);
            if (rowLimit.HasValue) rows = rows.Take(rowLimit.Value).ToList();
            dataset.Rows = rows.Select((row, index) => new DatasetRow
            {
                Id = index + 1,
                DatasetId = dataset.Id,
                RowNumber = index + 1,
                RowData = JsonSerializer.Serialize(row),
                CreatedAt = version.CreatedAt
            }).ToList();
        }
        dataset.RowCount = version.RowCount;
        dataset.ColumnCount = version.ColumnCount;
        dataset.MissingValuesCount = version.MissingValuesCount;
        dataset.DuplicateRowsCount = version.DuplicateRowsCount;
        dataset.AnalysisResultJson = version.AnalysisResultJson;
        dataset.AnalyzedAt = version.AnalyzedAt;
        dataset.Status = version.AnalyzedAt.HasValue ? "Analyzed" : "Cleaned - Analysis Required";
    }

    private static Dictionary<string, ActiveColumnAnalysis> ParseAnalysisColumns(string? analysisJson)
    {
        var result = new Dictionary<string, ActiveColumnAnalysis>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(analysisJson)) return result;
        try
        {
            using var document = JsonDocument.Parse(analysisJson);
            if (!document.RootElement.TryGetProperty("columns", out var columns) || columns.ValueKind != JsonValueKind.Array) return result;
            foreach (var column in columns.EnumerateArray())
            {
                var name = column.TryGetProperty("columnName", out var nameValue) ? nameValue.GetString() : null;
                if (string.IsNullOrWhiteSpace(name)) continue;
                var unique = column.TryGetProperty("uniqueValuesCount", out var uniqueValue) ? uniqueValue.GetInt32() : 0;
                var nullable = column.TryGetProperty("isNullable", out var nullableValue) && nullableValue.GetBoolean();
                result[name] = new ActiveColumnAnalysis(unique, nullable);
            }
        }
        catch (JsonException)
        {
            return result;
        }
        return result;
    }

    private sealed record ActiveColumnAnalysis(int UniqueValuesCount, bool IsNullable);
}
