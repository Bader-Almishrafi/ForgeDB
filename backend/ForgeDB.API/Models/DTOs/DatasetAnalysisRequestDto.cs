namespace ForgeDB.API.Models.DTOs;

public class DatasetAnalysisRequestDto
{
    public string AnalysisType { get; set; } = string.Empty;
    public object? Options { get; set; }
}
