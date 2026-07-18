namespace ForgeDB.API.Models.DTOs;

// The service validates this plain password and replaces it with a one-way hash before persistence.
public class RegisterRequestDto
{
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}
