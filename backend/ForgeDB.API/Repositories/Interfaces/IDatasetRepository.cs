using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface IDatasetRepository
{
    Task<Dataset?> GetByIdAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<IEnumerable<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task AddAsync(Dataset dataset, CancellationToken cancellationToken = default);
    Task SaveAnalysisResultAsync(int datasetId, string analysisResultJson, CancellationToken cancellationToken = default);
}
