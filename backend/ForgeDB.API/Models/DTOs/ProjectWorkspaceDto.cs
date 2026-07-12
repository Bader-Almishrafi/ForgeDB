namespace ForgeDB.API.Models.DTOs;

public class ProjectOverviewDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public int DatasetsCount { get; set; }
    public int TotalRows { get; set; }
    public int TotalColumns { get; set; }
    public int AnalyzedDatasetsCount { get; set; }
    public int CleaningBatchesCount { get; set; }
    public bool QualityConfirmed { get; set; }
    public bool SchemaReady { get; set; }
    public int GeneratedSchemasCount { get; set; }
    public int RelationshipSuggestionsCount { get; set; }
    public int AcceptedRelationshipsCount { get; set; }
    public string ExportReadinessStatus { get; set; } = string.Empty;
    public IEnumerable<DatasetResponseDto> RecentDatasets { get; set; } = new List<DatasetResponseDto>();
    public IEnumerable<string> NextRecommendedActions { get; set; } = new List<string>();
}

public class ProjectExportPackageDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime GeneratedAt { get; set; }
    public string Sql { get; set; } = string.Empty;
    public string Dbml { get; set; } = string.Empty;
    public string JsonSchema { get; set; } = string.Empty;
    public string RelationshipReportJson { get; set; } = string.Empty;
    public string DataQualityReportJson { get; set; } = string.Empty;
}

public class KeyCandidateDto
{
    public string ColumnName { get; set; } = string.Empty;
    public decimal Confidence { get; set; }
    public IEnumerable<string> Reasons { get; set; } = new List<string>();
}

public class DateRangeDto
{
    public string ColumnName { get; set; } = string.Empty;
    public string? Min { get; set; }
    public string? Max { get; set; }
}

public class RelationshipCandidateHintDto
{
    public string ColumnName { get; set; } = string.Empty;
    public string Hint { get; set; } = string.Empty;
}

public class ChartPreviewPointDto
{
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
}
