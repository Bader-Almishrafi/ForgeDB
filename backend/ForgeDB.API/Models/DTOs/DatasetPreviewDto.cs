namespace ForgeDB.API.Models.DTOs;

public class DatasetPreviewDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public IEnumerable<string> Columns { get; set; } = new List<string>();
    public IEnumerable<IDictionary<string, object?>> Rows { get; set; } = new List<Dictionary<string, object?>>();
}
