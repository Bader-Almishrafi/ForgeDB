namespace ForgeDB.API.Models.Entities;

// Represents a short-lived, single-use reset grant; TokenHash is never a usable reset token.
public class PasswordResetToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public User User { get; set; } = null!;
}
