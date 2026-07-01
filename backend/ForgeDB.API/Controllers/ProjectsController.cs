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
}
