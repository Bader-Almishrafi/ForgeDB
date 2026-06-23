namespace ForgeDB.API.Models.DTOs;

public class ProjectCreateDto
{
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}
