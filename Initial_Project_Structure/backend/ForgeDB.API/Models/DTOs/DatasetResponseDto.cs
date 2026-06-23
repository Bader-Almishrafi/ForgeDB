namespace ForgeDB.API.Models.DTOs;

public class DatasetResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public string SourceType { get; set; } = string.Empty;
    public string? SourceName { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
