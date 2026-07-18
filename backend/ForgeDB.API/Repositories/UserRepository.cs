using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Repositories;

// Owns EF Core access for users while authentication rules stay in AuthService.
public class UserRepository : IUserRepository
{
    private readonly ForgeDbContext _context;

    public UserRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<User?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _context.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Id == id, cancellationToken);
    }

    public Task<User?> GetByEmailAsync(string email, CancellationToken cancellationToken = default)
    {
        return _context.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Email == email, cancellationToken);
    }

    public async Task AddAsync(User user, CancellationToken cancellationToken = default)
    {
        await _context.Users.AddAsync(user, cancellationToken);
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> UpdatePasswordHashAsync(
        int userId,
        string passwordHash,
        CancellationToken cancellationToken = default)
    {
        // ExecuteUpdate emits a single-column UPDATE and leaves names, email, role, and timestamps untouched.
        var updatedRows = await _context.Users
            .Where(user => user.Id == userId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(user => user.PasswordHash, passwordHash),
                cancellationToken);

        return updatedRows == 1;
    }
}
