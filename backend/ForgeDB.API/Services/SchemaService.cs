using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class SchemaService : ISchemaService
{
    private readonly ISchemaRepository _schemaRepository;

    public SchemaService(ISchemaRepository schemaRepository)
    {
        _schemaRepository = schemaRepository;
    }

    public Task<SchemaResponseDto> GenerateSchemaAsync(int datasetId, SchemaGenerateRequestDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<SchemaResponseDto?> GetSchemaByIdAsync(int schemaId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<SchemaResponseDto> UpdateRelationshipsAsync(int schemaId, SchemaRelationshipsUpdateDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
