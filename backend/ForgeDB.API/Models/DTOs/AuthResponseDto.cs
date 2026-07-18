namespace ForgeDB.API.Models.DTOs;

// Pairs the signed JWT with safe profile data so the frontend can establish its local session.
public class AuthResponseDto
{
    public UserResponseDto User { get; set; } = new();
	public string Token { get; set; } = string.Empty;
}
