using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _projectService;

    public ProjectsController(IProjectService projectService)
    {
        _projectService = projectService;
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ProjectResponseDto>> GetById(int id, CancellationToken cancellationToken)
    {
        return Ok(await _projectService.GetProjectByIdAsync(id, cancellationToken));
    }

    [HttpGet("user/{userId:int}")]
    public async Task<ActionResult<IEnumerable<ProjectResponseDto>>> GetByUser(int userId, CancellationToken cancellationToken)
    {
        return Ok(await _projectService.GetProjectsByUserIdAsync(userId, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ProjectResponseDto>> Create(ProjectCreateDto request, CancellationToken cancellationToken)
    {
        return Ok(await _projectService.CreateProjectAsync(request, cancellationToken));
    }
}
