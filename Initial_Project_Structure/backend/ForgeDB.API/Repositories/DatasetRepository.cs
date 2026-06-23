using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class DatasetRepository : IDatasetRepository
{
    public Task<Dataset?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(Dataset dataset, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
