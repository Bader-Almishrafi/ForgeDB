namespace ForgeDB.API.Models.DTOs;

public class DeploymentResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int DesignRevision { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string GeneratedSql { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public List<string> CreatedTables { get; set; } = new();
    public Dictionary<string, int> InsertedRowCounts { get; set; } = new();
    public int TotalRowsInserted { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
