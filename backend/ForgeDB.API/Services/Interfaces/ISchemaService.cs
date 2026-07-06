using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface ISchemaService
{
    Task<SchemaResponseDto> GenerateSchemaAsync(int datasetId, SchemaGenerateRequestDto request, CancellationToken cancellationToken = default);
    Task<SchemaResponseDto?> GetSchemaByIdAsync(int schemaId, CancellationToken cancellationToken = default);
    Task<SchemaResponseDto?> GetLatestSchemaByDatasetIdAsync(int datasetId, CancellationToken cancellationToken = default);
    Task<SchemaResponseDto> UpdateRelationshipsAsync(int schemaId, SchemaRelationshipsUpdateDto request, CancellationToken cancellationToken = default);
}
