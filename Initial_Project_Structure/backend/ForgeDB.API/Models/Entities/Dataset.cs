namespace ForgeDB.API.Models.Entities;

public class Dataset
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string? SourceName { get; set; }
    public string? SourceUrl { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public Project? Project { get; set; }
    public ICollection<DatasetColumn> Columns { get; set; } = new List<DatasetColumn>();
    public ICollection<DatasetRow> Rows { get; set; } = new List<DatasetRow>();
}
