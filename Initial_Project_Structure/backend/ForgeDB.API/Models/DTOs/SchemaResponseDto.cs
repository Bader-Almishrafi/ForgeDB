namespace ForgeDB.API.Models.DTOs;

public class SchemaResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string? DbmlContent { get; set; }
    public string? SchemaJson { get; set; }
    public string? SqlContent { get; set; }
    public int Version { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
