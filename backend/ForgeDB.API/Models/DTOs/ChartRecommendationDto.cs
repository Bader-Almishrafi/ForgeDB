namespace ForgeDB.API.Models.DTOs;

public class ChartRecommendationDto
{
    public string ChartType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public IEnumerable<string> Columns { get; set; } = new List<string>();
    public string? Reason { get; set; }
}
