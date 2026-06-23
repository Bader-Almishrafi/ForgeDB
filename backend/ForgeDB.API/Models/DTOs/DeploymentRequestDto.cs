namespace ForgeDB.API.Models.DTOs;

public class DeploymentRequestDto
{
    public int ProjectId { get; set; }
    public int SchemaId { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
}
