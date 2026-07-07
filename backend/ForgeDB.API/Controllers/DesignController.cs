using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api")]
public class DesignController : ControllerBase
{
    private readonly IDesignService _designService;

    public DesignController(IDesignService designService)
    {
        _designService = designService;
    }

    [HttpGet("projects/{projectId:int}/design")]
    public async Task<ActionResult<DesignResponseDto>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        var design = await _designService.GetByProjectIdAsync(projectId, cancellationToken);
        return design is null ? NotFound(new { message = "No design exists for this project yet." }) : Ok(design);
    }

    [HttpPost("projects/{projectId:int}/design/generate")]
    public async Task<ActionResult<DesignResponseDto>> Generate(int projectId, GenerateDesignRequestDto? request, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _designService.GenerateAsync(projectId, request ?? new GenerateDesignRequestDto(), cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("designs/{designId:int}/preview")]
    public async Task<ActionResult<string>> Preview(int designId, [FromQuery] string format, CancellationToken cancellationToken)
    {
        try
        {
            var content = await _designService.PreviewAsync(designId, format, cancellationToken);
            return Content(content, "text/plain");
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpGet("designs/{designId:int}/validation")]
    public async Task<ActionResult<List<ValidationIssueDto>>> GetValidation(int designId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _designService.GetValidationAsync(designId, cancellationToken));
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("designs/{designId:int}/tables")]
    public Task<ActionResult<DesignResponseDto>> CreateTable(int designId, CreateDesignTableRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.CreateTableAsync(designId, revision, request, cancellationToken));
    }

    [HttpPatch("design-tables/{tableId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateTable(int tableId, UpdateDesignTableRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.UpdateTableAsync(tableId, revision, request, cancellationToken));
    }

    [HttpDelete("design-tables/{tableId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteTable(int tableId, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.DeleteTableAsync(tableId, revision, cancellationToken));
    }

    [HttpPost("design-tables/{tableId:int}/columns")]
    public Task<ActionResult<DesignResponseDto>> CreateColumn(int tableId, CreateDesignColumnRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.CreateColumnAsync(tableId, revision, request, cancellationToken));
    }

    [HttpPatch("design-columns/{columnId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateColumn(int columnId, UpdateDesignColumnRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.UpdateColumnAsync(columnId, revision, request, cancellationToken));
    }

    [HttpDelete("design-columns/{columnId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteColumn(int columnId, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.DeleteColumnAsync(columnId, revision, cancellationToken));
    }

    [HttpPost("designs/{designId:int}/relationships")]
    public Task<ActionResult<DesignResponseDto>> CreateRelationship(int designId, CreateDesignRelationshipRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.CreateRelationshipAsync(designId, revision, request, cancellationToken));
    }

    [HttpPatch("design-relationships/{relationshipId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateRelationship(int relationshipId, UpdateDesignRelationshipRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.UpdateRelationshipAsync(relationshipId, revision, request, cancellationToken));
    }

    [HttpDelete("design-relationships/{relationshipId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteRelationship(int relationshipId, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.DeleteRelationshipAsync(relationshipId, revision, cancellationToken));
    }

    [HttpPut("designs/{designId:int}/layout")]
    public Task<ActionResult<DesignResponseDto>> UpdateLayout(int designId, UpdateDesignLayoutRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(revision => _designService.UpdateLayoutAsync(designId, revision, request, cancellationToken));
    }

    /// <summary>Every mutating design endpoint requires If-Match; missing -&gt; 428, unparsable
    /// -&gt; 400, stale/racing revision -&gt; 409 with the current revision.</summary>
    private async Task<ActionResult<DesignResponseDto>> WithIfMatch(Func<int, Task<DesignResponseDto>> action)
    {
        if (!Request.Headers.TryGetValue("If-Match", out var values) || string.IsNullOrWhiteSpace(values.FirstOrDefault()))
        {
            return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = "If-Match header with the current revision is required." });
        }

        var raw = values.First()!.Trim().Trim('"');
        if (!int.TryParse(raw, out var revision))
        {
            return BadRequest(new { message = "If-Match header must be an integer revision." });
        }

        try
        {
            return Ok(await action(revision));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (DesignConcurrencyException exception)
        {
            return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message });
        }
    }
}
