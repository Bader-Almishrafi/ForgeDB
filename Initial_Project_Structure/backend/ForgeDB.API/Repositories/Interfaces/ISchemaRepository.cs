using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface ISchemaRepository
{
    Task<DatabaseSchema?> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<IEnumerable<DatabaseSchema>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default);
    Task AddAsync(DatabaseSchema schema, CancellationToken cancellationToken = default);
}
