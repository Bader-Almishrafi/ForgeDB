using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;

namespace ForgeDB.API.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class DesignController : ControllerBase
{
    private readonly IDesignService _designService;
    private readonly ICleaningRepository _cleaningRepository;
    private readonly IDesignRepository _designRepository;

    public DesignController(IDesignService designService, ICleaningRepository cleaningRepository, IDesignRepository designRepository)
    {
        _designService = designService;
        _cleaningRepository = cleaningRepository;
        _designRepository = designRepository;
    }

    [HttpGet("projects/{projectId:int}/design")]
    public async Task<ActionResult<DesignResponseDto>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            var design = await _designService.GetByProjectIdAsync(projectId, cancellationToken);
            return design is null ? NotFound(new { message = "No design exists for this project yet." }) : Ok(design);
        }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (UnauthorizedAccessException exception) { return StatusCode(403, new { message = exception.Message }); }
    }

    [HttpPost("projects/{projectId:int}/design/generate")]
    public async Task<ActionResult<DesignResponseDto>> Generate(int projectId, GenerateDesignRequestDto? request, CancellationToken cancellationToken)
    {
        // Unlike every other mutating endpoint, If-Match here is conditional: required only when
        // a DesignModel already exists (checked inside the service, atomically with the rest of
        // the operation). A fresh create has no revision to compare against, so a missing/absent
        // header is not an error in that case.
        int? ifMatchRevision = null;
        if (Request.Headers.TryGetValue("If-Match", out var values) && !string.IsNullOrWhiteSpace(values.FirstOrDefault()))
        {
            var raw = values.First()!.Trim().Trim('"');
            if (!int.TryParse(raw, out var parsedRevision))
            {
                return BadRequest(new { message = "If-Match header must be an integer revision." });
            }

            ifMatchRevision = parsedRevision;
        }

        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            if (!await _cleaningRepository.IsSchemaReadyAsync(projectId, cancellationToken))
            {
                return Conflict(new
                {
                    message = "Confirm the cleaned, re-analyzed dataset versions before generating a schema."
                });
            }

            return Ok(await _designService.GenerateAsync(projectId, request ?? new GenerateDesignRequestDto(), ifMatchRevision, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (DesignPreconditionRequiredException exception)
        {
            return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = exception.Message });
        }
        catch (DesignConcurrencyException exception)
        {
            return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message });
        }
    }

    [HttpGet("projects/{projectId:int}/schema")]
    public async Task<ActionResult<DesignResponseDto>> GetSchema(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            var schema = await _designService.GetSchemaWorkspaceAsync(projectId, cancellationToken);
            return schema is null ? NotFound(new { message = "No schema draft exists for this project yet." }) : Ok(schema);
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpPost("projects/{projectId:int}/schema/generate")]
    public async Task<ActionResult<DesignResponseDto>> GenerateSchema(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            return Ok(await _designService.GenerateSchemaAsync(projectId, GetUserId(), ReadOptionalIfMatch(), cancellationToken));
        }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (UnauthorizedAccessException exception) { return StatusCode(403, new { message = exception.Message }); }
        catch (KeyNotFoundException exception) { return NotFound(new { message = exception.Message }); }
        catch (DesignPreconditionRequiredException exception) { return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = exception.Message }); }
        catch (DesignConcurrencyException exception) { return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message }); }
        catch (InvalidOperationException exception) { return Conflict(new { message = exception.Message }); }
    }

    [HttpPatch("projects/{projectId:int}/schema/draft")]
    public async Task<ActionResult<DesignResponseDto>> SaveSchemaDraft(int projectId, SaveDesignDraftRequestDto request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            var revision = ReadRequiredIfMatch();
            return Ok(await _designService.SaveSchemaDraftAsync(projectId, GetUserId(), revision, request, cancellationToken));
        }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (UnauthorizedAccessException exception) { return StatusCode(403, new { message = exception.Message }); }
        catch (KeyNotFoundException exception) { return NotFound(new { message = exception.Message }); }
        catch (DesignPreconditionRequiredException exception) { return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = exception.Message }); }
        catch (DesignConcurrencyException exception) { return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message }); }
    }

    [HttpPost("projects/{projectId:int}/schema/validate")]
    public async Task<ActionResult<DesignResponseDto>> ValidateSchema(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            return Ok(await _designService.ValidateSchemaAsync(projectId, GetUserId(), ReadRequiredIfMatch(), cancellationToken));
        }
        catch (ArgumentException exception) { return BadRequest(new { message = exception.Message }); }
        catch (UnauthorizedAccessException exception) { return StatusCode(403, new { message = exception.Message }); }
        catch (KeyNotFoundException exception) { return NotFound(new { message = exception.Message }); }
        catch (DesignPreconditionRequiredException exception) { return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = exception.Message }); }
        catch (DesignConcurrencyException exception) { return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message }); }
    }

    [HttpGet("projects/{projectId:int}/schema/sql")]
    public async Task<ActionResult<SchemaSqlPreviewDto>> GetSchemaSql(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            return Ok(await _designService.GetSchemaSqlAsync(projectId, cancellationToken));
        }
        catch (UnauthorizedAccessException exception) { return StatusCode(403, new { message = exception.Message }); }
        catch (KeyNotFoundException exception) { return NotFound(new { message = exception.Message }); }
    }

    [HttpGet("designs/{designId:int}/preview")]
    public async Task<ActionResult<string>> Preview(int designId, [FromQuery] string format, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDesignOwnedAsync(designId, cancellationToken);
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
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpGet("designs/{designId:int}/validation")]
    public async Task<ActionResult<List<ValidationIssueDto>>> GetValidation(int designId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureDesignOwnedAsync(designId, cancellationToken);
            return Ok(await _designService.GetValidationAsync(designId, cancellationToken));
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpPost("designs/{designId:int}/tables")]
    public Task<ActionResult<DesignResponseDto>> CreateTable(int designId, CreateDesignTableRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureDesignOwnedAsync(designId, cancellationToken); return await _designService.CreateTableAsync(designId, revision, request, cancellationToken); });
    }

    [HttpPatch("design-tables/{tableId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateTable(int tableId, UpdateDesignTableRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureTableOwnedAsync(tableId, cancellationToken); return await _designService.UpdateTableAsync(tableId, revision, request, cancellationToken); });
    }

    [HttpDelete("design-tables/{tableId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteTable(int tableId, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureTableOwnedAsync(tableId, cancellationToken); return await _designService.DeleteTableAsync(tableId, revision, cancellationToken); });
    }

    [HttpPost("design-tables/{tableId:int}/columns")]
    public Task<ActionResult<DesignResponseDto>> CreateColumn(int tableId, CreateDesignColumnRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureTableOwnedAsync(tableId, cancellationToken); return await _designService.CreateColumnAsync(tableId, revision, request, cancellationToken); });
    }

    [HttpPatch("design-columns/{columnId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateColumn(int columnId, UpdateDesignColumnRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureColumnOwnedAsync(columnId, cancellationToken); return await _designService.UpdateColumnAsync(columnId, revision, request, cancellationToken); });
    }

    [HttpDelete("design-columns/{columnId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteColumn(int columnId, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureColumnOwnedAsync(columnId, cancellationToken); return await _designService.DeleteColumnAsync(columnId, revision, cancellationToken); });
    }

    [HttpPost("design-tables/{tableId:int}/columns/reorder")]
    public Task<ActionResult<DesignResponseDto>> ReorderColumns(int tableId, ReorderDesignColumnsRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureTableOwnedAsync(tableId, cancellationToken); return await _designService.ReorderColumnsAsync(tableId, revision, request, cancellationToken); });
    }

    [HttpPost("designs/{designId:int}/relationships")]
    public Task<ActionResult<DesignResponseDto>> CreateRelationship(int designId, CreateDesignRelationshipRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureDesignOwnedAsync(designId, cancellationToken); return await _designService.CreateRelationshipAsync(designId, revision, request, cancellationToken); });
    }

    [HttpPatch("design-relationships/{relationshipId:int}")]
    public Task<ActionResult<DesignResponseDto>> UpdateRelationship(int relationshipId, UpdateDesignRelationshipRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureRelationshipOwnedAsync(relationshipId, cancellationToken); return await _designService.UpdateRelationshipAsync(relationshipId, revision, request, cancellationToken); });
    }

    [HttpDelete("design-relationships/{relationshipId:int}")]
    public Task<ActionResult<DesignResponseDto>> DeleteRelationship(int relationshipId, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureRelationshipOwnedAsync(relationshipId, cancellationToken); return await _designService.DeleteRelationshipAsync(relationshipId, revision, cancellationToken); });
    }

    [HttpPut("designs/{designId:int}/layout")]
    public Task<ActionResult<DesignResponseDto>> UpdateLayout(int designId, UpdateDesignLayoutRequestDto request, CancellationToken cancellationToken)
    {
        return WithIfMatch(async revision => { await EnsureDesignOwnedAsync(designId, cancellationToken); return await _designService.UpdateLayoutAsync(designId, revision, request, cancellationToken); });
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
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (DesignConcurrencyException exception)
        {
            return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message });
        }
    }

    private int GetUserId()
    {
        var value = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        return int.TryParse(value, out var userId) && userId > 0
            ? userId
            : throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
    }

    private async Task EnsureOwnedProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0) throw new ArgumentException("ProjectId must be greater than zero.");
        if (await _cleaningRepository.GetOwnedProjectAsync(projectId, GetUserId(), cancellationToken) is null)
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }

    private int? ReadOptionalIfMatch()
    {
        if (!Request.Headers.TryGetValue("If-Match", out var values) || string.IsNullOrWhiteSpace(values.FirstOrDefault())) return null;
        var raw = values.First()!.Trim().Trim('"');
        return int.TryParse(raw, out var revision)
            ? revision
            : throw new ArgumentException("If-Match header must be an integer revision.");
    }

    private int ReadRequiredIfMatch()
    {
        return ReadOptionalIfMatch() ?? throw new DesignPreconditionRequiredException();
    }

    private async Task EnsureDesignOwnedAsync(int designId, CancellationToken cancellationToken)
    {
        var design = await _designRepository.GetFullByIdAsync(designId, false, cancellationToken)
            ?? throw new KeyNotFoundException("Design not found.");
        await EnsureOwnedProjectAsync(design.ProjectId, cancellationToken);
    }

    private async Task EnsureTableOwnedAsync(int tableId, CancellationToken cancellationToken)
    {
        var designId = await _designRepository.FindDesignModelIdByTableIdAsync(tableId, cancellationToken)
            ?? throw new KeyNotFoundException("Design table not found.");
        await EnsureDesignOwnedAsync(designId, cancellationToken);
    }

    private async Task EnsureColumnOwnedAsync(int columnId, CancellationToken cancellationToken)
    {
        var designId = await _designRepository.FindDesignModelIdByColumnIdAsync(columnId, cancellationToken)
            ?? throw new KeyNotFoundException("Design column not found.");
        await EnsureDesignOwnedAsync(designId, cancellationToken);
    }

    private async Task EnsureRelationshipOwnedAsync(int relationshipId, CancellationToken cancellationToken)
    {
        var designId = await _designRepository.FindDesignModelIdByRelationshipIdAsync(relationshipId, cancellationToken)
            ?? throw new KeyNotFoundException("Design relationship not found.");
        await EnsureDesignOwnedAsync(designId, cancellationToken);
    }
}
