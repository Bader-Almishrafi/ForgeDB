using System.IdentityModel.Tokens.Jwt;
using System.Net.Mail;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace ForgeDB.API.Services;

// Coordinates authentication rules; repositories remain responsible for persistence details.
public class AuthService : IAuthService
{
    private const string DefaultRole = "User";
    private const int MinimumPasswordLength = 8;
    private const int ResetTokenLifetimeMinutes = 30;
    private const int ResetTokenByteLength = 32;
    private readonly IConfiguration _configuration;
    private readonly IPasswordResetTokenRepository _passwordResetTokenRepository;
    private readonly IPasswordHasher<User> _passwordHasher;
    private readonly TimeProvider _timeProvider;
    private readonly IUserRepository _userRepository;

    public AuthService(
        IUserRepository userRepository,
        IPasswordResetTokenRepository passwordResetTokenRepository,
        IPasswordHasher<User> passwordHasher,
        IConfiguration configuration,
        TimeProvider timeProvider)
    {
        _userRepository = userRepository;
        _passwordResetTokenRepository = passwordResetTokenRepository;
        _passwordHasher = passwordHasher;
        _configuration = configuration;
        _timeProvider = timeProvider;
    }

    public async Task<AuthResponseDto> RegisterAsync(
        RegisterRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var firstName = request.FirstName?.Trim();
        var lastName = request.LastName?.Trim();
        var email = request.Email?.Trim();
        var password = request.Password;

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
            CreatedAt = _timeProvider.GetUtcNow().UtcDateTime
        };

        // The plain-text password exists only for this request; Identity creates the stored one-way hash.
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

    public async Task<AuthResponseDto> LoginAsync(
        LoginRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = request.Email?.Trim();
        var password = request.Password;

        ValidateEmail(email);
        ValidateRequired(password, "Password is required.");

        var normalizedEmail = NormalizeEmail(email);
        var user = await _userRepository.GetByEmailAsync(normalizedEmail, cancellationToken);
        if (user is null)
        {
            throw new InvalidCredentialsException("Invalid email or password.");
        }

        // Verifies the submitted password against the hash without ever decrypting or storing the original.
        var verification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password!);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw new InvalidCredentialsException("Invalid email or password.");
        }

        return MapToAuthResponse(user);
    }

    public async Task ChangePasswordAsync(
        int authenticatedUserId,
        ChangePasswordRequestDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (authenticatedUserId <= 0)
        {
            throw new UnauthorizedAccessException("The authentication token does not contain a valid user identifier.");
        }

        var currentPassword = request.CurrentPassword;
        var newPassword = request.NewPassword;

        ValidateRequired(currentPassword, "Current password is required.");
        ValidatePassword(newPassword);

        var user = await _userRepository.GetByIdAsync(authenticatedUserId, cancellationToken);
        if (user is null)
        {
            throw new KeyNotFoundException("The authenticated user was not found.");
        }

        // The signed-in user's current password must be proven before any replacement is accepted.
        var verification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, currentPassword!);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw new InvalidCredentialsException("Current password is incorrect.");
        }

        if (string.Equals(currentPassword, newPassword, StringComparison.Ordinal))
        {
            throw new ArgumentException("New password must be different from the current password.");
        }

        var newPasswordHash = _passwordHasher.HashPassword(user, newPassword!);
        var updated = await _userRepository.UpdatePasswordHashAsync(
            user.Id,
            newPasswordHash,
            cancellationToken);

        if (!updated)
        {
            throw new KeyNotFoundException("The authenticated user was not found.");
        }
    }

    public async Task<string> RequestPasswordResetAsync(
        RequestPasswordResetDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = request.Email?.Trim();
        ValidateEmail(email);

        // A token is generated even for an unknown email so Development responses do not reveal accounts.
        var resetToken = Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(ResetTokenByteLength));
        var user = await _userRepository.GetByEmailAsync(NormalizeEmail(email), cancellationToken);
        if (user is null)
        {
            return resetToken;
        }

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var passwordResetToken = new PasswordResetToken
        {
            UserId = user.Id,
            // Only a deterministic hash is stored, so a database leak does not expose usable reset links.
            TokenHash = HashResetToken(resetToken),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(ResetTokenLifetimeMinutes)
        };

        await _passwordResetTokenRepository.AddAsync(passwordResetToken, cancellationToken);
        return resetToken;
    }

    public async Task ResetPasswordAsync(
        ResetPasswordDto request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var email = request.Email?.Trim();
        var token = request.Token?.Trim();
        var newPassword = request.NewPassword;

        ValidateEmail(email);
        ValidateRequired(token, "Reset token is required.");
        ValidatePassword(newPassword);

        if (token!.Length > 512)
        {
            throw new ArgumentException("Reset token is invalid.");
        }

        var user = await _userRepository.GetByEmailAsync(NormalizeEmail(email), cancellationToken);
        if (user is null)
        {
            throw new ArgumentException("Email or reset token is invalid.");
        }

        var passwordResetToken = await _passwordResetTokenRepository.GetByUserAndTokenHashAsync(
            user.Id,
            HashResetToken(token),
            cancellationToken);

        if (passwordResetToken is null)
        {
            throw new ArgumentException("Email or reset token is invalid.");
        }

        if (passwordResetToken.UsedAt is not null)
        {
            throw new ArgumentException("Reset token has already been used.");
        }

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        if (passwordResetToken.ExpiresAt <= now)
        {
            throw new ArgumentException("Reset token has expired.");
        }

        var newPasswordHash = _passwordHasher.HashPassword(user, newPassword!);

        // Consuming the token and updating the password share one transaction, making the token single-use.
        var consumed = await _passwordResetTokenRepository.ConsumeAsync(
            passwordResetToken.Id,
            user.Id,
            newPasswordHash,
            now,
            cancellationToken);

        if (!consumed)
        {
            throw new ArgumentException("Reset token is no longer valid.");
        }
    }

    private static void ValidateRequired(string? value, string message)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException(message);
        }
    }

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

    private static void ValidatePassword(string? password)
    {
        ValidateRequired(password, "Password is required.");

        if (password!.Length < MinimumPasswordLength)
        {
            throw new ArgumentException($"Password must be at least {MinimumPasswordLength} characters.");
        }
    }

    private static string NormalizeEmail(string? email)
    {
        return email!.Trim().ToLowerInvariant();
    }

    private static string HashResetToken(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }

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

    private string GenerateJwtToken(User user)
    {
        var jwtKey = GetRequiredJwtConfiguration("Jwt:Key");
        if (jwtKey.Length < 32)
        {
            throw new InvalidOperationException("Jwt:Key must be at least 32 characters.");
        }

        var jwtIssuer = GetRequiredJwtConfiguration("Jwt:Issuer");
        var jwtAudience = GetRequiredJwtConfiguration("Jwt:Audience");

        // The subject claim is signed into the JWT and later becomes the trusted authenticated user ID.
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            NotBefore = now,
            IssuedAt = now,
            Expires = now.AddHours(1),
            Issuer = jwtIssuer,
            Audience = jwtAudience,
            SigningCredentials = credentials
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        return tokenHandler.WriteToken(tokenHandler.CreateToken(tokenDescriptor));
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
