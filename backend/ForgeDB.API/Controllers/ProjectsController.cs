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

    // Creates a project for the JWT owner. The client-provided UserId is overwritten because owner
    // identity must come from the signed token. CreatedAtAction returns 201 Created plus the GET
    // route for the new resource; validation failures return 400 Bad Request. CancellationToken
    // flows from the disconnected HTTP request through service and repository calls.
    [HttpPost]
    public async Task<ActionResult<ProjectResponseDto>> Create([FromBody] ProjectCreateDto request, CancellationToken cancellationToken)
    {
        try
        {
            request.UserId = GetUserId();
            var project = await _projectService.CreateProjectAsync(request, cancellationToken);
            return CreatedAtAction(nameof(GetById), new { projectId = project.Id }, project);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    // Returns 200 OK for an owned project, 404 when absent, 403 when it belongs to another user,
    // or 400 for an invalid identifier. Ownership is checked before project data leaves the API.
    [HttpGet("{projectId:int}")]
    public async Task<ActionResult<ProjectResponseDto>> GetById(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            var project = await _projectService.GetProjectByIdAsync(projectId, cancellationToken);
            if (project is null) return NotFound(new { message = "Project not found." });
            if (project.UserId != GetUserId()) return StatusCode(403, new { message = "The project does not belong to the authenticated user." });

            return Ok(project);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    // Lists projects only when the route user matches the JWT user. This prevents a caller from
    // enumerating another account's projects by changing the URL; a missing user maps to 404.
    [HttpGet("user/{userId:int}")]
    public async Task<ActionResult<IEnumerable<ProjectResponseDto>>> GetByUserId(int userId, CancellationToken cancellationToken)
    {
        if (userId != GetUserId())
        {
            return StatusCode(403, new { message = "You may only list your own projects." });
        }

        try
        {
            var projects = await _projectService.GetProjectsByUserIdAsync(userId, cancellationToken);

            return projects is null ? NotFound(new { message = "User not found." }) : Ok(projects);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    // Verifies ownership before delegating editable fields to the service. A successful update
    // returns 200 with the new representation; invalid input, forbidden access, and absence map
    // to 400, 403, and 404 respectively.
    [HttpPut("{projectId:int}")]
    public async Task<ActionResult<ProjectResponseDto>> Update(int projectId, [FromBody] ProjectUpdateDto request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            var project = await _projectService.UpdateProjectAsync(projectId, request, cancellationToken);
            return project is null ? NotFound(new { message = "Project not found." }) : Ok(project);
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

    // Checks ownership before deletion and returns 204 No Content when the repository removes the
    // project. Returning no body communicates that the resource no longer has a representation.
    [HttpDelete("{projectId:int}")]
    public async Task<IActionResult> Delete(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureOwnedProjectAsync(projectId, cancellationToken);
            var deleted = await _projectService.DeleteProjectAsync(projectId, cancellationToken);
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
}
