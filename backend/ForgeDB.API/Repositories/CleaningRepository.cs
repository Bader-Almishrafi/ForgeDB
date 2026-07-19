using System.Text.Json;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace ForgeDB.API.Repositories;

public class CleaningRepository : ICleaningRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ForgeDbContext _context;

    public CleaningRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<Project?> GetOwnedProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default) =>
        _context.Projects.AsNoTracking().FirstOrDefaultAsync(project => project.Id == projectId && project.UserId == userId, cancellationToken);

    public Task<bool> DatasetOwnedByAsync(int datasetId, int projectId, int userId, CancellationToken cancellationToken = default) =>
        _context.Datasets.AsNoTracking().AnyAsync(dataset => dataset.Id == datasetId
            && dataset.ProjectId == projectId
            && dataset.Project != null
            && dataset.Project.UserId == userId, cancellationToken);

    public async Task EnsureRawVersionsAsync(int projectId, int userId, CancellationToken cancellationToken = default)
    {
        var datasets = await _context.Datasets
            .AsSplitQuery()
            .Include(dataset => dataset.Columns.OrderBy(column => column.Id))
            .Include(dataset => dataset.Rows.OrderBy(row => row.RowNumber).ThenBy(row => row.Id))
            .Include(dataset => dataset.Versions)
            .Where(dataset => dataset.ProjectId == projectId)
            .OrderBy(dataset => dataset.Id)
            .ToListAsync(cancellationToken);

        foreach (var dataset in datasets)
        {
            if (dataset.Versions.Count == 0)
            {
                var version = new DatasetVersion
                {
                    DatasetId = dataset.Id,
                    CreatedByUserId = userId,
                    VersionNumber = 1,
                    IsRawOriginal = true,
                    IsActive = true,
                    RowsJson = CleaningSnapshotSerializer.SerializeRows(CleaningSnapshotSerializer.FromDatasetRows(dataset.Rows)),
                    ColumnsJson = CleaningSnapshotSerializer.SerializeColumns(CleaningSnapshotSerializer.FromDatasetColumns(dataset.Columns)),
                    RowCount = dataset.RowCount,
                    ColumnCount = dataset.ColumnCount,
                    MissingValuesCount = dataset.MissingValuesCount,
                    DuplicateRowsCount = dataset.DuplicateRowsCount,
                    OperationSummary = "Original imported dataset",
                    AnalysisResultJson = dataset.AnalysisResultJson,
                    AnalyzedAt = dataset.AnalyzedAt,
                    CreatedAt = dataset.CreatedAt
                };
                _context.DatasetVersions.Add(version);

                try
                {
                    await _context.SaveChangesAsync(cancellationToken);
                    dataset.ActiveVersionId = version.Id;
                }
                catch (DbUpdateException exception) when (IsDuplicateRawVersionConflict(exception))
                {
                    // A concurrent request (e.g. the frontend firing several cleaning endpoints in
                    // parallel on first page load) already created this dataset's raw version 1
                    // between our read and write. Drop our losing insert and adopt the winner's row
                    // instead of surfacing a 500 — this call only needs the baseline to exist.
                    _context.Entry(version).State = EntityState.Detached;
                    var winningVersionId = await _context.DatasetVersions
                        .Where(existing => existing.DatasetId == dataset.Id && existing.VersionNumber == 1)
                        .Select(existing => (int?)existing.Id)
                        .FirstOrDefaultAsync(cancellationToken);
                    dataset.ActiveVersionId = winningVersionId ?? dataset.ActiveVersionId;
                }
            }
            else if (dataset.ActiveVersionId is null
                || dataset.Versions.All(version => version.Id != dataset.ActiveVersionId.Value))
            {
                var active = dataset.Versions
                    .OrderByDescending(version => version.IsActive)
                    .ThenByDescending(version => version.VersionNumber)
                    .First();
                dataset.ActiveVersionId = active.Id;
            }

            foreach (var version in dataset.Versions)
            {
                version.IsActive = version.Id == dataset.ActiveVersionId;
            }
        }

        await _context.SaveChangesAsync(cancellationToken);
    }

    private static bool IsDuplicateRawVersionConflict(DbUpdateException exception)
    {
        return exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
    }

    public async Task<IReadOnlyList<CleaningDatasetVersionData>> GetActiveProjectVersionsAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var datasets = await _context.Datasets.AsNoTracking()
            .Include(dataset => dataset.ActiveVersion)
            .Where(dataset => dataset.ProjectId == projectId && dataset.ActiveVersion != null)
            .OrderBy(dataset => dataset.Id)
            .ToListAsync(cancellationToken);
        return datasets.Select(MapActiveVersion).ToList();
    }

    public async Task<CleaningDatasetVersionData?> GetActiveDatasetVersionAsync(int datasetId, CancellationToken cancellationToken = default)
    {
        var dataset = await _context.Datasets.AsNoTracking()
            .Include(item => item.ActiveVersion)
            .FirstOrDefaultAsync(item => item.Id == datasetId && item.ActiveVersion != null, cancellationToken);
        return dataset is null ? null : MapActiveVersion(dataset);
    }

    public Task<DatasetVersion?> GetVersionAsync(int datasetId, int versionId, CancellationToken cancellationToken = default) =>
        _context.DatasetVersions.AsNoTracking()
            .Include(version => version.CreatedByUser)
            .FirstOrDefaultAsync(version => version.Id == versionId && version.DatasetId == datasetId, cancellationToken);

    public async Task<IReadOnlyList<DatasetVersion>> GetVersionsAsync(int datasetId, CancellationToken cancellationToken = default) =>
        await _context.DatasetVersions.AsNoTracking()
            .Include(version => version.CreatedByUser)
            .Where(version => version.DatasetId == datasetId)
            .OrderByDescending(version => version.VersionNumber)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<CleaningBatch>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default) =>
        await _context.CleaningBatches.AsNoTracking().AsSplitQuery()
            .Include(batch => batch.CreatedByUser)
            .Include(batch => batch.Operations.OrderBy(operation => operation.Order))
                .ThenInclude(operation => operation.Dataset)
            .Include(batch => batch.Operations.OrderBy(operation => operation.Order))
                .ThenInclude(operation => operation.ResultVersion)
            .Where(batch => batch.ProjectId == projectId)
            .OrderByDescending(batch => batch.CreatedAt)
            .Take(100)
            .ToListAsync(cancellationToken);

    public Task<CleaningBatch?> GetLatestUndoableBatchAsync(int projectId, CancellationToken cancellationToken = default) =>
        _context.CleaningBatches.AsNoTracking().AsSplitQuery()
            .Include(batch => batch.Operations.OrderBy(operation => operation.Order))
                .ThenInclude(operation => operation.ResultVersion)
            .Where(batch => batch.ProjectId == projectId
                && !batch.IsUndo
                && !batch.IsRestore
                && (batch.Status == "Succeeded" || batch.Status == "PartiallySucceeded")
                && batch.Operations.Any(operation => operation.ResultVersionId != null))
            .OrderByDescending(batch => batch.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<CleaningBatch> CreateBatchAsync(int projectId, int userId, string name, bool isUndo, bool isRestore, CancellationToken cancellationToken = default)
    {
        var batch = new CleaningBatch
        {
            CorrelationId = Guid.NewGuid(),
            ProjectId = projectId,
            CreatedByUserId = userId,
            Name = name,
            Status = "Running",
            IsUndo = isUndo,
            IsRestore = isRestore,
            CreatedAt = DateTime.UtcNow
        };
        _context.CleaningBatches.Add(batch);
        await _context.SaveChangesAsync(cancellationToken);
        return batch;
    }

    public async Task<DatasetVersion> PersistVersionAsync(
        int datasetId,
        int sourceVersionId,
        int userId,
        CleaningBatch batch,
        string operationSummary,
        PythonCleaningResponseDto result,
        IReadOnlyList<CleaningOperationRequestDto> requests,
        CancellationToken cancellationToken = default)
    {
        IDbContextTransaction? transaction = null;
        if (_context.Database.IsRelational())
        {
            transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            var locked = await _context.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE datasets SET \"ActiveVersionId\" = \"ActiveVersionId\" WHERE \"Id\" = {datasetId} AND \"ActiveVersionId\" = {sourceVersionId}",
                cancellationToken);
            if (locked != 1)
            {
                await transaction.RollbackAsync(cancellationToken);
                await transaction.DisposeAsync();
                throw new InvalidOperationException("The active dataset version changed. Refresh the cleaning workspace and preview again.");
            }
        }
        var dataset = await _context.Datasets.Include(item => item.Versions)
            .FirstOrDefaultAsync(item => item.Id == datasetId, cancellationToken)
            ?? throw new KeyNotFoundException("Dataset not found.");
        if (dataset.ActiveVersionId != sourceVersionId)
        {
            throw new InvalidOperationException("The active dataset version changed. Refresh the cleaning workspace and preview again.");
        }

        foreach (var activeVersion in dataset.Versions.Where(version => version.IsActive))
        {
            activeVersion.IsActive = false;
        }
        await _context.SaveChangesAsync(cancellationToken);

        var versionNumber = dataset.Versions.Select(version => version.VersionNumber).DefaultIfEmpty(0).Max() + 1;
        var missingValues = result.ResultRows.Sum(row => result.Columns.Count(column =>
            !row.TryGetValue(column.Name, out var value) || IsMissing(value)));
        var duplicateRows = CountDuplicateRows(result.ResultRows, result.Columns.Select(column => column.Name).ToList());
        var version = new DatasetVersion
        {
            DatasetId = datasetId,
            ParentVersionId = sourceVersionId,
            CleaningBatchId = batch.Id,
            CreatedByUserId = userId,
            VersionNumber = versionNumber,
            IsRawOriginal = false,
            IsActive = true,
            RowsJson = CleaningSnapshotSerializer.SerializeRows(result.ResultRows),
            ColumnsJson = CleaningSnapshotSerializer.SerializeColumns(result.Columns),
            RowCount = result.ResultRows.Count,
            ColumnCount = result.Columns.Count,
            MissingValuesCount = missingValues,
            DuplicateRowsCount = duplicateRows,
            OperationSummary = operationSummary,
            CreatedAt = DateTime.UtcNow
        };
        _context.DatasetVersions.Add(version);
        await _context.SaveChangesAsync(cancellationToken);

        var resultById = result.OperationResults.ToDictionary(item => item.OperationId, StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < requests.Count; index++)
        {
            var request = requests[index];
            var requestId = request.OperationId ?? $"operation-{index + 1}";
            resultById.TryGetValue(requestId, out var operationResult);
            _context.CleaningOperations.Add(new CleaningOperation
            {
                CleaningBatchId = batch.Id,
                DatasetId = datasetId,
                SourceVersionId = sourceVersionId,
                ResultVersionId = version.Id,
                Order = index + 1,
                OperationType = request.OperationType,
                ColumnName = request.Column,
                ParametersJson = request.Parameters.ValueKind is JsonValueKind.Undefined ? "{}" : request.Parameters.GetRawText(),
                Status = "Succeeded",
                IsDestructive = operationResult?.Destructive ?? false,
                RowsAffected = operationResult?.AffectedRows ?? 0,
                CellsAffected = operationResult?.AffectedCells ?? 0,
                CreatedAt = DateTime.UtcNow
            });
        }

        dataset.ActiveVersionId = version.Id;
        dataset.RowCount = version.RowCount;
        dataset.ColumnCount = version.ColumnCount;
        dataset.MissingValuesCount = version.MissingValuesCount;
        dataset.DuplicateRowsCount = version.DuplicateRowsCount;
        dataset.Status = "Cleaned - Analysis Required";
        dataset.AnalysisResultJson = null;
        dataset.AnalyzedAt = null;
        await InvalidateStateTrackedAsync(dataset.ProjectId, batch.Id, cancellationToken);
        if (!version.IsActive || dataset.ActiveVersionId != version.Id)
        {
            throw new InvalidOperationException("Dataset active-version state is inconsistent.");
        }
        await _context.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            await transaction.DisposeAsync();
        }
        return version;
    }

    public async Task AddFailedOperationsAsync(CleaningBatch batch, int datasetId, int sourceVersionId, IReadOnlyList<CleaningOperationRequestDto> requests, string failureMessage, CancellationToken cancellationToken = default)
    {
        for (var index = 0; index < requests.Count; index++)
        {
            var request = requests[index];
            _context.CleaningOperations.Add(new CleaningOperation
            {
                CleaningBatchId = batch.Id,
                DatasetId = datasetId,
                SourceVersionId = sourceVersionId,
                Order = index + 1,
                OperationType = request.OperationType,
                ColumnName = request.Column,
                ParametersJson = request.Parameters.ValueKind is JsonValueKind.Undefined ? "{}" : request.Parameters.GetRawText(),
                Status = "Failed",
                FailureMessage = failureMessage,
                CreatedAt = DateTime.UtcNow
            });
        }
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task CompleteBatchAsync(CleaningBatch batch, string status, int rowsAffected, int cellsAffected, string? failureDetailsJson, CancellationToken cancellationToken = default)
    {
        var tracked = await _context.CleaningBatches.FirstAsync(item => item.Id == batch.Id, cancellationToken);
        tracked.Status = status;
        tracked.RowsAffected = rowsAffected;
        tracked.CellsAffected = cellsAffected;
        tracked.OperationCount = await _context.CleaningOperations.CountAsync(operation => operation.CleaningBatchId == batch.Id, cancellationToken);
        tracked.FailureDetailsJson = failureDetailsJson;
        tracked.CompletedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
    }

    public Task<ProjectCleaningState?> GetStateAsync(int projectId, CancellationToken cancellationToken = default) =>
        _context.ProjectCleaningStates.AsNoTracking().FirstOrDefaultAsync(state => state.ProjectId == projectId, cancellationToken);

    public async Task<ProjectCleaningState> ConfirmQualityAsync(int projectId, int userId, Dictionary<int, int> versions, CancellationToken cancellationToken = default)
    {
        var state = await _context.ProjectCleaningStates.FirstOrDefaultAsync(item => item.ProjectId == projectId, cancellationToken);
        if (state is null)
        {
            state = new ProjectCleaningState { ProjectId = projectId };
            _context.ProjectCleaningStates.Add(state);
        }
        state.QualityConfirmedAt = DateTime.UtcNow;
        state.QualityConfirmedByUserId = userId;
        state.ConfirmedVersionsJson = JsonSerializer.Serialize(versions, JsonOptions);
        state.LastReanalyzedAt = DateTime.UtcNow;
        state.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync(cancellationToken);
        return state;
    }

    public async Task<bool> IsSchemaReadyAsync(int projectId, CancellationToken cancellationToken = default)
    {
        var state = await _context.ProjectCleaningStates.AsNoTracking().FirstOrDefaultAsync(item => item.ProjectId == projectId, cancellationToken);
        if (state?.QualityConfirmedAt is null || string.IsNullOrWhiteSpace(state.ConfirmedVersionsJson)) return false;
        var confirmed = JsonSerializer.Deserialize<Dictionary<int, int>>(state.ConfirmedVersionsJson, JsonOptions) ?? new();
        var active = await _context.Datasets.AsNoTracking().Where(dataset => dataset.ProjectId == projectId && dataset.ActiveVersionId != null)
            .ToDictionaryAsync(dataset => dataset.Id, dataset => dataset.ActiveVersionId!.Value, cancellationToken);
        return active.Count > 0 && active.Count == confirmed.Count && active.All(pair => confirmed.GetValueOrDefault(pair.Key) == pair.Value);
    }

    private async Task InvalidateStateTrackedAsync(int projectId, int batchId, CancellationToken cancellationToken)
    {
        var state = await _context.ProjectCleaningStates.FirstOrDefaultAsync(item => item.ProjectId == projectId, cancellationToken);
        if (state is null)
        {
            state = new ProjectCleaningState { ProjectId = projectId };
            _context.ProjectCleaningStates.Add(state);
        }
        state.LastCleaningBatchId = batchId;
        state.QualityConfirmedAt = null;
        state.QualityConfirmedByUserId = null;
        state.ConfirmedVersionsJson = null;
        state.LastReanalyzedAt = null;
        state.UpdatedAt = DateTime.UtcNow;
    }

    private static CleaningDatasetVersionData MapActiveVersion(Dataset dataset)
    {
        var version = dataset.ActiveVersion ?? throw new InvalidOperationException("Dataset has no active version.");
        if (dataset.ActiveVersionId != version.Id || !version.IsActive)
        {
            throw new InvalidOperationException("Dataset active-version state is inconsistent.");
        }
        return new CleaningDatasetVersionData(
            dataset,
            version,
            CleaningSnapshotSerializer.DeserializeColumns(version.ColumnsJson),
            CleaningSnapshotSerializer.DeserializeRows(version.RowsJson));
    }

    private static bool IsMissing(object? value) => value is null
        || value is JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined }
        || value is string text && string.IsNullOrWhiteSpace(text);

    private static int CountDuplicateRows(IReadOnlyList<Dictionary<string, object?>> rows, IReadOnlyList<string> columns)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var duplicates = 0;
        foreach (var row in rows)
        {
            var values = columns.Select(column => row.GetValueOrDefault(column)).ToList();
            if (!seen.Add(JsonSerializer.Serialize(values, JsonOptions))) duplicates++;
        }
        return duplicates;
    }
}
