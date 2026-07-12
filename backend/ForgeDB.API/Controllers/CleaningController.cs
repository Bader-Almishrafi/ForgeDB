using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Authorize]
[Route("api/projects/{projectId:int}/cleaning")]
public class CleaningController : ControllerBase
{
    private readonly ICleaningService _service;

    public CleaningController(ICleaningService service)
    {
        _service = service;
    }

    [HttpGet("summary")]
    public Task<ActionResult<ProjectCleaningSummaryDto>> GetSummary(int projectId, CancellationToken cancellationToken) =>
        Execute(() => _service.GetSummaryAsync(projectId, GetUserId(), cancellationToken));

    [HttpGet("suggestions")]
    public Task<ActionResult<IReadOnlyList<CleaningSuggestionDto>>> GetSuggestions(
        int projectId,
        [FromQuery] int? datasetId,
        [FromQuery] string? issueType,
        [FromQuery] string? column,
        [FromQuery] string? search,
        CancellationToken cancellationToken) =>
        Execute(() => _service.GetSuggestionsAsync(projectId, GetUserId(), datasetId, issueType, column, search, cancellationToken));

    [HttpPost("preview")]
    public Task<ActionResult<CleaningPreviewResponseDto>> Preview(int projectId, [FromBody] CleaningPreviewRequestDto request, CancellationToken cancellationToken) =>
        Execute(() => _service.PreviewAsync(projectId, GetUserId(), request, cancellationToken));

    [HttpPost("apply")]
    public Task<ActionResult<CleaningApplyResponseDto>> Apply(int projectId, [FromBody] CleaningApplyRequestDto request, CancellationToken cancellationToken) =>
        Execute(() => _service.ApplyAsync(projectId, GetUserId(), request, cancellationToken));

    [HttpPost("apply-recommended")]
    public Task<ActionResult<CleaningApplyResponseDto>> ApplyRecommended(int projectId, [FromBody] CleaningApplyRecommendedRequestDto request, CancellationToken cancellationToken) =>
        Execute(() => _service.ApplyRecommendedAsync(projectId, GetUserId(), request, cancellationToken));

    [HttpGet("history")]
    public Task<ActionResult<CleaningHistoryDto>> GetHistory(int projectId, CancellationToken cancellationToken) =>
        Execute(() => _service.GetHistoryAsync(projectId, GetUserId(), cancellationToken));

    [HttpGet("datasets/{datasetId:int}/versions")]
    public Task<ActionResult<IReadOnlyList<DatasetVersionDto>>> GetVersions(int projectId, int datasetId, CancellationToken cancellationToken) =>
        Execute(() => _service.GetVersionsAsync(projectId, datasetId, GetUserId(), cancellationToken));

    [HttpGet("datasets/{datasetId:int}/preview")]
    public Task<ActionResult<CleanedDatasetPreviewDto>> GetActivePreview(int projectId, int datasetId, CancellationToken cancellationToken) =>
        Execute(() => _service.GetActivePreviewAsync(projectId, datasetId, GetUserId(), cancellationToken));

    [HttpPost("undo-latest")]
    public Task<ActionResult<CleaningApplyResponseDto>> UndoLatest(int projectId, CancellationToken cancellationToken) =>
        Execute(() => _service.UndoLatestAsync(projectId, GetUserId(), cancellationToken));

    [HttpPost("datasets/{datasetId:int}/restore")]
    public Task<ActionResult<CleaningApplyResponseDto>> Restore(int projectId, int datasetId, [FromBody] CleaningRestoreRequestDto request, CancellationToken cancellationToken) =>
        Execute(() => _service.RestoreVersionAsync(projectId, datasetId, GetUserId(), request, cancellationToken));

    [HttpPost("confirm-quality")]
    public Task<ActionResult<QualityConfirmationDto>> ConfirmQuality(int projectId, CancellationToken cancellationToken) =>
        Execute(() => _service.ConfirmQualityAsync(projectId, GetUserId(), cancellationToken));

    private int GetUserId()
    {
        var value = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        return int.TryParse(value, out var userId) && userId > 0
            ? userId
            : throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
    }

    private async Task<ActionResult<T>> Execute<T>(Func<Task<T>> action)
    {
        try
        {
            return Ok(await action());
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new ProblemDetails { Status = 400, Title = "Cleaning request is invalid", Detail = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new ProblemDetails { Status = 403, Title = "Access denied", Detail = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new ProblemDetails { Status = 404, Title = "Cleaning resource not found", Detail = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(new ProblemDetails { Status = 409, Title = "Cleaning operation cannot continue", Detail = exception.Message });
        }
        catch (HttpRequestException)
        {
            return StatusCode(502, new ProblemDetails { Status = 502, Title = "Cleaning execution unavailable", Detail = "The tabular cleaning service could not complete the request." });
        }
    }
}
