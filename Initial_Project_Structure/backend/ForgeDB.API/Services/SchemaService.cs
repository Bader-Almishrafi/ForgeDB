using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class SchemaService : ISchemaService
{
    public Task<SchemaResponseDto> GenerateSchemaAsync(SchemaGenerateRequestDto request, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IEnumerable<SchemaResponseDto>> GetProjectSchemasAsync(int projectId, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
