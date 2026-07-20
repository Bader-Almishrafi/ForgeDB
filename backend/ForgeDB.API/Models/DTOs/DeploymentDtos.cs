namespace ForgeDB.API.Models.DTOs;

public class DeploymentResponseDto
{
    public int DeploymentId { get; set; }
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int DesignRevision { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string GeneratedSql { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public List<string> CreatedTables { get; set; } = new();
    public Dictionary<string, int> InsertedRowCounts { get; set; } = new();
    public int TablesCreated { get; set; }
    public int RowsSeeded { get; set; }
    public int TotalRowsInserted { get; set; }
    public int RelationshipsCreated { get; set; }
    public int FailedRows { get; set; }
    public bool SchemaSqlAvailable { get; set; }
    public bool SeedSqlAvailable { get; set; }
    public bool DeploySqlAvailable { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public sealed class DeploymentPreviewDto
{
    public string SchemaName { get; set; } = string.Empty;
    public int DesignRevision { get; set; }
    public int TablesCount { get; set; }
    public int RelationshipsCount { get; set; }
    public int TotalRowsPlanned { get; set; }
    public int SourceVersionCount { get; set; }
    public bool IsRedeployment { get; set; }
}

public sealed record DeploymentSqlFileDto(string FileName, string Content);
