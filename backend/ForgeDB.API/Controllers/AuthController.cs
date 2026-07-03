using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ForgeDB.API.Controllers;
/*
 * AuthController.cs
 *
 * This controller handles user authentication and registration.
 * It provides endpoints for user registration and login.
 */
[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
	private readonly IAuthService _authService;

	public AuthController(IAuthService authService)
	{
		_authService = authService;
	}

	/*
	 * Registers a new user.
	 *
	 * @param request The registration request containing user details.
	 * @param cancellationToken A token to cancel the operation if needed.
	 * @returns An ActionResult containing the authentication response or an error message.
	 */
	[HttpPost("register")]
	public async Task<ActionResult<AuthResponseDto>> Register([FromBody] RegisterRequestDto request, CancellationToken cancellationToken)
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

	/*
	 * Logs in an existing user.
	 * @param request The login request containing user credentials.
	 * @param cancellationToken A token to cancel the operation if needed.
	 * @returns An ActionResult containing the authentication response or an error message.
	 */
	[HttpPost("login")]
	public async Task<ActionResult<AuthResponseDto>> Login([FromBody] LoginRequestDto request, CancellationToken cancellationToken)
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
}
