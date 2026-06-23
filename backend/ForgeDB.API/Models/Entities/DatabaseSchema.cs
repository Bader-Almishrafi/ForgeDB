namespace ForgeDB.API.Models.Entities;

public class DatabaseSchema
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int DatasetId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string? DbmlContent { get; set; }
    public string? SchemaJson { get; set; }
    public string? SqlContent { get; set; }
    public string? RelationshipsJson { get; set; }
    public int Version { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public Project? Project { get; set; }
    public Dataset? Dataset { get; set; }
    public ICollection<DatabaseDeployment> Deployments { get; set; } = new List<DatabaseDeployment>();
}
