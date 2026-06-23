using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    [HttpPost("register")]
    public async Task<ActionResult> Register(RegisterRequestDto request, CancellationToken cancellationToken)
    {
        await _authService.RegisterAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status501NotImplemented);
    }

    [HttpPost("login")]
    public async Task<ActionResult> Login(LoginRequestDto request, CancellationToken cancellationToken)
    {
        await _authService.LoginAsync(request, cancellationToken);
        return StatusCode(StatusCodes.Status501NotImplemented);
    }
}
