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
    public async Task<ActionResult<ProjectResponseDto>> Create(ProjectCreateDto request, CancellationToken cancellationToken)
    {
        return Ok(await _projectService.CreateProjectAsync(request, cancellationToken));
    }

    [HttpGet("{projectId:int}")]
    public async Task<ActionResult<ProjectResponseDto>> GetById(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _projectService.GetProjectByIdAsync(projectId, cancellationToken));
    }
}
