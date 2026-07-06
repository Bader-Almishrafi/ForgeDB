using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public interface ISchemaRepository
{
    Task<DatabaseSchema?> GetByIdAsync(int schemaId, CancellationToken cancellationToken = default);
    Task<DatabaseSchema?> GetLatestByDatasetIdAsync(int datasetId, CancellationToken cancellationToken = default);
    Task AddAsync(DatabaseSchema schema, CancellationToken cancellationToken = default);
    Task<DatabaseSchema?> UpdateRelationshipsAsync(
        int schemaId,
        string relationshipsJson,
        string schemaJson,
        string sqlContent,
        DateTime updatedAt,
        CancellationToken cancellationToken = default);
}
