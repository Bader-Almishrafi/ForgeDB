namespace ForgeDB.API.Models.DTOs;

public class RelationshipSuggestionResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int SourceDatasetId { get; set; }
    public string SourceTableName { get; set; } = string.Empty;
    public string SourceColumnName { get; set; } = string.Empty;
    public int TargetDatasetId { get; set; }
    public string TargetTableName { get; set; } = string.Empty;
    public string TargetColumnName { get; set; } = string.Empty;
    public double Score { get; set; }
    public string? EvidenceJson { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime? DecidedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class AcceptSuggestionResponseDto
{
    public RelationshipSuggestionResponseDto Suggestion { get; set; } = new();
    public DesignRelationshipResponseDto Relationship { get; set; } = new();
    public int DesignRevision { get; set; }
}
