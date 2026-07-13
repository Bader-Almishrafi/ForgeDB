using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/projects")]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _projectService;

    public ProjectsController(IProjectService projectService)
    {
        _projectService = projectService;
    }

    [HttpPost]
    public async Task<ActionResult<ProjectResponseDto>> Create([FromBody] ProjectCreateDto request, CancellationToken cancellationToken)
    {
        try
        {
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

            return project is null ? NotFound(new { message = "Project not found." }) : Ok(project);
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [HttpGet("user/{userId:int}")]
    public async Task<ActionResult<IEnumerable<ProjectResponseDto>>> GetByUserId(int userId, CancellationToken cancellationToken)
    {
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

    [HttpGet("{projectId:int}/overview")]
    public async Task<ActionResult<ProjectOverviewDto>> GetOverview(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GetProjectOverviewAsync(projectId, cancellationToken));
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

    [HttpGet("{projectId:int}/relationships/suggestions")]
    public async Task<ActionResult<IEnumerable<ProjectRelationshipSuggestionDto>>> GetRelationshipSuggestions(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GetRelationshipSuggestionsAsync(projectId, cancellationToken));
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

    [HttpPost("{projectId:int}/relationships/accept")]
    public async Task<ActionResult<IEnumerable<ProjectRelationshipSuggestionDto>>> AcceptRelationship(
        int projectId,
        ProjectRelationshipDecisionDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.AcceptRelationshipAsync(projectId, request, cancellationToken));
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

    [HttpPost("{projectId:int}/relationships/reject")]
    public async Task<ActionResult<IEnumerable<ProjectRelationshipSuggestionDto>>> RejectRelationship(
        int projectId,
        ProjectRelationshipDecisionDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.RejectRelationshipAsync(projectId, request, cancellationToken));
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

    [HttpGet("{projectId:int}/schema")]
    public async Task<ActionResult<ProjectSchemaDto>> GetProjectSchema(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GetProjectSchemaAsync(projectId, cancellationToken));
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

    [HttpPost("{projectId:int}/schema/generate")]
    public async Task<ActionResult<ProjectSchemaDto>> GenerateProjectSchema(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GenerateProjectSchemaAsync(projectId, cancellationToken));
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

    [HttpGet("{projectId:int}/exports/package")]
    public async Task<ActionResult<ProjectExportPackageDto>> GetExportPackage(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _projectService.GetProjectExportPackageAsync(projectId, cancellationToken));
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

    [HttpDelete("{projectId:int}")]
    public async Task<ActionResult> Delete(int projectId, CancellationToken cancellationToken)
    {
        try
        {
            await _projectService.DeleteProjectAsync(projectId, cancellationToken);
            return NoContent();
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
}
