using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Repositories;

public class SchemaRepository : ISchemaRepository
{
    public Task<DatabaseSchema?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<DatabaseSchema>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AddAsync(DatabaseSchema schema, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
