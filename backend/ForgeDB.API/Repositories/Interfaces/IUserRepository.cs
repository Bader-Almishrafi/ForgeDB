using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

// Keeps authentication services independent of EF Core queries and persistence mechanics.
public interface IUserRepository
{
    Task<User?> GetByIdAsync(int id, CancellationToken cancellationToken = default);
    Task<User?> GetByEmailAsync(string email, CancellationToken cancellationToken = default);
    Task AddAsync(User user, CancellationToken cancellationToken = default);

    // A targeted update prevents password operations from accidentally changing other user fields.
    Task<bool> UpdatePasswordHashAsync(
        int userId,
        string passwordHash,
        CancellationToken cancellationToken = default);
}
