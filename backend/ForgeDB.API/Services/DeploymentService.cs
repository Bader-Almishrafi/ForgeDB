using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class DeploymentService : IDeploymentService
{
    private readonly IDeploymentRepository _deploymentRepository;
    private readonly ISchemaRepository _schemaRepository;

    public DeploymentService(IDeploymentRepository deploymentRepository, ISchemaRepository schemaRepository)
    {
        _deploymentRepository = deploymentRepository;
        _schemaRepository = schemaRepository;
    }

    public async Task<DeploymentResponseDto> DeploySchemaAsync(int schemaId, DeploymentRequestDto request, CancellationToken cancellationToken = default)
    {
        if (schemaId <= 0)
        {
            throw new ArgumentException("SchemaId must be greater than zero.", nameof(schemaId));
        }

        if (request is null)
        {
            throw new ArgumentException("Deployment request is required.", nameof(request));
        }

        var schema = await _schemaRepository.GetByIdAsync(schemaId, cancellationToken);
        if (schema is null)
        {
            throw new KeyNotFoundException("Schema not found.");
        }

        var document = SchemaDocumentFactory.Deserialize(schema.SchemaJson);
        var sqlScript = SchemaDocumentFactory.GenerateSql(document);
        var createdAt = DateTime.UtcNow;

        var deployment = new DatabaseDeployment
        {
            SchemaId = schema.Id,
            ProjectId = schema.ProjectId,
            DatabaseName = SchemaDocumentFactory.ResolveDeploymentDatabaseName(request.DatabaseName, schema),
            Status = "Generated",
            GeneratedSql = sqlScript,
            CreatedAt = createdAt,
            DeployedAt = null
        };

        await _deploymentRepository.AddAsync(deployment, cancellationToken);

        return MapToResponse(deployment);
    }

    private static DeploymentResponseDto MapToResponse(DatabaseDeployment deployment)
    {
        return new DeploymentResponseDto
        {
            Id = deployment.Id,
            DeploymentId = deployment.Id,
            ProjectId = deployment.ProjectId,
            SchemaId = deployment.SchemaId,
            DatabaseName = deployment.DatabaseName,
            Status = deployment.Status,
            SqlScript = deployment.GeneratedSql,
            CreatedAt = deployment.CreatedAt,
            DeployedAt = deployment.DeployedAt
        };
    }
}
