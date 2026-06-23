using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DeploymentsController : ControllerBase
{
    private readonly IDeploymentService _deploymentService;

    public DeploymentsController(IDeploymentService deploymentService)
    {
        _deploymentService = deploymentService;
    }

    [HttpPost]
    public async Task<ActionResult<DeploymentResponseDto>> Deploy(DeploymentRequestDto request, CancellationToken cancellationToken)
    {
        return Ok(await _deploymentService.DeploySchemaAsync(request, cancellationToken));
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<ActionResult<IEnumerable<DeploymentResponseDto>>> GetByProject(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _deploymentService.GetProjectDeploymentsAsync(projectId, cancellationToken));
    }
}
