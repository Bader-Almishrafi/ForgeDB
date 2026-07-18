namespace ForgeDB.API.Models.DTOs;

// API input contract for initial project details. ProjectsController replaces UserId with the
// authenticated JWT owner before the service validates and persists the request.
public class ProjectCreateDto
{
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}
