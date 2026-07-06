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
        try
        {
            var schema = await _schemaService.GenerateSchemaAsync(datasetId, request, cancellationToken);
            return CreatedAtAction(nameof(GetById), new { schemaId = schema.SchemaId }, schema);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("schemas/{schemaId:int}")]
    public async Task<ActionResult<SchemaResponseDto>> GetById(int schemaId, CancellationToken cancellationToken)
    {
        try
        {
            var schema = await _schemaService.GetSchemaByIdAsync(schemaId, cancellationToken);
            return schema is null ? NotFound(new { message = "Schema not found." }) : Ok(schema);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpGet("datasets/{datasetId:int}/schema")]
    public async Task<ActionResult<SchemaResponseDto>> GetLatestByDatasetId(int datasetId, CancellationToken cancellationToken)
    {
        try
        {
            var schema = await _schemaService.GetLatestSchemaByDatasetIdAsync(datasetId, cancellationToken);
            return schema is null ? NotFound(new { message = "Schema not found for dataset." }) : Ok(schema);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpPut("schemas/{schemaId:int}/relationships")]
    public async Task<ActionResult<SchemaResponseDto>> UpdateRelationships(int schemaId, SchemaRelationshipsUpdateDto request, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _schemaService.UpdateRelationshipsAsync(schemaId, request, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("schemas/{schemaId:int}/deploy")]
    public async Task<ActionResult<DeploymentResponseDto>> Deploy(int schemaId, DeploymentRequestDto request, CancellationToken cancellationToken)
    {
        try
        {
            var deployment = await _deploymentService.DeploySchemaAsync(schemaId, request, cancellationToken);
            return StatusCode(StatusCodes.Status201Created, deployment);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }
}
