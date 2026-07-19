using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

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
        var ownerUserId = await _context.Projects
            .Where(project => project.Id == dataset.ProjectId)
            .Select(project => (int?)project.UserId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("The dataset project does not exist.");

        await using var transaction = _context.Database.IsRelational()
            ? await _context.Database.BeginTransactionAsync(cancellationToken)
            : null;

        await _context.Datasets.AddAsync(dataset, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);

        var initialVersion = CreateVersionSnapshot(
            dataset,
            ownerUserId,
            versionNumber: 1,
            parentVersionId: null,
            isRawOriginal: true,
            operationSummary: "Original imported dataset");
        _context.DatasetVersions.Add(initialVersion);
        await _context.SaveChangesAsync(cancellationToken);

        dataset.ActiveVersionId = initialVersion.Id;
        dataset.ActiveVersion = initialVersion;
        await _context.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }
    }

    public async Task<bool> SaveAnalysisResultAsync(
        int datasetId,
        int expectedActiveVersionId,
        string analysisResultJson,
        int missingValuesCount,
        int duplicateRowsCount,
        DateTime analyzedAt,
        CancellationToken cancellationToken = default)
    {
        if (!_context.Database.IsRelational())
        {
            var dataset = await _context.Datasets
                .Include(item => item.ActiveVersion)
                .FirstOrDefaultAsync(item => item.Id == datasetId, cancellationToken);
            if (dataset?.ActiveVersionId != expectedActiveVersionId
                || dataset.ActiveVersion?.Id != expectedActiveVersionId
                || !dataset.ActiveVersion.IsActive)
            {
                return false;
            }

            ApplyAnalysis(dataset, dataset.ActiveVersion, analysisResultJson, missingValuesCount, duplicateRowsCount, analyzedAt);
            await _context.SaveChangesAsync(cancellationToken);
            return true;
        }

        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        var datasetUpdated = await _context.Datasets
            .Where(dataset => dataset.Id == datasetId && dataset.ActiveVersionId == expectedActiveVersionId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(dataset => dataset.AnalysisResultJson, analysisResultJson)
                .SetProperty(dataset => dataset.MissingValuesCount, missingValuesCount)
                .SetProperty(dataset => dataset.DuplicateRowsCount, duplicateRowsCount)
                .SetProperty(dataset => dataset.AnalyzedAt, analyzedAt)
                .SetProperty(dataset => dataset.Status, "Analyzed"), cancellationToken);
        if (datasetUpdated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        var versionUpdated = await _context.DatasetVersions
            .Where(version => version.Id == expectedActiveVersionId
                && version.DatasetId == datasetId
                && version.IsActive)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(version => version.AnalysisResultJson, analysisResultJson)
                .SetProperty(version => version.MissingValuesCount, missingValuesCount)
                .SetProperty(version => version.DuplicateRowsCount, duplicateRowsCount)
                .SetProperty(version => version.AnalyzedAt, analyzedAt), cancellationToken);
        if (versionUpdated != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> DeleteAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets
            .Include(dataset => dataset.Versions)
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);

        if (dataset is null)
        {
            return false;
        }

        IDbContextTransaction? transaction = null;
        if (_context.Database.IsRelational())
        {
            transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        }

        var suggestions = await _context.RelationshipSuggestions
            .Where(suggestion => suggestion.SourceDatasetId == datasetId || suggestion.TargetDatasetId == datasetId)
            .ToListAsync(cancellationToken);
        var operations = await _context.CleaningOperations
            .Where(operation => operation.DatasetId == datasetId)
            .ToListAsync(cancellationToken);

        _context.RelationshipSuggestions.RemoveRange(suggestions);
        _context.CleaningOperations.RemoveRange(operations);
        dataset.ActiveVersionId = null;
        _context.Datasets.Remove(dataset);

        await _context.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return true;
    }

    public async Task<Dataset?> ReplaceContentAsync(
        int datasetId,
        string sourceType,
        string? sourceName,
        string? sourceUrl,
        IReadOnlyList<DatasetColumn> columns,
        IReadOnlyList<DatasetRow> rows,
        int missingValuesCount,
        int duplicateRowsCount,
        CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets
            .Include(dataset => dataset.Columns)
            .Include(dataset => dataset.Rows)
            .Include(dataset => dataset.Versions)
            .FirstOrDefaultAsync(dataset => dataset.Id == datasetId, cancellationToken);

        if (dataset is null)
        {
            return null;
        }

        IDbContextTransaction? transaction = null;
        if (_context.Database.IsRelational())
        {
            transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        }

        var suggestions = await _context.RelationshipSuggestions
            .Where(suggestion => suggestion.SourceDatasetId == datasetId || suggestion.TargetDatasetId == datasetId)
            .ToListAsync(cancellationToken);
        var operations = await _context.CleaningOperations
            .Where(operation => operation.DatasetId == datasetId)
            .ToListAsync(cancellationToken);

        _context.RelationshipSuggestions.RemoveRange(suggestions);
        _context.CleaningOperations.RemoveRange(operations);
        _context.DatasetColumns.RemoveRange(dataset.Columns);
        _context.DatasetRows.RemoveRange(dataset.Rows);

        foreach (var version in dataset.Versions.Where(version => version.IsActive))
        {
            version.IsActive = false;
        }
        dataset.SourceType = sourceType;
        dataset.SourceName = sourceName;
        dataset.SourceUrl = sourceUrl;
        dataset.RowCount = rows.Count;
        dataset.ColumnCount = columns.Count;
        dataset.MissingValuesCount = missingValuesCount;
        dataset.DuplicateRowsCount = duplicateRowsCount;
        dataset.Status = "Imported";
        dataset.AnalysisResultJson = null;
        dataset.AnalyzedAt = null;
        dataset.Columns = columns.ToList();
        dataset.Rows = rows.ToList();

        await _context.SaveChangesAsync(cancellationToken);

        var ownerUserId = await _context.Projects
            .Where(project => project.Id == dataset.ProjectId)
            .Select(project => project.UserId)
            .SingleAsync(cancellationToken);
        var replacementVersion = CreateVersionSnapshot(
            dataset,
            ownerUserId,
            dataset.Versions.Select(version => version.VersionNumber).DefaultIfEmpty(0).Max() + 1,
            dataset.ActiveVersionId,
            isRawOriginal: true,
            operationSummary: "Dataset content replaced");
        _context.DatasetVersions.Add(replacementVersion);
        await _context.SaveChangesAsync(cancellationToken);

        dataset.ActiveVersionId = replacementVersion.Id;
        dataset.ActiveVersion = replacementVersion;
        await _context.SaveChangesAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return dataset;
    }

    private static void ApplyActiveVersion(Dataset? dataset, bool includeRows, int? rowLimit = null)
    {
        if (dataset?.ActiveVersion is null) return;
        var version = dataset.ActiveVersion;
        if (dataset.ActiveVersionId != version.Id || !version.IsActive)
        {
            throw new InvalidOperationException("Dataset active-version state is inconsistent.");
        }
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

    private static DatasetVersion CreateVersionSnapshot(
        Dataset dataset,
        int createdByUserId,
        int versionNumber,
        int? parentVersionId,
        bool isRawOriginal,
        string operationSummary) => new()
    {
        DatasetId = dataset.Id,
        ParentVersionId = parentVersionId,
        CreatedByUserId = createdByUserId,
        VersionNumber = versionNumber,
        IsRawOriginal = isRawOriginal,
        IsActive = true,
        RowsJson = CleaningSnapshotSerializer.SerializeRows(CleaningSnapshotSerializer.FromDatasetRows(dataset.Rows)),
        ColumnsJson = CleaningSnapshotSerializer.SerializeColumns(CleaningSnapshotSerializer.FromDatasetColumns(dataset.Columns)),
        RowCount = dataset.RowCount,
        ColumnCount = dataset.ColumnCount,
        MissingValuesCount = dataset.MissingValuesCount,
        DuplicateRowsCount = dataset.DuplicateRowsCount,
        OperationSummary = operationSummary,
        AnalysisResultJson = dataset.AnalysisResultJson,
        AnalyzedAt = dataset.AnalyzedAt,
        CreatedAt = DateTime.UtcNow
    };

    private static void ApplyAnalysis(
        Dataset dataset,
        DatasetVersion version,
        string analysisResultJson,
        int missingValuesCount,
        int duplicateRowsCount,
        DateTime analyzedAt)
    {
        dataset.AnalysisResultJson = analysisResultJson;
        dataset.MissingValuesCount = missingValuesCount;
        dataset.DuplicateRowsCount = duplicateRowsCount;
        dataset.AnalyzedAt = analyzedAt;
        dataset.Status = "Analyzed";
        version.AnalysisResultJson = analysisResultJson;
        version.MissingValuesCount = missingValuesCount;
        version.DuplicateRowsCount = duplicateRowsCount;
        version.AnalyzedAt = analyzedAt;
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
