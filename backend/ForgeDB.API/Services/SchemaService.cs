using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class SchemaService : ISchemaService
{
    private readonly IDatasetRepository _datasetRepository;
    private readonly ISchemaRepository _schemaRepository;

    public SchemaService(IDatasetRepository datasetRepository, ISchemaRepository schemaRepository)
    {
        _datasetRepository = datasetRepository;
        _schemaRepository = schemaRepository;
    }

    public async Task<SchemaResponseDto> GenerateSchemaAsync(int datasetId, SchemaGenerateRequestDto request, CancellationToken cancellationToken = default)
    {
        if (datasetId <= 0)
        {
            throw new ArgumentException("DatasetId must be greater than zero.", nameof(datasetId));
        }

        if (request is null)
        {
            throw new ArgumentException("Schema generation request is required.", nameof(request));
        }

        var dataset = await _datasetRepository.GetByIdWithColumnsAsync(datasetId, cancellationToken);
        if (dataset is null)
        {
            throw new KeyNotFoundException("Dataset not found.");
        }

        if (dataset.Columns.Count == 0)
        {
            throw new ArgumentException("Dataset has no columns to generate a schema.");
        }

        var schemaName = string.IsNullOrWhiteSpace(request.SchemaName)
            ? $"{dataset.TableName} schema"
            : request.SchemaName.Trim();

        var document = SchemaDocumentFactory.BuildFromDataset(dataset, schemaName);
        var schemaJson = SchemaDocumentFactory.Serialize(document);
        var relationshipsJson = SchemaDocumentFactory.SerializeRelationships(document.Relationships);
        var sqlContent = SchemaDocumentFactory.GenerateSql(document);
        var now = DateTime.UtcNow;

        var schema = new DatabaseSchema
        {
            ProjectId = dataset.ProjectId,
            DatasetId = dataset.Id,
            SchemaName = schemaName,
            SchemaJson = schemaJson,
            SqlContent = sqlContent,
            RelationshipsJson = relationshipsJson,
            Version = 1,
            Status = "Generated",
            CreatedAt = now
        };

        await _schemaRepository.AddAsync(schema, cancellationToken);

        return MapToResponse(schema);
    }

    public async Task<SchemaResponseDto?> GetSchemaByIdAsync(int schemaId, CancellationToken cancellationToken = default)
    {
        if (schemaId <= 0)
        {
            throw new ArgumentException("SchemaId must be greater than zero.", nameof(schemaId));
        }

        var schema = await _schemaRepository.GetByIdAsync(schemaId, cancellationToken);
        return schema is null ? null : MapToResponse(schema);
    }

    public async Task<SchemaResponseDto> UpdateRelationshipsAsync(int schemaId, SchemaRelationshipsUpdateDto request, CancellationToken cancellationToken = default)
    {
        if (schemaId <= 0)
        {
            throw new ArgumentException("SchemaId must be greater than zero.", nameof(schemaId));
        }

        if (request is null)
        {
            throw new ArgumentException("Relationship update request is required.", nameof(request));
        }

        var schema = await _schemaRepository.GetByIdAsync(schemaId, cancellationToken);
        if (schema is null)
        {
            throw new KeyNotFoundException("Schema not found.");
        }

        var document = SchemaDocumentFactory.Deserialize(schema.SchemaJson);
        document.Relationships = SchemaDocumentFactory.NormalizeRelationships(request.Relationships);

        var relationshipsJson = SchemaDocumentFactory.SerializeRelationships(document.Relationships);
        var schemaJson = SchemaDocumentFactory.Serialize(document);
        var sqlContent = SchemaDocumentFactory.GenerateSql(document);
        var updatedAt = DateTime.UtcNow;

        var updatedSchema = await _schemaRepository.UpdateRelationshipsAsync(
            schemaId,
            relationshipsJson,
            schemaJson,
            sqlContent,
            updatedAt,
            cancellationToken);

        if (updatedSchema is null)
        {
            throw new KeyNotFoundException("Schema not found.");
        }

        return MapToResponse(updatedSchema);
    }

    private static SchemaResponseDto MapToResponse(DatabaseSchema schema)
    {
        var document = SchemaDocumentFactory.Deserialize(schema.SchemaJson);

        return new SchemaResponseDto
        {
            Id = schema.Id,
            SchemaId = schema.Id,
            ProjectId = schema.ProjectId,
            DatasetId = schema.DatasetId,
            SchemaName = schema.SchemaName,
            GeneratedTableName = document.TableName,
            GeneratedColumns = document.Columns,
            SqlPreview = schema.SqlContent ?? SchemaDocumentFactory.GenerateSql(document),
            Relationships = document.Relationships,
            DbmlContent = schema.DbmlContent,
            SchemaJson = schema.SchemaJson,
            SqlContent = schema.SqlContent,
            RelationshipsJson = schema.RelationshipsJson,
            Version = schema.Version,
            Status = schema.Status,
            CreatedAt = schema.CreatedAt,
            UpdatedAt = schema.UpdatedAt
        };
    }
}
