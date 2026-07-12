namespace ForgeDB.API.Models.Entities;

public class CleaningOperation
{
    public int Id { get; set; }
    public int CleaningBatchId { get; set; }
    public int DatasetId { get; set; }
    public int SourceVersionId { get; set; }
    public int? ResultVersionId { get; set; }
    public int Order { get; set; }
    public string OperationType { get; set; } = string.Empty;
    public string? ColumnName { get; set; }
    public string ParametersJson { get; set; } = "{}";
    public string Status { get; set; } = string.Empty;
    public bool IsDestructive { get; set; }
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public string? FailureMessage { get; set; }
    public DateTime CreatedAt { get; set; }
    public CleaningBatch? CleaningBatch { get; set; }
    public Dataset? Dataset { get; set; }
    public DatasetVersion? SourceVersion { get; set; }
    public DatasetVersion? ResultVersion { get; set; }
}
