using System.Net.Mail;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ForgeDB.API.Services;

	/*
	 * AuthService handles user registration and login, including validation,
	 * password hashing, and JWT token generation.
	 */
public class AuthService : IAuthService
{
	private const string DefaultRole = "User";
	private const int MinimumPasswordLength = 8;
	private readonly IConfiguration _configuration;

	private readonly IUserRepository _userRepository;
	private readonly IPasswordHasher<User> _passwordHasher;

	public AuthService(IUserRepository userRepository, IPasswordHasher<User> passwordHasher, IConfiguration configuration)
	{
		_userRepository = userRepository;
		_passwordHasher = passwordHasher;
		_configuration = configuration;
	}

	/*
	 * Registers a new user with the provided registration details.
	 * Validates the input, checks for duplicate email, hashes the password,
	 * and returns an AuthResponseDto containing the user and JWT token.
	 */
	public async Task<AuthResponseDto> RegisterAsync(RegisterRequestDto request, CancellationToken cancellationToken = default)
	{
		ArgumentNullException.ThrowIfNull(request);

		var firstName = request.FirstName?.Trim();
		var lastName = request.LastName?.Trim();
		var email = request.Email?.Trim();
		var password = request.Password?.Trim();

		ValidateRequired(firstName, "FirstName is required.");
		ValidateRequired(lastName, "LastName is required.");
		ValidateEmail(email);
		ValidatePassword(password);

		var normalizedEmail = NormalizeEmail(email);

		if (await _userRepository.GetByEmailAsync(normalizedEmail, cancellationToken) is not null)
		{
			throw new DuplicateEmailException("Email is already registered.");
		}

		var user = new User
		{
			FirstName = firstName!,
			LastName = lastName!,
			Email = normalizedEmail,
			Role = DefaultRole,
			CreatedAt = DateTime.UtcNow
		};

		user.PasswordHash = _passwordHasher.HashPassword(user, password!);

		try
		{
			await _userRepository.AddAsync(user, cancellationToken);
		}
		catch (DbUpdateException exception)
			when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
		{
			throw new DuplicateEmailException("Email is already registered.");
		}

		return MapToAuthResponse(user);
	}

	public async Task<AuthResponseDto> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default)
	{
		ArgumentNullException.ThrowIfNull(request);

		var email = request.Email?.Trim();
		var password = request.Password?.Trim();

		ValidateEmail(email);
		ValidateRequired(password, "Password is required.");

		var normalizedEmail = NormalizeEmail(email);
		var user = await _userRepository.GetByEmailAsync(normalizedEmail, cancellationToken);
		if (user is null)
		{
			throw new InvalidCredentialsException("Invalid email or password.");
		}

		var passwordVerification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password!);
		if (passwordVerification == PasswordVerificationResult.Failed)
		{
			throw new InvalidCredentialsException("Invalid email or password.");
		}

		return MapToAuthResponse(user);
	}

	/*
	 * Validates that a required string value is not null, empty, or whitespace.
	 */
	private static void ValidateRequired(string? value, string message)
	{
		if (string.IsNullOrWhiteSpace(value))
		{
			throw new ArgumentException(message);
		}
	}

	/*
	 * Validates the email format to ensure it is a valid email address.
	 */
	private static void ValidateEmail(string? email)
	{
		ValidateRequired(email, "Email is required.");

		try
		{
			var address = new MailAddress(email!);
			if (!address.Address.Equals(email, StringComparison.OrdinalIgnoreCase))
			{
				throw new FormatException();
			}
		}
		catch (FormatException)
		{
			throw new ArgumentException("Email format is invalid.");
		}
	}

	/*
	 * Validates the password to ensure it meets the minimum length requirement.
	 */
	private static void ValidatePassword(string? password)
	{
		ValidateRequired(password, "Password is required.");

		if (password!.Length < MinimumPasswordLength)
		{
			throw new ArgumentException($"Password must be at least {MinimumPasswordLength} characters.");
		}
	}

	/*
	 * Normalizes the email by trimming whitespace and converting to lowercase.
	 */
	private static string NormalizeEmail(string? email)
	{
		return email!.Trim().ToLowerInvariant();
	}

	/*
	 * Maps a User entity to an AuthResponseDto, including generating a JWT token.
	 */
	private AuthResponseDto MapToAuthResponse(User user)
	{
		return new AuthResponseDto
		{
			Token = GenerateJwtToken(user),
			User = new UserResponseDto
			{
				Id = user.Id,
				FirstName = user.FirstName,
				LastName = user.LastName,
				Email = user.Email,
				Role = user.Role,
				CreatedAt = user.CreatedAt
			}
		};
	}

	/*
	 * Generates a JWT token for the authenticated user.
	 */
	private string GenerateJwtToken(User user)
	{
		var jwtKey = GetRequiredJwtConfiguration("Jwt:Key");
		if (jwtKey.Length < 32)
		{
			throw new InvalidOperationException("Jwt:Key must be at least 32 characters.");
		}

		var jwtIssuer = GetRequiredJwtConfiguration("Jwt:Issuer");
		var jwtAudience = GetRequiredJwtConfiguration("Jwt:Audience");

		var claims = new[]
		{
			new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
			new Claim(JwtRegisteredClaimNames.Email, user.Email),
			new Claim(ClaimTypes.Role, user.Role),
			new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
		};

		var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
		var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

		var tokenDescriptor = new SecurityTokenDescriptor
		{
			Subject = new ClaimsIdentity(claims),
			Expires = DateTime.UtcNow.AddHours(1),
			Issuer = jwtIssuer,
			Audience = jwtAudience,
			SigningCredentials = creds
		};

		var tokenHandler = new JwtSecurityTokenHandler();
		var token = tokenHandler.CreateToken(tokenDescriptor);
		return tokenHandler.WriteToken(token);
	}

	private string GetRequiredJwtConfiguration(string key)
	{
		var value = _configuration[key];
		if (string.IsNullOrWhiteSpace(value))
		{
			throw new InvalidOperationException($"{key} configuration is required.");
		}

		return value;
	}
}
