using ForgeDB.API.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("health")]
public sealed class HealthController : ControllerBase
{
    private readonly ForgeDbContext _context;

    public HealthController(ForgeDbContext context)
    {
        _context = context;
    }

    [AllowAnonymous]
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        try
        {
            if (!await _context.Database.CanConnectAsync(cancellationToken))
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, UnhealthyResponse());
            }

            return Ok(new
            {
                status = "healthy",
                service = "ForgeDB API",
                database = "connected"
            });
        }
        catch
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, UnhealthyResponse());
        }
    }

    private static object UnhealthyResponse() => new
    {
        status = "unhealthy",
        service = "ForgeDB API",
        database = "unavailable"
    };
}
