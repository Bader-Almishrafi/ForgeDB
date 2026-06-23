namespace ForgeDB.API.Models.Entities;

public class DatasetColumn
{
    public int Id { get; set; }
    public int DatasetId { get; set; }
    public string ColumnName { get; set; } = string.Empty;
    public string DetectedDataType { get; set; } = string.Empty;
    public int MissingValuesCount { get; set; }
    public int UniqueValuesCount { get; set; }
    public bool IsNullable { get; set; }
    public string? SampleValues { get; set; }
    public Dataset? Dataset { get; set; }
}
