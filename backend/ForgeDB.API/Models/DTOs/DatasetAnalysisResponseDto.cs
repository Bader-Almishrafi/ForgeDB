namespace ForgeDB.API.Models.DTOs;

public class DatasetAnalysisResponseDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DatasetAnalysisResultDto AnalysisResult { get; set; } = new();
    public IEnumerable<ChartRecommendationDto> ChartRecommendations { get; set; } = new List<ChartRecommendationDto>();
    public IEnumerable<KeyCandidateDto> KeyCandidates { get; set; } = new List<KeyCandidateDto>();
    public IEnumerable<DateRangeDto> DateRanges { get; set; } = new List<DateRangeDto>();
    public IEnumerable<RelationshipCandidateHintDto> RelationshipCandidateHints { get; set; } = new List<RelationshipCandidateHintDto>();
    public DateTime? AnalyzedAt { get; set; }
}

public class DatasetAnalysisResultDto
{
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public string DuplicateRowRule { get; set; } = string.Empty;
    public IEnumerable<ColumnAnalysisDto> Columns { get; set; } = new List<ColumnAnalysisDto>();
    public IEnumerable<ColumnTypeDistributionDto> ColumnTypeDistribution { get; set; } = new List<ColumnTypeDistributionDto>();
}

public class ColumnAnalysisDto
{
    public string ColumnName { get; set; } = string.Empty;
    public string DetectedDataType { get; set; } = string.Empty;
    public int MissingValuesCount { get; set; }
    public int UniqueValuesCount { get; set; }
    public bool IsNullable { get; set; }
    public IEnumerable<string> SampleValues { get; set; } = new List<string>();
    public NumericColumnStatsDto? NumericStats { get; set; }
    public IEnumerable<ValueFrequencyDto> MostCommonValues { get; set; } = new List<ValueFrequencyDto>();
}

public class NumericColumnStatsDto
{
    public string ColumnName { get; set; } = string.Empty;
    public decimal Min { get; set; }
    public decimal Max { get; set; }
    public decimal Average { get; set; }
    public int Count { get; set; }
}

public class ValueFrequencyDto
{
    public string? Value { get; set; }
    public int Count { get; set; }
}

public class ColumnTypeDistributionDto
{
    public string DataType { get; set; } = string.Empty;
    public int Count { get; set; }
}
