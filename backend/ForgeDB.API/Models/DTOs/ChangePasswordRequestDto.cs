namespace ForgeDB.API.Models.DTOs;

// Carries password values only; the authenticated user identity comes from the JWT.
public class ChangePasswordRequestDto
{
    public string CurrentPassword { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
}
