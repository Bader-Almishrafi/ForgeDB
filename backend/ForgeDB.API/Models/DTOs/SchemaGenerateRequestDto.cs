namespace ForgeDB.API.Models.DTOs;

public class SchemaGenerateRequestDto
{
    public int ProjectId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public IEnumerable<int> DatasetIds { get; set; } = new List<int>();
}
