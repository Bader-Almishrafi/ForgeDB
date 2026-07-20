using System.Text.Json;

namespace ForgeDB.API.Models.DTOs;

public class CleaningColumnSnapshotDto
{
    public string Name { get; set; } = string.Empty;
    public string DataType { get; set; } = "string";
}

public class CleaningStrategyDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string OperationType { get; set; } = string.Empty;
    public Dictionary<string, object?> Parameters { get; set; } = new();
    public bool IsSafeRecommended { get; set; }
    public bool IsDestructive { get; set; }
}

public class CleaningSuggestionDto
{
    public string Id { get; set; } = string.Empty;
    public int ProjectId { get; set; }
    public int DatasetId { get; set; }
    public int VersionId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public string IssueType { get; set; } = string.Empty;
    public string? Column { get; set; }
    public int Count { get; set; }
    public decimal? Percentage { get; set; }
    public string RiskLabel { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public CleaningStrategyDto RecommendedStrategy { get; set; } = new();
    public List<CleaningStrategyDto> AvailableStrategies { get; set; } = new();
}

public class ProjectCleaningSummaryDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public int TotalDatasets { get; set; }
    public int AnalyzedDatasets { get; set; }
    public int UnanalyzedDatasets { get; set; }
    public int TotalRows { get; set; }
    public int TotalColumns { get; set; }
    public int TotalIssues { get; set; }
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public int MissingValues { get; set; }
    public int DuplicateRows { get; set; }
    public decimal? DataQualityScore { get; set; }
    public DateTime? LastAnalyzedAt { get; set; }
    public bool HasCleaningBatches { get; set; }
    public bool RequiresReanalysis { get; set; }
    public bool CanConfirmQuality { get; set; }
    public bool QualityConfirmed { get; set; }
    public bool SchemaReady { get; set; }
    public DateTime? QualityConfirmedAt { get; set; }
    public List<DatasetCleaningSummaryDto> Datasets { get; set; } = new();
    public Dictionary<string, int> IssueCounts { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public class DatasetCleaningSummaryDto
{
    public int DatasetId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public int ActiveVersionId { get; set; }
    public int VersionNumber { get; set; }
    public bool IsRawOriginal { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public int MissingValuesCount { get; set; }
    public int DuplicateRowsCount { get; set; }
    public DateTime? AnalyzedAt { get; set; }
    public bool RequiresReanalysis { get; set; }
}

public class CleaningOperationRequestDto
{
    public string? OperationId { get; set; }
    public string? SuggestionId { get; set; }
    public int DatasetId { get; set; }
    public int? ExpectedSourceVersionId { get; set; }
    public string OperationType { get; set; } = string.Empty;
    public string? Column { get; set; }
    public JsonElement Parameters { get; set; }
}

public class CleaningPreviewRequestDto
{
    public List<CleaningOperationRequestDto> Operations { get; set; } = new();
}

public class CleaningApplyRequestDto : CleaningPreviewRequestDto
{
    public string? BatchName { get; set; }
    public bool ConfirmDestructive { get; set; }
}

public class CleaningApplyRecommendedRequestDto
{
    public List<string> SuggestionIds { get; set; } = new();
    public bool ConfirmDestructive { get; set; }
}

public class CleaningPreviewResponseDto
{
    public List<DatasetCleaningPreviewDto> Datasets { get; set; } = new();
    public int AffectedRows { get; set; }
    public int AffectedCells { get; set; }
    public int RowsRemoved { get; set; }
    public int ColumnsRemoved { get; set; }
    public bool Destructive { get; set; }
    public List<string> Warnings { get; set; } = new();
}

public class DatasetCleaningPreviewDto
{
    public int DatasetId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public int SourceVersionId { get; set; }
    public List<string> ExecutionOrder { get; set; } = new();
    public List<CleaningPreviewRowDto> Rows { get; set; } = new();
    public List<CleaningOperationResultDto> OperationResults { get; set; } = new();
    public int AffectedRows { get; set; }
    public int AffectedCells { get; set; }
    public int RowsRemoved { get; set; }
    public int ColumnsRemoved { get; set; }
    public int ColumnsRenamed { get; set; }
    public bool Destructive { get; set; }
    public List<CleaningConversionFailureDto> ConversionFailures { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

public class CleaningPreviewRowDto
{
    public int RowNumber { get; set; }
    public Dictionary<string, object?>? Before { get; set; }
    public Dictionary<string, object?>? After { get; set; }
}

public class CleaningConversionFailureDto
{
    public int RowNumber { get; set; }
    public string Column { get; set; } = string.Empty;
    public object? Value { get; set; }
    public string Reason { get; set; } = string.Empty;
}

public class CleaningOperationResultDto
{
    public string OperationId { get; set; } = string.Empty;
    public string OperationType { get; set; } = string.Empty;
    public string? Column { get; set; }
    public int AffectedRows { get; set; }
    public int AffectedCells { get; set; }
    public int RowsRemoved { get; set; }
    public int ColumnsRemoved { get; set; }
    public int ColumnsRenamed { get; set; }
    public bool Destructive { get; set; }
    public List<string> Warnings { get; set; } = new();
}

public class CleaningApplyResponseDto
{
    public int BatchId { get; set; }
    public Guid CorrelationId { get; set; }
    public string Status { get; set; } = string.Empty;
    public List<DatasetCleaningApplyResultDto> Datasets { get; set; } = new();
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
}

public class DatasetCleaningApplyResultDto
{
    public int DatasetId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public bool Success { get; set; }
    public int? VersionId { get; set; }
    public int? VersionNumber { get; set; }
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public string? Error { get; set; }
}

public class CleaningHistoryDto
{
    public List<CleaningHistoryEntryDto> Entries { get; set; } = new();
}

public class CleaningHistoryEntryDto
{
    public int BatchId { get; set; }
    public Guid CorrelationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string User { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool IsUndo { get; set; }
    public bool IsRestore { get; set; }
    public int OperationCount { get; set; }
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public string? FailureDetails { get; set; }
    public bool CanUndo { get; set; }
    public List<CleaningHistoryOperationDto> Operations { get; set; } = new();
}

public class CleaningHistoryOperationDto
{
    public int Id { get; set; }
    public int DatasetId { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public string OperationType { get; set; } = string.Empty;
    public string? Column { get; set; }
    public string Status { get; set; } = string.Empty;
    public int RowsAffected { get; set; }
    public int CellsAffected { get; set; }
    public int? ResultVersionId { get; set; }
    public int? ResultVersionNumber { get; set; }
    public bool IsDestructive { get; set; }
    public string? FailureMessage { get; set; }
}

public class DatasetVersionDto
{
    public int Id { get; set; }
    public int DatasetId { get; set; }
    public int? ParentVersionId { get; set; }
    public int VersionNumber { get; set; }
    public bool IsRawOriginal { get; set; }
    public bool IsActive { get; set; }
    public int RowCount { get; set; }
    public int ColumnCount { get; set; }
    public string OperationSummary { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? AnalyzedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
}

public class CleaningRestoreRequestDto
{
    public int VersionId { get; set; }
}

public class QualityConfirmationDto
{
    public int ProjectId { get; set; }
    public bool QualityConfirmed { get; set; }
    public bool SchemaReady { get; set; }
    public DateTime ConfirmedAt { get; set; }
    public Dictionary<int, int> ConfirmedVersions { get; set; } = new();
}

public class CleanedDatasetPreviewDto
{
    public int DatasetId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public int VersionId { get; set; }
    public int VersionNumber { get; set; }
    public bool IsRawOriginal { get; set; }
    public List<string> Columns { get; set; } = new();
    public List<Dictionary<string, object?>> Rows { get; set; } = new();
}

public class PythonCleaningRequestDto
{
    public int DatasetId { get; set; }
    public int VersionId { get; set; }
    public string TableName { get; set; } = string.Empty;
    public List<CleaningColumnSnapshotDto> Columns { get; set; } = new();
    public List<Dictionary<string, object?>> Rows { get; set; } = new();
    public List<PythonCleaningOperationDto> Operations { get; set; } = new();
}

public class PythonCleaningOperationDto
{
    public string? OperationId { get; set; }
    public string OperationType { get; set; } = string.Empty;
    public string? Column { get; set; }
    public Dictionary<string, object?> Parameters { get; set; } = new();
}

public class PythonCleaningResponseDto
{
    public int DatasetId { get; set; }
    public int SourceVersionId { get; set; }
    public List<string> ExecutionOrder { get; set; } = new();
    public List<CleaningColumnSnapshotDto> Columns { get; set; } = new();
    public List<Dictionary<string, object?>> ResultRows { get; set; } = new();
    public List<CleaningPreviewRowDto> PreviewRows { get; set; } = new();
    public List<CleaningOperationResultDto> OperationResults { get; set; } = new();
    public int AffectedRows { get; set; }
    public int AffectedCells { get; set; }
    public int RowsRemoved { get; set; }
    public int ColumnsRemoved { get; set; }
    public int ColumnsRenamed { get; set; }
    public List<CleaningConversionFailureDto> ConversionFailures { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public bool Destructive { get; set; }
}
