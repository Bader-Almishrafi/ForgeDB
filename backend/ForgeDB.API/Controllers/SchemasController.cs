using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api")]
public class SchemasController : ControllerBase
{
    private readonly ISchemaService _schemaService;
    private readonly IDeploymentService _deploymentService;

    public SchemasController(ISchemaService schemaService, IDeploymentService deploymentService)
    {
        _schemaService = schemaService;
        _deploymentService = deploymentService;
    }

    [HttpPost("datasets/{datasetId:int}/schema/generate")]
    public async Task<ActionResult<SchemaResponseDto>> Generate(int datasetId, SchemaGenerateRequestDto request, CancellationToken cancellationToken)
    {
        return Ok(await _schemaService.GenerateSchemaAsync(datasetId, request, cancellationToken));
    }

    [HttpGet("schemas/{schemaId:int}")]
    public async Task<ActionResult<SchemaResponseDto>> GetById(int schemaId, CancellationToken cancellationToken)
    {
        return Ok(await _schemaService.GetSchemaByIdAsync(schemaId, cancellationToken));
    }

    [HttpPut("schemas/{schemaId:int}/relationships")]
    public async Task<ActionResult<SchemaResponseDto>> UpdateRelationships(int schemaId, SchemaRelationshipsUpdateDto request, CancellationToken cancellationToken)
    {
        return Ok(await _schemaService.UpdateRelationshipsAsync(schemaId, request, cancellationToken));
    }

    [HttpPost("schemas/{schemaId:int}/deploy")]
    public async Task<ActionResult<DeploymentResponseDto>> Deploy(int schemaId, DeploymentRequestDto request, CancellationToken cancellationToken)
    {
        return Ok(await _deploymentService.DeploySchemaAsync(schemaId, request, cancellationToken));
    }
}
