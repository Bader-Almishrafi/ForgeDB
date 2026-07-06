namespace ForgeDB.API.Models.DTOs;

public class ProjectOverviewDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public int DatasetsCount { get; set; }
    public int TotalRows { get; set; }
    public int TotalColumns { get; set; }
    public int AnalyzedDatasetsCount { get; set; }
    public int GeneratedSchemasCount { get; set; }
    public int RelationshipSuggestionsCount { get; set; }
    public int AcceptedRelationshipsCount { get; set; }
    public string ExportReadinessStatus { get; set; } = string.Empty;
    public IEnumerable<DatasetResponseDto> RecentDatasets { get; set; } = new List<DatasetResponseDto>();
    public IEnumerable<string> NextRecommendedActions { get; set; } = new List<string>();
}

public class ProjectRelationshipSuggestionDto
{
    public string SuggestionId { get; set; } = string.Empty;
    public int FromDatasetId { get; set; }
    public string FromTable { get; set; } = string.Empty;
    public string FromColumn { get; set; } = string.Empty;
    public int ToDatasetId { get; set; }
    public string ToTable { get; set; } = string.Empty;
    public string ToColumn { get; set; } = string.Empty;
    public string RelationshipType { get; set; } = "many-to-one";
    public decimal Confidence { get; set; }
    public IEnumerable<string> Reasons { get; set; } = new List<string>();
    public string Status { get; set; } = "suggested";
}

public class ProjectRelationshipDecisionDto
{
    public string? SuggestionId { get; set; }
    public int FromDatasetId { get; set; }
    public string FromTable { get; set; } = string.Empty;
    public string FromColumn { get; set; } = string.Empty;
    public int ToDatasetId { get; set; }
    public string ToTable { get; set; } = string.Empty;
    public string ToColumn { get; set; } = string.Empty;
    public string? RelationshipType { get; set; }
}

public class ProjectSchemaDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public IEnumerable<ProjectSchemaTableDto> Tables { get; set; } = new List<ProjectSchemaTableDto>();
    public IEnumerable<ProjectRelationshipSuggestionDto> Relationships { get; set; } = new List<ProjectRelationshipSuggestionDto>();
    public string SqlPreview { get; set; } = string.Empty;
    public string DbmlPreview { get; set; } = string.Empty;
    public string JsonPreview { get; set; } = string.Empty;
}

public class ProjectSchemaTableDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public IEnumerable<ProjectSchemaColumnDto> Columns { get; set; } = new List<ProjectSchemaColumnDto>();
    public IEnumerable<string> PrimaryKeyCandidates { get; set; } = new List<string>();
}

public class ProjectSchemaColumnDto
{
    public string Name { get; set; } = string.Empty;
    public string SourceColumnName { get; set; } = string.Empty;
    public string DetectedDataType { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKeyCandidate { get; set; }
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
