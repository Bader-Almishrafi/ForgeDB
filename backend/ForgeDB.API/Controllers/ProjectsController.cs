using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

// Exposes authenticated Project HTTP endpoints. [Authorize] protects every action in this
// controller; the controller handles routing/status codes, ProjectService owns business rules,
// and repositories own EF Core/PostgreSQL access.
[ApiController]
[Authorize]
[Route("api/projects")]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _projectService;
    private readonly IProjectRepository _projectRepository;

    public ProjectsController(IProjectService projectService, IProjectRepository projectRepository)
    {
        _projectService = projectService;
        _projectRepository = projectRepository;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProjectSummaryDto>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await _projectService.GetProjectsAsync(GetUserId(), cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ProjectDetailsDto>> Create(
        [FromBody] ProjectCreateRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var project = await _projectService.CreateProjectAsync(GetUserId(), request, cancellationToken);
            return CreatedAtAction(nameof(GetById), new { projectId = project.Id }, project);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return StatusCode(403, new { message = exception.Message });
        }
    }

    [HttpGet("{projectId:int}")]
    public async Task<ActionResult<ProjectDetailsDto>> GetById(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GetProjectAsync(projectId, GetUserId(), cancellationToken));
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
    }

    // Lists projects only when the route user matches the JWT user. This prevents a caller from
    // enumerating another account's projects by changing the URL; a missing user maps to 404.
    [HttpGet("user/{userId:int}")]
    [Obsolete("Compatibility endpoint. Use GET /api/projects; removal is planned with the frontend rebuild.")]
    public async Task<ActionResult<IEnumerable<ProjectResponseDto>>> GetByUserId(int userId, CancellationToken cancellationToken)
    {
        if (userId != GetUserId())
        {
            return StatusCode(403, new { message = "You may only list your own projects." });
        }

        try
        {
            Response.Headers["Deprecation"] = "true";
            if (!await _projectRepository.UserExistsAsync(userId, cancellationToken))
            {
                return NotFound(new { message = "User not found." });
            }

            var projects = await _projectRepository.GetByUserIdAsync(userId, cancellationToken);
            return Ok(projects.Select(MapCompatibilityResponse).ToList());
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpPut("{projectId:int}")]
    public async Task<ActionResult<ProjectDetailsDto>> Update(
        int projectId,
        [FromBody] ProjectUpdateRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.UpdateProjectAsync(projectId, GetUserId(), request, cancellationToken));
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
    }

    // Checks ownership before deletion and returns 204 No Content when the repository removes the
    // project. Returning no body communicates that the resource no longer has a representation.
    [HttpDelete("{projectId:int}")]
    public async Task<IActionResult> Delete(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            var deleted = await _projectService.DeleteProjectAsync(projectId, GetUserId(), cancellationToken);
            return deleted ? NoContent() : NotFound(new { message = "Project not found." });
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
    }

    // Returns the owned project's aggregated overview as 200 OK. The action translates invalid,
    // forbidden, and missing cases into 400, 403, and 404 HTTP responses.
    [HttpGet("{projectId:int}/overview")]
    public async Task<ActionResult<ProjectOverviewDto>> GetOverview(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            return Ok(await _projectService.GetProjectOverviewAsync(projectId, cancellationToken));
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
    }

    // Builds generated exports only for the owner. Invalid design state returns 422 Unprocessable
    // Entity because the request is understood but current project data cannot produce artifacts.
    [HttpGet("{projectId:int}/exports/package")]
    public async Task<ActionResult<ProjectExportPackageDto>> GetExportPackage(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            return Ok(await _projectService.GetProjectExportPackageAsync(projectId, cancellationToken));
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
        catch (DesignValidationFailedException exception)
        {
            return UnprocessableEntity(new { message = exception.Message, issues = exception.Issues });
        }
        catch (ProjectWorkflowBlockedException exception)
        {
            return UnprocessableEntity(new { message = exception.Message, blockerCodes = exception.BlockerCodes });
        }
        catch (InvalidOperationException exception)
        {
            return UnprocessableEntity(new { message = exception.Message });
        }
    }

    // Reads the authenticated user ID from signed JWT claims rather than trusting route or body
    // ownership fields supplied by a client.
    private int GetUserId()
    {
        var value = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        return int.TryParse(value, out var userId) && userId > 0
            ? userId
            : throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
    }

    // Performs the common authorization lookup before update, delete, overview, or export work.
    // A missing project is left for the requested operation to report as 404; a different owner
    // fails immediately with 403 through UnauthorizedAccessException.
    private async Task EnsureOwnedProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        if (projectId <= 0) throw new ArgumentException("ProjectId must be greater than zero.");
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }

    private static ProjectResponseDto MapCompatibilityResponse(ForgeDB.API.Models.Entities.Project project)
    {
        return new ProjectResponseDto
        {
            Id = project.Id,
            UserId = project.UserId,
            Name = project.Name,
            Description = project.Description,
            DashboardConfig = project.DashboardConfig,
            CreatedAt = project.CreatedAt,
            UpdatedAt = project.UpdatedAt
        };
    }
}
