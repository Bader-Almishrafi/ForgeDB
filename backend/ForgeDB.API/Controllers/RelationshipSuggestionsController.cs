using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api")]
public class RelationshipSuggestionsController : ControllerBase
{
    private readonly IRelationshipDetectionService _detectionService;

    public RelationshipSuggestionsController(IRelationshipDetectionService detectionService)
    {
        _detectionService = detectionService;
    }

    [HttpGet("projects/{projectId:int}/relationship-suggestions")]
    public async Task<ActionResult<List<RelationshipSuggestionResponseDto>>> GetSuggestions(
        int projectId,
        [FromQuery] string? status,
        CancellationToken cancellationToken)
    {
        return Ok(await _detectionService.GetSuggestionsAsync(projectId, status, cancellationToken));
    }

    [HttpPost("projects/{projectId:int}/relationship-suggestions/detect")]
    public async Task<ActionResult<List<RelationshipSuggestionResponseDto>>> Detect(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _detectionService.DetectAsync(projectId, cancellationToken));
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
    }

    [HttpPost("relationship-suggestions/{id:int}/accept")]
    public async Task<ActionResult<AcceptSuggestionResponseDto>> Accept(int id, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _detectionService.AcceptAsync(id, cancellationToken));
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

    [HttpPost("relationship-suggestions/{id:int}/reject")]
    public async Task<ActionResult<RelationshipSuggestionResponseDto>> Reject(int id, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _detectionService.RejectAsync(id, cancellationToken));
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
}
