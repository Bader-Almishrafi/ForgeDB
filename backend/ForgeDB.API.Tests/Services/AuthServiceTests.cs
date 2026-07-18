using System.Security.Cryptography;
using System.Text;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;

namespace ForgeDB.API.Tests.Services;

public class AuthServiceTests
{
    private const string Email = "user@example.com";
    private const string OldPassword = "OldPassword123";
    private const string NewPassword = "NewPassword456";

    [Fact]
    public async Task ChangePasswordAsync_RejectsIncorrectCurrentPassword()
    {
        var fixture = CreateFixture();

        var exception = await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            fixture.Service.ChangePasswordAsync(1, new ChangePasswordRequestDto
            {
                CurrentPassword = "WrongPassword123",
                NewPassword = NewPassword
            }));

        Assert.Equal("Current password is incorrect.", exception.Message);
    }

    [Fact]
    public async Task ChangePasswordAsync_RejectsShortNewPassword()
    {
        var fixture = CreateFixture();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ChangePasswordAsync(1, new ChangePasswordRequestDto
            {
                CurrentPassword = OldPassword,
                NewPassword = "short"
            }));

        Assert.Contains("at least 8 characters", exception.Message);
    }

    [Fact]
    public async Task ChangePasswordAsync_RejectsCurrentPasswordAsNewPassword()
    {
        var fixture = CreateFixture();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ChangePasswordAsync(1, new ChangePasswordRequestDto
            {
                CurrentPassword = OldPassword,
                NewPassword = OldPassword
            }));

        Assert.Contains("different", exception.Message);
    }

    [Fact]
    public async Task ChangePasswordAsync_UpdatesOnlyHashAndChangesLoginPassword()
    {
        var fixture = CreateFixture();
        var original = new
        {
            fixture.User.FirstName,
            fixture.User.LastName,
            fixture.User.Email,
            fixture.User.Role,
            fixture.User.CreatedAt
        };

        await fixture.Service.ChangePasswordAsync(1, new ChangePasswordRequestDto
        {
            CurrentPassword = OldPassword,
            NewPassword = NewPassword
        });

        Assert.Equal(original.FirstName, fixture.User.FirstName);
        Assert.Equal(original.LastName, fixture.User.LastName);
        Assert.Equal(original.Email, fixture.User.Email);
        Assert.Equal(original.Role, fixture.User.Role);
        Assert.Equal(original.CreatedAt, fixture.User.CreatedAt);
        await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            fixture.Service.LoginAsync(new LoginRequestDto { Email = Email, Password = OldPassword }));

        var response = await fixture.Service.LoginAsync(new LoginRequestDto
        {
            Email = Email,
            Password = NewPassword
        });
        Assert.Equal(1, response.User.Id);
    }

    [Fact]
    public async Task RequestPasswordResetAsync_UnknownEmailCreatesNoRecord()
    {
        var fixture = CreateFixture();

        var token = await fixture.Service.RequestPasswordResetAsync(new RequestPasswordResetDto
        {
            Email = "unknown@example.com"
        });

        Assert.NotEmpty(token);
        Assert.Empty(fixture.ResetTokens.Tokens);
    }

    [Fact]
    public async Task RequestPasswordResetAsync_StoresOnlyTokenHashWithExpiry()
    {
        var fixture = CreateFixture();

        var rawToken = await fixture.Service.RequestPasswordResetAsync(new RequestPasswordResetDto
        {
            Email = Email
        });

        var storedToken = Assert.Single(fixture.ResetTokens.Tokens);
        Assert.NotEqual(rawToken, storedToken.TokenHash);
        Assert.Equal(HashToken(rawToken), storedToken.TokenHash);
        Assert.Equal(fixture.Clock.GetUtcNow().UtcDateTime.AddMinutes(30), storedToken.ExpiresAt);
        Assert.Null(storedToken.UsedAt);
    }

    [Fact]
    public async Task ResetPasswordAsync_RejectsInvalidToken()
    {
        var fixture = CreateFixture();

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ResetPasswordAsync(new ResetPasswordDto
            {
                Email = Email,
                Token = "invalid-token",
                NewPassword = NewPassword
            }));

        Assert.Contains("invalid", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ResetPasswordAsync_RejectsExpiredToken()
    {
        var fixture = CreateFixture();
        fixture.ResetTokens.Add("expired-token", fixture.User.Id, fixture.Clock.GetUtcNow().UtcDateTime.AddMinutes(-1));

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ResetPasswordAsync(new ResetPasswordDto
            {
                Email = Email,
                Token = "expired-token",
                NewPassword = NewPassword
            }));

        Assert.Contains("expired", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ResetPasswordAsync_RejectsUsedToken()
    {
        var fixture = CreateFixture();
        fixture.ResetTokens.Add(
            "used-token",
            fixture.User.Id,
            fixture.Clock.GetUtcNow().UtcDateTime.AddMinutes(5),
            fixture.Clock.GetUtcNow().UtcDateTime);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ResetPasswordAsync(new ResetPasswordDto
            {
                Email = Email,
                Token = "used-token",
                NewPassword = NewPassword
            }));

        Assert.Contains("already been used", exception.Message);
    }

    [Fact]
    public async Task ResetPasswordAsync_RejectsShortPassword()
    {
        var fixture = CreateFixture();
        fixture.ResetTokens.Add("valid-token", fixture.User.Id, fixture.Clock.GetUtcNow().UtcDateTime.AddMinutes(5));

        var exception = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ResetPasswordAsync(new ResetPasswordDto
            {
                Email = Email,
                Token = "valid-token",
                NewPassword = "short"
            }));

        Assert.Contains("at least 8 characters", exception.Message);
    }

    [Fact]
    public async Task ResetPasswordAsync_ConsumesTokenAndChangesLoginPassword()
    {
        var fixture = CreateFixture();
        fixture.ResetTokens.Add("one-time-token", fixture.User.Id, fixture.Clock.GetUtcNow().UtcDateTime.AddMinutes(5));
        var request = new ResetPasswordDto
        {
            Email = Email,
            Token = "one-time-token",
            NewPassword = NewPassword
        };

        await fixture.Service.ResetPasswordAsync(request);

        await Assert.ThrowsAsync<InvalidCredentialsException>(() =>
            fixture.Service.LoginAsync(new LoginRequestDto { Email = Email, Password = OldPassword }));
        var response = await fixture.Service.LoginAsync(new LoginRequestDto
        {
            Email = Email,
            Password = NewPassword
        });
        Assert.Equal(1, response.User.Id);

        var reuseException = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.Service.ResetPasswordAsync(request));
        Assert.Contains("already been used", reuseException.Message);
    }

    private static TestFixture CreateFixture()
    {
        var clock = new TestTimeProvider(new DateTimeOffset(2026, 7, 18, 12, 0, 0, TimeSpan.Zero));
        var hasher = new PasswordHasher<User>();
        var user = new User
        {
            Id = 1,
            FirstName = "Test",
            LastName = "User",
            Email = Email,
            Role = "User",
            CreatedAt = clock.GetUtcNow().UtcDateTime
        };
        user.PasswordHash = hasher.HashPassword(user, OldPassword);

        var users = new FakeUserRepository(user);
        var resetTokens = new FakePasswordResetTokenRepository(users);
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "auth-tests-use-a-key-that-is-at-least-32-characters-long",
                ["Jwt:Issuer"] = "ForgeDB.Tests",
                ["Jwt:Audience"] = "ForgeDB.Tests"
            })
            .Build();

        var service = new AuthService(users, resetTokens, hasher, configuration, clock);
        return new TestFixture(service, user, resetTokens, clock);
    }

    private static string HashToken(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    }

    private sealed record TestFixture(
        AuthService Service,
        User User,
        FakePasswordResetTokenRepository ResetTokens,
        TestTimeProvider Clock);

    private sealed class TestTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _utcNow;

        public TestTimeProvider(DateTimeOffset utcNow)
        {
            _utcNow = utcNow;
        }

        public override DateTimeOffset GetUtcNow() => _utcNow;
    }

    private sealed class FakeUserRepository : IUserRepository
    {
        public FakeUserRepository(User user)
        {
            User = user;
        }

        public User User { get; }

        public Task<User?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<User?>(User.Id == id ? User : null);
        }

        public Task<User?> GetByEmailAsync(string email, CancellationToken cancellationToken = default)
        {
            return Task.FromResult<User?>(User.Email == email ? User : null);
        }

        public Task AddAsync(User user, CancellationToken cancellationToken = default)
        {
            throw new NotSupportedException();
        }

        public Task<bool> UpdatePasswordHashAsync(
            int userId,
            string passwordHash,
            CancellationToken cancellationToken = default)
        {
            if (User.Id != userId)
            {
                return Task.FromResult(false);
            }

            User.PasswordHash = passwordHash;
            return Task.FromResult(true);
        }
    }

    private sealed class FakePasswordResetTokenRepository : IPasswordResetTokenRepository
    {
        private readonly FakeUserRepository _users;
        private int _nextId = 1;

        public FakePasswordResetTokenRepository(FakeUserRepository users)
        {
            _users = users;
        }

        public List<PasswordResetToken> Tokens { get; } = [];

        public Task AddAsync(PasswordResetToken token, CancellationToken cancellationToken = default)
        {
            token.Id = _nextId++;
            Tokens.Add(token);
            return Task.CompletedTask;
        }

        public Task<PasswordResetToken?> GetByUserAndTokenHashAsync(
            int userId,
            string tokenHash,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Tokens.FirstOrDefault(token =>
                token.UserId == userId && token.TokenHash == tokenHash));
        }

        public async Task<bool> ConsumeAsync(
            int tokenId,
            int userId,
            string newPasswordHash,
            DateTime usedAt,
            CancellationToken cancellationToken = default)
        {
            var token = Tokens.FirstOrDefault(candidate =>
                candidate.Id == tokenId
                && candidate.UserId == userId
                && candidate.UsedAt is null
                && candidate.ExpiresAt > usedAt);
            if (token is null)
            {
                return false;
            }

            var updated = await _users.UpdatePasswordHashAsync(userId, newPasswordHash, cancellationToken);
            if (!updated)
            {
                return false;
            }

            token.UsedAt = usedAt;
            return true;
        }

        public void Add(string rawToken, int userId, DateTime expiresAt, DateTime? usedAt = null)
        {
            Tokens.Add(new PasswordResetToken
            {
                Id = _nextId++,
                UserId = userId,
                TokenHash = HashToken(rawToken),
                CreatedAt = expiresAt.AddMinutes(-30),
                ExpiresAt = expiresAt,
                UsedAt = usedAt
            });
        }
    }
}
