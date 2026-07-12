using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public sealed record CleaningDatasetVersionData(
    Dataset Dataset,
    DatasetVersion Version,
    List<CleaningColumnSnapshotDto> Columns,
    List<Dictionary<string, object?>> Rows);

public interface ICleaningRepository
{
    Task<Project?> GetOwnedProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<bool> DatasetOwnedByAsync(int datasetId, int projectId, int userId, CancellationToken cancellationToken = default);
    Task EnsureRawVersionsAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CleaningDatasetVersionData>> GetActiveProjectVersionsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<CleaningDatasetVersionData?> GetActiveDatasetVersionAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<DatasetVersion?> GetVersionAsync(int datasetId, int versionId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DatasetVersion>> GetVersionsAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CleaningBatch>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default);
    Task<CleaningBatch?> GetLatestUndoableBatchAsync(int projectId, CancellationToken cancellationToken = default);
    Task<CleaningBatch> CreateBatchAsync(int projectId, int userId, string name, bool isUndo, bool isRestore, CancellationToken cancellationToken = default);
    Task<DatasetVersion> PersistVersionAsync(
        int datasetId,
        int sourceVersionId,
        int userId,
        CleaningBatch batch,
        string operationSummary,
        PythonCleaningResponseDto result,
        IReadOnlyList<CleaningOperationRequestDto> requests,
        CancellationToken cancellationToken = default);
    Task AddFailedOperationsAsync(
        CleaningBatch batch,
        int datasetId,
        int sourceVersionId,
        IReadOnlyList<CleaningOperationRequestDto> requests,
        string failureMessage,
        CancellationToken cancellationToken = default);
    Task CompleteBatchAsync(CleaningBatch batch, string status, int rowsAffected, int cellsAffected, string? failureDetailsJson, CancellationToken cancellationToken = default);
    Task<ProjectCleaningState?> GetStateAsync(int projectId, CancellationToken cancellationToken = default);
    Task<ProjectCleaningState> ConfirmQualityAsync(int projectId, int userId, Dictionary<int, int> versions, CancellationToken cancellationToken = default);
    Task<bool> IsSchemaReadyAsync(int projectId, CancellationToken cancellationToken = default);
}
