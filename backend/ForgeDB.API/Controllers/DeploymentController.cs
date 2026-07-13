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
[Route("api/projects/{projectId:int}/deployments")]
public class DeploymentController : ControllerBase
{
    private readonly IDeploymentService _deploymentService;
    private readonly IProjectRepository _projectRepository;

    public DeploymentController(IDeploymentService deploymentService, IProjectRepository projectRepository)
    {
        _deploymentService = deploymentService;
        _projectRepository = projectRepository;
    }

    [HttpPost]
    public async Task<ActionResult<DeploymentResponseDto>> Deploy(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            var ifMatchRevision = RequireIfMatch();
            return Ok(await _deploymentService.DeployAsync(projectId, GetUserId(), ifMatchRevision, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (InvalidOperationException exception)
        {
            return UnprocessableEntity(new { message = exception.Message });
        }
        catch (DesignValidationFailedException exception)
        {
            return UnprocessableEntity(new { message = exception.Message, issues = exception.Issues });
        }
        catch (DesignConcurrencyException exception)
        {
            return Conflict(new ConflictResponseDto { CurrentRevision = exception.CurrentRevision, Message = exception.Message });
        }
        catch (DesignPreconditionRequiredException exception)
        {
            return StatusCode(StatusCodes.Status428PreconditionRequired, new { message = exception.Message });
        }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeploymentResponseDto>>> GetHistory(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            return Ok(await _deploymentService.GetHistoryAsync(projectId, cancellationToken));
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpGet("latest")]
    public async Task<ActionResult<DeploymentResponseDto>> GetLatest(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureProjectOwnedAsync(projectId, cancellationToken);
            var latest = await _deploymentService.GetLatestAsync(projectId, cancellationToken);
            return latest is null ? NotFound(new { message = "No deployment has been run for this project yet." }) : Ok(latest);
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
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
        if (projectId <= 0) throw new ArgumentException("ProjectId must be greater than zero.");
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }

    private int RequireIfMatch()
    {
        if (!Request.Headers.TryGetValue("If-Match", out var values) || string.IsNullOrWhiteSpace(values.FirstOrDefault()))
        {
            throw new DesignPreconditionRequiredException();
        }

        return int.TryParse(values.First(), out var revision)
            ? revision
            : throw new ArgumentException("If-Match header must be an integer revision.");
    }
}
