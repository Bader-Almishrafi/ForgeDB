using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

// Persists only token hashes and consumes a valid token in the same transaction as the password update.
public class PasswordResetTokenRepository : IPasswordResetTokenRepository
{
    private readonly ForgeDbContext _context;

    public PasswordResetTokenRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public async Task AddAsync(
        PasswordResetToken token,
        CancellationToken cancellationToken = default)
    {
        await _context.PasswordResetTokens.AddAsync(token, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public Task<PasswordResetToken?> GetByUserAndTokenHashAsync(
        int userId,
        string tokenHash,
        CancellationToken cancellationToken = default)
    {
        return _context.PasswordResetTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(
                token => token.UserId == userId && token.TokenHash == tokenHash,
                cancellationToken);
    }

    public async Task<bool> ConsumeAsync(
        int tokenId,
        int userId,
        string newPasswordHash,
        DateTime usedAt,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

        // The predicate makes a second or concurrent use update zero rows.
        var consumedTokens = await _context.PasswordResetTokens
            .Where(token =>
                token.Id == tokenId
                && token.UserId == userId
                && token.UsedAt == null
                && token.ExpiresAt > usedAt)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(token => token.UsedAt, usedAt),
                cancellationToken);

        if (consumedTokens != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        // Only PasswordHash is changed on the user record.
        var updatedUsers = await _context.Users
            .Where(user => user.Id == userId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(user => user.PasswordHash, newPasswordHash),
                cancellationToken);

        if (updatedUsers != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }
}
