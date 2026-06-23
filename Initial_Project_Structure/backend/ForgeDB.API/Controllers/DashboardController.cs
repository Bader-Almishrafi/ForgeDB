using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DashboardController : ControllerBase
{
    private readonly IDashboardService _dashboardService;

    public DashboardController(IDashboardService dashboardService)
    {
        _dashboardService = dashboardService;
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<ActionResult<DashboardResponseDto>> GetProjectDashboard(int projectId, CancellationToken cancellationToken)
    {
        return Ok(await _dashboardService.GetProjectDashboardAsync(projectId, cancellationToken));
    }
}
