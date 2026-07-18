namespace ForgeDB.API.Models.DTOs;

// Stable API output contract for a persisted Project; it intentionally excludes EF navigation
// properties such as datasets and the owning User entity.
public class ProjectResponseDto
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? DashboardConfig { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
