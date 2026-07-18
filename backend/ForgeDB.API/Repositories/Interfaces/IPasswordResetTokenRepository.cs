using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

// Encapsulates reset-token persistence and the atomic single-use consume operation.
public interface IPasswordResetTokenRepository
{
    Task AddAsync(PasswordResetToken token, CancellationToken cancellationToken = default);

    Task<PasswordResetToken?> GetByUserAndTokenHashAsync(
        int userId,
        string tokenHash,
        CancellationToken cancellationToken = default);

    Task<bool> ConsumeAsync(
        int tokenId,
        int userId,
        string newPasswordHash,
        DateTime usedAt,
        CancellationToken cancellationToken = default);
}
