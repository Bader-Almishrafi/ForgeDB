using System.Text.Json.Serialization;

namespace ForgeDB.API.Models.DTOs;

// Reset requests identify the account by email because no authenticated session is available.
public class RequestPasswordResetDto
{
    public string Email { get; set; } = string.Empty;
}

public class RequestPasswordResetResponseDto
{
    public string Message { get; set; } = string.Empty;

    // Omitted outside Development so production clients never receive the one-time token.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DevelopmentToken { get; set; }
}

// The email, token, and replacement password must all validate before the token can be consumed.
public class ResetPasswordDto
{
    public string Email { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
}
