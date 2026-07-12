namespace ForgeDB.API.Models.Entities;

public class DatasetVersion
{
    public int Id { get; set; }
    public int DatasetId { get; set; }
    public int? ParentVersionId { get; set; }
    public int? CleaningBatchId { get; set; }
    public int CreatedByUserId { get; set; }
    public int VersionNumber { get; set; }
    public bool IsRawOriginal { get; set; }
    public bool IsActive { get; set; }
    public string RowsJson { get; set; } = "[]";
    public string ColumnsJson { get; set; } = "[]";
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public string OperationSummary { get; set; } = string.Empty;
    public string? AnalysisResultJson { get; set; }
    public DateTime? AnalyzedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public Dataset? Dataset { get; set; }
    public DatasetVersion? ParentVersion { get; set; }
    public ICollection<DatasetVersion> ChildVersions { get; set; } = new List<DatasetVersion>();
    public CleaningBatch? CleaningBatch { get; set; }
    public User? CreatedByUser { get; set; }
}
