namespace ForgeDB.API.Models.DTOs;

public class PythonAnalysisRequestDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public IEnumerable<PythonAnalysisColumnRequestDto> Columns { get; set; } = new List<PythonAnalysisColumnRequestDto>();
    public IEnumerable<IDictionary<string, object?>> Rows { get; set; } = new List<IDictionary<string, object?>>();
}

public class PythonAnalysisColumnRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string? DataType { get; set; }
}
