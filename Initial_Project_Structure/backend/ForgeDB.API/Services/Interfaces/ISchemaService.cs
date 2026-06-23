using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface ISchemaService
{
    Task<SchemaResponseDto> GenerateSchemaAsync(SchemaGenerateRequestDto request, CancellationToken cancellationToken = default);
    Task<IEnumerable<SchemaResponseDto>> GetProjectSchemasAsync(int projectId, CancellationToken cancellationToken = default);
}
