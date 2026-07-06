namespace ForgeDB.API.Models.DTOs;

public class PythonAnalysisResponseDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public IEnumerable<PythonAnalysisColumnProfileDto> Columns { get; set; } = new List<PythonAnalysisColumnProfileDto>();
    public IEnumerable<PythonRelationshipSuggestionDto> RelationshipSuggestions { get; set; } = new List<PythonRelationshipSuggestionDto>();
    public IEnumerable<PythonChartRecommendationDto> ChartRecommendations { get; set; } = new List<PythonChartRecommendationDto>();
}

public class PythonAnalysisColumnProfileDto
{
    public string Name { get; set; } = string.Empty;
    public string DetectedType { get; set; } = string.Empty;
    public int MissingCount { get; set; }
    public int UniqueCount { get; set; }
    public IEnumerable<object?> SampleValues { get; set; } = new List<object?>();
    public PythonNumericStatsDto? NumericStats { get; set; }
    public IEnumerable<PythonTopValueDto> TopValues { get; set; } = new List<PythonTopValueDto>();
}

public class PythonNumericStatsDto
{
    public decimal Min { get; set; }
    public decimal Max { get; set; }
    public decimal Average { get; set; }
}

public class PythonTopValueDto
{
    public object? Value { get; set; }
    public int Count { get; set; }
}

public class PythonRelationshipSuggestionDto
{
    public string FromTable { get; set; } = string.Empty;
    public string FromColumn { get; set; } = string.Empty;
    public string ToTable { get; set; } = string.Empty;
    public string ToColumn { get; set; } = string.Empty;
    public decimal Confidence { get; set; }
    public string Reason { get; set; } = string.Empty;
}

public class PythonChartRecommendationDto
{
    public string ChartType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string XColumn { get; set; } = string.Empty;
    public string? YColumn { get; set; }
    public string Reason { get; set; } = string.Empty;
}
