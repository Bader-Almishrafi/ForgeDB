using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

// Defines authentication use cases without exposing HTTP or database implementation details.
public interface IAuthService
{
    Task<AuthResponseDto> RegisterAsync(
        RegisterRequestDto request,
        CancellationToken cancellationToken = default);

    Task<AuthResponseDto> LoginAsync(
        LoginRequestDto request,
        CancellationToken cancellationToken = default);

    // The user ID is supplied by the controller from the signed JWT, never by the request body.
    Task ChangePasswordAsync(
        int authenticatedUserId,
        ChangePasswordRequestDto request,
        CancellationToken cancellationToken = default);

    // Returns the one-time plain token only so the presentation layer can deliver it in Development.
    Task<string> RequestPasswordResetAsync(
        RequestPasswordResetDto request,
        CancellationToken cancellationToken = default);

    Task ResetPasswordAsync(
        ResetPasswordDto request,
        CancellationToken cancellationToken = default);
}
