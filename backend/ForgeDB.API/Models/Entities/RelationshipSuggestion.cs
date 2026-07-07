namespace ForgeDB.API.Models.Entities;

public static class RelationshipSuggestionStatus
{
    public const string Suggested = "suggested";
    public const string Accepted = "accepted";
    public const string Rejected = "rejected";
}

public class RelationshipSuggestion
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int SourceDatasetId { get; set; }
    public string SourceColumnName { get; set; } = string.Empty;
    public int TargetDatasetId { get; set; }
    public string TargetColumnName { get; set; } = string.Empty;
    public double Score { get; set; }
    public string? EvidenceJson { get; set; }
    public string Status { get; set; } = RelationshipSuggestionStatus.Suggested;
    public DateTime? DecidedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public Project? Project { get; set; }
    public Dataset? SourceDataset { get; set; }
    public Dataset? TargetDataset { get; set; }
    public ICollection<DesignRelationship> DesignRelationships { get; set; } = new List<DesignRelationship>();
}
