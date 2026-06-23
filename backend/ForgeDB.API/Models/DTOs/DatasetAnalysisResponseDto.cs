namespace ForgeDB.API.Models.DTOs;

public class DatasetAnalysisResponseDto
{
    public int DatasetId { get; set; }
    public string Status { get; set; } = string.Empty;
    public object? AnalysisResult { get; set; }
    public IEnumerable<ChartRecommendationDto> ChartRecommendations { get; set; } = new List<ChartRecommendationDto>();
    public DateTime? AnalyzedAt { get; set; }
}
