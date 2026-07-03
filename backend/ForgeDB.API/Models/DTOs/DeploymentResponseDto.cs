namespace ForgeDB.API.Models.DTOs;

public class DeploymentResponseDto
{
    public int Id { get; set; }
    public int DeploymentId { get; set; }
    public int ProjectId { get; set; }
    public int SchemaId { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string SqlScript { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? DeployedAt { get; set; }
}
