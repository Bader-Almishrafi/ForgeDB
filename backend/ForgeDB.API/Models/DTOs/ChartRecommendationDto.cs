namespace ForgeDB.API.Models.DTOs;

public class ChartRecommendationDto
{
    public string ChartType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public IEnumerable<string> Columns { get; set; } = new List<string>();
    public string? XColumn { get; set; }
    public string? YColumn { get; set; }
    public string? Reason { get; set; }
    public string? Usefulness { get; set; }
    public IEnumerable<ChartPreviewPointDto> PreviewData { get; set; } = new List<ChartPreviewPointDto>();
}
