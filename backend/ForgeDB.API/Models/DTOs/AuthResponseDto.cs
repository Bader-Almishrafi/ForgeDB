namespace ForgeDB.API.Models.DTOs;

public class AuthResponseDto
{
    public UserResponseDto User { get; set; } = new();
}
