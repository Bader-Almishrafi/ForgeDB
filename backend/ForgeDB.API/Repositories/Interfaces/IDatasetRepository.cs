using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IDatasetRepository
{
    Task<bool> ProjectExistsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<Dataset?> GetByIdAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<Dataset?> GetByIdWithColumnsAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<Dataset?> GetByIdWithPreviewAsync(int datasetId, int rowLimit, CancellationToken cancellationToken = default);
    Task<Dataset?> GetByIdWithRowsAndColumnsAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Dataset>> GetByProjectIdWithColumnsAsync(int projectId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Dataset>> GetByProjectIdWithRowsAndColumnsAsync(int projectId, CancellationToken cancellationToken = default);
    Task AddAsync(Dataset dataset, CancellationToken cancellationToken = default);
    Task SaveAnalysisResultAsync(
        int datasetId,
        string analysisResultJson,
        int missingValuesCount,
        int duplicateRowsCount,
        DateTime analyzedAt,
        CancellationToken cancellationToken = default);
}
