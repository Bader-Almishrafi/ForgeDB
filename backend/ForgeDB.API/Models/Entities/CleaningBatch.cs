namespace ForgeDB.API.Models.Entities;

public class CleaningBatch
{
    public int Id { get; set; }
    public Guid CorrelationId { get; set; }
    public int ProjectId { get; set; }
    public int CreatedByUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public bool IsUndo { get; set; }
    public bool IsRestore { get; set; }
    public int OperationCount { get; set; }
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public string? FailureDetailsJson { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public Project? Project { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<CleaningOperation> Operations { get; set; } = new List<CleaningOperation>();
    public ICollection<DatasetVersion> ProducedVersions { get; set; } = new List<DatasetVersion>();
}
