namespace ForgeDB.API.Models.Entities;

public class DatasetRow
{
    public int Id { get; set; }
    public int DatasetId { get; set; }
    public int RowNumber { get; set; }
    public string RowData { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public Dataset? Dataset { get; set; }
}
