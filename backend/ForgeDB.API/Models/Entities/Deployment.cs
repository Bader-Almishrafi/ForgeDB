namespace ForgeDB.API.Models.Entities;

public static class DeploymentStatus
{
    public const string Running = "Running";
    public const string Succeeded = "Succeeded";
    public const string Failed = "Failed";
}

public class Deployment
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int DesignRevision { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string Status { get; set; } = DeploymentStatus.Running;
    public string GeneratedSql { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public string CreatedTablesJson { get; set; } = "[]";
    public string InsertedRowCountsJson { get; set; } = "{}";
    public int TotalRowsInserted { get; set; }
    public int TriggeredByUserId { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Project? Project { get; set; }
}
