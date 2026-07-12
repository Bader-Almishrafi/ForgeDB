namespace ForgeDB.API.Models.Entities;

public class ProjectCleaningState
{
    public int ProjectId { get; set; }
    public int? LastCleaningBatchId { get; set; }
    public DateTime? LastReanalyzedAt { get; set; }
    public DateTime? QualityConfirmedAt { get; set; }
    public int? QualityConfirmedByUserId { get; set; }
    public string? ConfirmedVersionsJson { get; set; }
    public DateTime UpdatedAt { get; set; }
    public Project? Project { get; set; }
    public CleaningBatch? LastCleaningBatch { get; set; }
    public User? QualityConfirmedByUser { get; set; }
}
