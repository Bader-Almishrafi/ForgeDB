using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Interfaces;

public interface IAuthService
{
    Task RegisterAsync(RegisterRequestDto request, CancellationToken cancellationToken = default);
    Task<string> LoginAsync(LoginRequestDto request, CancellationToken cancellationToken = default);
}
