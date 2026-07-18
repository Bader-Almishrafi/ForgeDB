using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;

// Translates authentication HTTP requests into service calls and consistent JSON responses.
[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private const string GenericResetRequestMessage =
        "If an account exists for that email, a password reset token has been created.";

    private readonly IAuthService _authService;
    private readonly IWebHostEnvironment _environment;

    public AuthController(IAuthService authService, IWebHostEnvironment environment)
    {
        _authService = authService;
        _environment = environment;
    }

    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponseDto>> Register(
        [FromBody] RegisterRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await _authService.RegisterAsync(request, cancellationToken);
            return StatusCode(StatusCodes.Status201Created, response);
        }
        catch (DuplicateEmailException exception)
        {
            return Conflict(new { message = exception.Message });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponseDto>> Login(
        [FromBody] LoginRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var response = await _authService.LoginAsync(request, cancellationToken);
            return Ok(response);
        }
        catch (InvalidCredentialsException exception)
        {
            return Unauthorized(new { message = exception.Message });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [Authorize]
    [HttpPut("change-password")]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            // Extracts the user ID from the signed JWT instead of trusting an ID sent by the client.
            var authenticatedUserId = GetAuthenticatedUserId();
            await _authService.ChangePasswordAsync(authenticatedUserId, request, cancellationToken);
            return NoContent();
        }
        catch (InvalidCredentialsException exception)
        {
            return Unauthorized(new { message = exception.Message });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
        catch (KeyNotFoundException exception)
        {
            return NotFound(new { message = exception.Message });
        }
        catch (UnauthorizedAccessException exception)
        {
            return Unauthorized(new { message = exception.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("request-password-reset")]
    public async Task<ActionResult<RequestPasswordResetResponseDto>> RequestPasswordReset(
        [FromBody] RequestPasswordResetDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var resetToken = await _authService.RequestPasswordResetAsync(request, cancellationToken);

            // Local development can display the token until an email provider owns token delivery.
            return Ok(new RequestPasswordResetResponseDto
            {
                Message = GenericResetRequestMessage,
                DevelopmentToken = _environment.IsDevelopment() ? resetToken : null
            });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(
        [FromBody] ResetPasswordDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            await _authService.ResetPasswordAsync(request, cancellationToken);
            return NoContent();
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { message = exception.Message });
        }
    }

    private int GetAuthenticatedUserId()
    {
        var value = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue(JwtRegisteredClaimNames.Sub);

        if (int.TryParse(value, out var userId) && userId > 0)
        {
            return userId;
        }

        throw new UnauthorizedAccessException(
            "The authentication token does not contain a valid user identifier.");
    }
}
