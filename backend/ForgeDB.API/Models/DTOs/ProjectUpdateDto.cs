namespace ForgeDB.API.Models.DTOs;

// API input contract containing only project fields that can be edited after creation.
public class ProjectUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}
