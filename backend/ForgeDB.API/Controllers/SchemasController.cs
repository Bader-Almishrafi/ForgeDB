using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SchemasController : ControllerBase
{
    private readonly ISchemaService _schemaService;

    public SchemasController(ISchemaService schemaService)
    {
        _schemaService = schemaService;
    }

    [HttpPost("generate")]
    public async Task<ActionResult<SchemaResponseDto>> Generate(SchemaGenerateRequestDto request, CancellationToken cancellationToken)
    {
        return Ok(await _schemaService.GenerateSchemaAsync(request, cancellationToken));
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<ActionResult<IEnumerable<SchemaResponseDto>>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _schemaService.GetProjectSchemasAsync(projectId, cancellationToken));
    }
}
