namespace ForgeDB.API.Models.Entities;

public class DatabaseDeployment
{
    public int Id { get; set; }
    public int SchemaId { get; set; }
    public int ProjectId { get; set; }
    public string DatabaseName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime? DeployedAt { get; set; }
    public DatabaseSchema? Schema { get; set; }
    public Project? Project { get; set; }
}
