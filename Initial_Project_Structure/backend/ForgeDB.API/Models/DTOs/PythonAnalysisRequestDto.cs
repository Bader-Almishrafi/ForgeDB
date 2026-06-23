namespace ForgeDB.API.Models.DTOs;

public class PythonAnalysisRequestDto
{
    public int ProjectId { get; set; }
    public int DatasetId { get; set; }
    public string AnalysisType { get; set; } = string.Empty;
    public object? Payload { get; set; }
}
