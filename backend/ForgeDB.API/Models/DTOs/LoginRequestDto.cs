namespace ForgeDB.API.Models.DTOs;

// Carries credentials to AuthService; passwords are never returned in an API response.
public class LoginRequestDto
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}
