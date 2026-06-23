namespace ForgeDB.API.Models.DTOs;

public class DashboardResponseDto
{
    public int ProjectId { get; set; }
    public int DatasetCount { get; set; }
    public int SchemaCount { get; set; }
    public int DeploymentCount { get; set; }
    public IEnumerable<ChartRecommendationDto> ChartRecommendations { get; set; } = new List<ChartRecommendationDto>();
}
