namespace ForgeDB.API.Models.DTOs;

public class DashboardResponseDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public IEnumerable<DashboardMetricDto> Metrics { get; set; } = new List<DashboardMetricDto>();
    public IEnumerable<ColumnTypeDistributionDto> ColumnTypeDistribution { get; set; } = new List<ColumnTypeDistributionDto>();
    public IEnumerable<NumericColumnStatsDto> NumericSummaries { get; set; } = new List<NumericColumnStatsDto>();
    public IEnumerable<DashboardTopValuesDto> TopValueSummaries { get; set; } = new List<DashboardTopValuesDto>();
    public IEnumerable<ChartRecommendationDto> ChartRecommendations { get; set; } = new List<ChartRecommendationDto>();
}

public class DashboardMetricDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public string? Unit { get; set; }
}

public class DashboardTopValuesDto
{
    public string ColumnName { get; set; } = string.Empty;
    public IEnumerable<ValueFrequencyDto> Values { get; set; } = new List<ValueFrequencyDto>();
}
