namespace ForgeDB.API.Models.DTOs;

public class PythonAnalysisResponseDto
{
    public string Status { get; set; } = string.Empty;
    public object? Result { get; set; }
    public IEnumerable<ChartRecommendationDto> ChartRecommendations { get; set; } = new List<ChartRecommendationDto>();
}
