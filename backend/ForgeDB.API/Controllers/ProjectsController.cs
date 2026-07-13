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
        var project = await _projectRepository.GetByIdAsync(projectId, cancellationToken);
        if (project is not null && project.UserId != GetUserId())
        {
            throw new UnauthorizedAccessException("The project does not belong to the authenticated user.");
        }
    }
}
