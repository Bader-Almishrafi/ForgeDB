using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class RelationshipSuggestionsController : ControllerBase
{
    private readonly IRelationshipDetectionService _detectionService;
    private readonly IProjectRepository _projectRepository;
    private readonly IRelationshipSuggestionRepository _suggestionRepository;

    public RelationshipSuggestionsController(
        IRelationshipDetectionService detectionService,
        IProjectRepository projectRepository,
        IRelationshipSuggestionRepository suggestionRepository)
    {
        _detectionService = detectionService;
        _projectRepository = projectRepository;
        _suggestionRepository = suggestionRepository;
    }

    [HttpGet("projects/{projectId:int}/relationship-suggestions")]
    public async Task<ActionResult<List<RelationshipSuggestionResponseDto>>> GetSuggestions(
        int projectId,
        [FromQuery] string? status,
        CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            return Ok(await _detectionService.GetSuggestionsAsync(projectId, status, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpPost("projects/{projectId:int}/relationship-suggestions/detect")]
    public async Task<ActionResult<List<RelationshipSuggestionResponseDto>>> Detect(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            return Ok(await _detectionService.DetectAsync(projectId, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("relationship-suggestions/{id:int}/accept")]
    public async Task<ActionResult<AcceptSuggestionResponseDto>> Accept(
        int id,
        [FromBody] AcceptSuggestionRequestDto? request,
        CancellationToken cancellationToken)
    {
        // Accept mutates the project's DesignModel (new DesignRelationship + revision bump), so
        // it follows the same If-Match contract as every DesignController mutation: missing -> 428,
        // stale/racing revision -> 409 with currentRevision. Reject has no such header — see the
        // comment on RejectAsync.
        if (!Request.Headers.TryGetValue("If-Match", out var values) || string.IsNullOrWhiteSpace(values.FirstOrDefault()))
        {
            return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = "If-Match header with the current design revision is required." });
        }

        var raw = values.First()!.Trim().Trim('"');
        if (!int.TryParse(raw, out var revision))
        {
            return BadRequest(new { message = "If-Match header must be an integer revision." });
        }

        try
        {
            await EnsureSuggestionOwnedAsync(id, cancellationToken);
            return Ok(await _detectionService.AcceptAsync(id, revision, request, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (DesignConcurrencyException exception)
        {
            return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message });
        }
        catch (RelationshipSuggestionConflictException exception)
        {
            return Conflict(new { message = exception.Message });
        }
    }

    [HttpPost("relationship-suggestions/{id:int}/reject")]
    public async Task<ActionResult<RelationshipSuggestionResponseDto>> Reject(int id, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureSuggestionOwnedAsync(id, cancellationToken);
            return Ok(await _detectionService.RejectAsync(id, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (RelationshipSuggestionConflictException exception)
        {
            return Conflict(new { message = exception.Message });
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

    private async Task EnsureProjectOwnedAsync(int projectId, CancellationToken cancellationToken)
    {
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }

    private async Task EnsureSuggestionOwnedAsync(int suggestionId, CancellationToken cancellationToken)
    {
        var suggestion = await _suggestionRepository.GetByIdAsync(suggestionId, cancellationToken);
        if (suggestion is null) return;
        await EnsureProjectOwnedAsync(suggestion.ProjectId, cancellationToken);
    }
}
