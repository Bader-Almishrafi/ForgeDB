using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Clients;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;

namespace ForgeDB.API.Services;

public class CleaningService : ICleaningService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ICleaningRepository _repository;
    private readonly IPythonAnalysisClient _python;
    private readonly IProjectWorkflowService? _workflowService;

    public CleaningService(
        ICleaningRepository repository,
        IPythonAnalysisClient python,
        IProjectWorkflowService? workflowService = null)
    {
        _repository = repository;
        _python = python;
        _workflowService = workflowService;
    }

    public async Task<ProjectCleaningSummaryDto> GetSummaryAsync(int projectId, int userId, CancellationToken cancellationToken = default)
    {
        var project = await RequireProjectAsync(projectId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var datasets = await _repository.GetActiveProjectVersionsAsync(projectId, cancellationToken);
        var suggestions = CleaningSuggestionBuilder.BuildSuggestions(projectId, datasets);
        var history = await _repository.GetHistoryAsync(projectId, cancellationToken);
        var state = await _repository.GetStateAsync(projectId, cancellationToken);
        var activeVersions = datasets.ToDictionary(item => item.Dataset.Id, item => item.Version.Id);
        var confirmedVersions = ParseConfirmedVersions(state?.ConfirmedVersionsJson);
        var qualityConfirmed = state?.QualityConfirmedAt is not null
            && activeVersions.Count == confirmedVersions.Count
            && activeVersions.All(pair => confirmedVersions.GetValueOrDefault(pair.Key) == pair.Value);
        var hasBatches = history.Any(entry => entry.Status is "Succeeded" or "PartiallySucceeded");
        var requiresReanalysis = datasets.Any(item => !item.Version.IsRawOriginal && item.Version.AnalyzedAt is null);
        // Data with zero detected issues has nothing to clean, so it can never produce a batch —
        // requiring one here would permanently block schema design for genuinely clean datasets.
        var canConfirm = !requiresReanalysis && datasets.Count > 0 && (hasBatches || suggestions.Count == 0);

        return new ProjectCleaningSummaryDto
        {
            ProjectId = project.Id,
            ProjectName = project.Name,
            TotalDatasets = datasets.Count,
            AnalyzedDatasets = datasets.Count(item => item.Version.AnalyzedAt is not null),
            UnanalyzedDatasets = datasets.Count(item => item.Version.AnalyzedAt is null),
            TotalRows = datasets.Sum(item => item.Version.RowCount),
            TotalColumns = datasets.Sum(item => item.Version.ColumnCount),
            TotalIssues = suggestions.Count,
            RowsAffected = suggestions.Sum(item => item.Count),
            CellsAffected = suggestions.Where(item => item.Column is not null).Sum(item => item.Count),
            MissingValues = datasets.Sum(item => item.Version.MissingValuesCount),
            DuplicateRows = datasets.Sum(item => item.Version.DuplicateRowsCount),
            DataQualityScore = null,
            LastAnalyzedAt = datasets.Select(item => item.Version.AnalyzedAt).Where(value => value.HasValue).Max(),
            HasCleaningBatches = hasBatches,
            RequiresReanalysis = requiresReanalysis,
            CanConfirmQuality = canConfirm,
            QualityConfirmed = qualityConfirmed,
            SchemaReady = qualityConfirmed && await _repository.IsSchemaReadyAsync(projectId, cancellationToken),
            QualityConfirmedAt = qualityConfirmed ? state?.QualityConfirmedAt : null,
            Datasets = datasets.Select(item => new DatasetCleaningSummaryDto
            {
                DatasetId = item.Dataset.Id,
                DatasetName = item.Dataset.TableName,
                ActiveVersionId = item.Version.Id,
                VersionNumber = item.Version.VersionNumber,
                IsRawOriginal = item.Version.IsRawOriginal,
                RowCount = item.Version.RowCount,
                ColumnCount = item.Version.ColumnCount,
                MissingValuesCount = item.Version.MissingValuesCount,
                DuplicateRowsCount = item.Version.DuplicateRowsCount,
                AnalyzedAt = item.Version.AnalyzedAt,
                RequiresReanalysis = !item.Version.IsRawOriginal && item.Version.AnalyzedAt is null
            }).ToList(),
            IssueCounts = suggestions.GroupBy(item => item.IssueType, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase)
        };
    }

    public async Task<IReadOnlyList<CleaningSuggestionDto>> GetSuggestionsAsync(int projectId, int userId, int? datasetId, string? issueType, string? column, string? search, CancellationToken cancellationToken = default)
    {
        await RequireProjectAsync(projectId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var datasets = await _repository.GetActiveProjectVersionsAsync(projectId, cancellationToken);
        var suggestions = CleaningSuggestionBuilder.BuildSuggestions(projectId, datasets);
        var query = search?.Trim();
        return suggestions.Where(item =>
            (!datasetId.HasValue || item.DatasetId == datasetId.Value)
            && (string.IsNullOrWhiteSpace(issueType) || issueType.Equals("all", StringComparison.OrdinalIgnoreCase) || item.IssueType.Equals(issueType, StringComparison.OrdinalIgnoreCase))
            && (string.IsNullOrWhiteSpace(column) || column.Equals("all", StringComparison.OrdinalIgnoreCase) || string.Equals(item.Column, column, StringComparison.OrdinalIgnoreCase))
            && (string.IsNullOrWhiteSpace(query) || $"{item.IssueType} {item.DatasetName} {item.Column} {item.Description}".Contains(query, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(item => item.DatasetName, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(item => item.Count)
            .ToList();
    }

    public async Task<CleaningPreviewResponseDto> PreviewAsync(int projectId, int userId, CleaningPreviewRequestDto request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await RequireProjectAsync(projectId, userId, cancellationToken);
        ValidateOperations(request.Operations);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        if (_workflowService is not null)
        {
            await _workflowService.EnsureCanCleanAsync(projectId, cancellationToken);
        }
        var response = new CleaningPreviewResponseDto();
        foreach (var group in request.Operations.GroupBy(operation => operation.DatasetId))
        {
            if (!await _repository.DatasetOwnedByAsync(group.Key, projectId, userId, cancellationToken))
            {
                throw new UnauthorizedAccessException("Dataset does not belong to the current project owner.");
            }
            var data = await _repository.GetActiveDatasetVersionAsync(group.Key, cancellationToken)
                ?? throw new KeyNotFoundException("Dataset or active version not found.");
            var operations = group.ToList();
            EnsureExpectedSourceVersion(operations, data.Version.Id);
            var pythonResult = await _python.PreviewCleaningAsync(BuildPythonRequest(data, operations), cancellationToken);
            response.Datasets.Add(MapPreview(data.Dataset.TableName, pythonResult));
        }
        response.AffectedRows = response.Datasets.Sum(item => item.AffectedRows);
        response.AffectedCells = response.Datasets.Sum(item => item.AffectedCells);
        response.RowsRemoved = response.Datasets.Sum(item => item.RowsRemoved);
        response.ColumnsRemoved = response.Datasets.Sum(item => item.ColumnsRemoved);
        response.Destructive = response.Datasets.Any(item => item.Destructive);
        response.Warnings = response.Datasets.SelectMany(item => item.Warnings).Distinct().ToList();
        return response;
    }

    public async Task<CleaningApplyResponseDto> ApplyAsync(int projectId, int userId, CleaningApplyRequestDto request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await RequireProjectAsync(projectId, userId, cancellationToken);
        ValidateOperations(request.Operations);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        if (_workflowService is not null)
        {
            await _workflowService.EnsureCanCleanAsync(projectId, cancellationToken);
        }

        var prepared = new List<(CleaningDatasetVersionData Data, List<CleaningOperationRequestDto> Requests, PythonCleaningResponseDto Preview)>();
        foreach (var group in request.Operations.GroupBy(operation => operation.DatasetId))
        {
            if (!await _repository.DatasetOwnedByAsync(group.Key, projectId, userId, cancellationToken))
            {
                throw new UnauthorizedAccessException("Dataset does not belong to the current project owner.");
            }
            var data = await _repository.GetActiveDatasetVersionAsync(group.Key, cancellationToken)
                ?? throw new KeyNotFoundException("Dataset or active version not found.");
            var operations = group.ToList();
            EnsureExpectedSourceVersion(operations, data.Version.Id);
            var preview = await _python.PreviewCleaningAsync(BuildPythonRequest(data, operations), cancellationToken);
            prepared.Add((data, operations, preview));
        }
        if (prepared.Any(item => item.Preview.Destructive) && !request.ConfirmDestructive)
        {
            throw new InvalidOperationException("Destructive cleaning operations require explicit confirmation.");
        }

        var batch = await _repository.CreateBatchAsync(projectId, userId,
            string.IsNullOrWhiteSpace(request.BatchName) ? "Apply cleaning fixes" : request.BatchName.Trim(), false, false, cancellationToken);
        var response = new CleaningApplyResponseDto { BatchId = batch.Id, CorrelationId = batch.CorrelationId };
        var failures = new List<object>();

        foreach (var item in prepared)
        {
            try
            {
                var result = await _python.ApplyCleaningAsync(BuildPythonRequest(item.Data, item.Requests), cancellationToken);
                var summary = string.Join(", ", item.Requests.Select(operation => DescribeOperation(operation)).Distinct());
                var version = await _repository.PersistVersionAsync(item.Data.Dataset.Id, item.Data.Version.Id, userId, batch, summary, result, item.Requests, cancellationToken);
                response.Datasets.Add(new DatasetCleaningApplyResultDto
                {
                    DatasetId = item.Data.Dataset.Id,
                    DatasetName = item.Data.Dataset.TableName,
                    Success = true,
                    VersionId = version.Id,
                    VersionNumber = version.VersionNumber,
                    RowsAffected = result.AffectedRows,
                    CellsAffected = result.AffectedCells
                });
            }
            catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or ArgumentException)
            {
                var message = SafeFailureMessage(exception);
                await _repository.AddFailedOperationsAsync(batch, item.Data.Dataset.Id, item.Data.Version.Id, item.Requests, message, cancellationToken);
                response.Datasets.Add(new DatasetCleaningApplyResultDto
                {
                    DatasetId = item.Data.Dataset.Id,
                    DatasetName = item.Data.Dataset.TableName,
                    Success = false,
                    Error = message
                });
                failures.Add(new { datasetId = item.Data.Dataset.Id, dataset = item.Data.Dataset.TableName, message });
            }
        }

        response.RowsAffected = response.Datasets.Sum(item => item.RowsAffected);
        response.CellsAffected = response.Datasets.Sum(item => item.CellsAffected);
        response.Status = response.Datasets.All(item => item.Success) ? "Succeeded"
            : response.Datasets.Any(item => item.Success) ? "PartiallySucceeded" : "Failed";
        await _repository.CompleteBatchAsync(batch, response.Status, response.RowsAffected, response.CellsAffected,
            failures.Count == 0 ? null : JsonSerializer.Serialize(failures, JsonOptions), cancellationToken);
        return response;
    }

    public async Task<CleaningApplyResponseDto> ApplyRecommendedAsync(int projectId, int userId, CleaningApplyRecommendedRequestDto request, CancellationToken cancellationToken = default)
    {
        var suggestions = await GetSuggestionsAsync(projectId, userId, null, null, null, null, cancellationToken);
        var selectedIds = request.SuggestionIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selected = suggestions.Where(suggestion => suggestion.RecommendedStrategy.IsSafeRecommended
            && (selectedIds.Count == 0 || selectedIds.Contains(suggestion.Id))).ToList();
        if (selected.Count == 0) throw new InvalidOperationException("No safe recommended fixes are available in the current scope.");
        return await ApplyAsync(projectId, userId, new CleaningApplyRequestDto
        {
            BatchName = "Fix all safe recommendations",
            ConfirmDestructive = request.ConfirmDestructive,
            Operations = selected.Select(suggestion => StrategyToOperation(suggestion, suggestion.RecommendedStrategy)).ToList()
        }, cancellationToken);
    }

    public async Task<CleaningHistoryDto> GetHistoryAsync(int projectId, int userId, CancellationToken cancellationToken = default)
    {
        await RequireProjectAsync(projectId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var active = (await _repository.GetActiveProjectVersionsAsync(projectId, cancellationToken)).ToDictionary(item => item.Dataset.Id, item => item.Version.Id);
        var entries = await _repository.GetHistoryAsync(projectId, cancellationToken);
        var latestUndoable = entries.FirstOrDefault(batch => !batch.IsUndo && !batch.IsRestore
            && batch.Operations.Any(operation => operation.ResultVersionId.HasValue)
            && batch.Operations.Where(operation => operation.ResultVersionId.HasValue).All(operation => active.GetValueOrDefault(operation.DatasetId) == operation.ResultVersionId));
        return new CleaningHistoryDto
        {
            Entries = entries.Select(batch => new CleaningHistoryEntryDto
            {
                BatchId = batch.Id,
                CorrelationId = batch.CorrelationId,
                Name = batch.Name,
                User = batch.CreatedByUser is null ? "ForgeDB user" : $"{batch.CreatedByUser.FirstName} {batch.CreatedByUser.LastName}".Trim(),
                CreatedAt = batch.CreatedAt,
                CompletedAt = batch.CompletedAt,
                Status = batch.Status,
                IsUndo = batch.IsUndo,
                IsRestore = batch.IsRestore,
                OperationCount = batch.OperationCount,
                RowsAffected = batch.RowsAffected,
                CellsAffected = batch.CellsAffected,
                FailureDetails = batch.FailureDetailsJson,
                CanUndo = latestUndoable?.Id == batch.Id,
                Operations = batch.Operations.Select(operation => new CleaningHistoryOperationDto
                {
                    Id = operation.Id,
                    DatasetId = operation.DatasetId,
                    DatasetName = operation.Dataset?.TableName ?? $"Dataset {operation.DatasetId}",
                    OperationType = operation.OperationType,
                    Column = operation.ColumnName,
                    Status = operation.Status,
                    RowsAffected = operation.RowsAffected,
                    CellsAffected = operation.CellsAffected,
                    ResultVersionId = operation.ResultVersionId,
                    ResultVersionNumber = operation.ResultVersion?.VersionNumber,
                    IsDestructive = operation.IsDestructive,
                    FailureMessage = operation.FailureMessage
                }).ToList()
            }).ToList()
        };
    }

    public async Task<IReadOnlyList<DatasetVersionDto>> GetVersionsAsync(int projectId, int datasetId, int userId, CancellationToken cancellationToken = default)
    {
        await RequireDatasetAsync(projectId, datasetId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        return (await _repository.GetVersionsAsync(datasetId, cancellationToken)).Select(MapVersion).ToList();
    }

    public async Task<CleanedDatasetPreviewDto> GetActivePreviewAsync(int projectId, int datasetId, int userId, CancellationToken cancellationToken = default)
    {
        await RequireDatasetAsync(projectId, datasetId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var data = await _repository.GetActiveDatasetVersionAsync(datasetId, cancellationToken)
            ?? throw new KeyNotFoundException("Active dataset version not found.");
        return new CleanedDatasetPreviewDto
        {
            DatasetId = datasetId,
            TableName = data.Dataset.TableName,
            VersionId = data.Version.Id,
            VersionNumber = data.Version.VersionNumber,
            IsRawOriginal = data.Version.IsRawOriginal,
            Columns = data.Columns.Select(column => column.Name).ToList(),
            Rows = data.Rows.Take(50).ToList()
        };
    }

    public async Task<CleaningApplyResponseDto> UndoLatestAsync(int projectId, int userId, CancellationToken cancellationToken = default)
    {
        await RequireProjectAsync(projectId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var targetBatch = await _repository.GetLatestUndoableBatchAsync(projectId, cancellationToken)
            ?? throw new InvalidOperationException("No cleaning batch is currently available to undo.");
        var active = (await _repository.GetActiveProjectVersionsAsync(projectId, cancellationToken)).ToDictionary(item => item.Dataset.Id);
        var resultOperations = targetBatch.Operations.Where(operation => operation.ResultVersionId.HasValue).GroupBy(operation => operation.DatasetId).ToList();
        if (resultOperations.Any(group => !active.TryGetValue(group.Key, out var current) || group.First().ResultVersionId != current.Version.Id))
        {
            throw new InvalidOperationException("The latest cleaning batch is no longer the active version and cannot be undone.");
        }
        var undoBatch = await _repository.CreateBatchAsync(projectId, userId, $"Undo {targetBatch.Name}", true, false, cancellationToken);
        return await CopyVersionsAsync(undoBatch, userId, resultOperations.Select(group => (Active: active[group.Key], TargetVersionId: group.First().SourceVersionId, OperationType: "undo_batch", Summary: $"Undo batch {targetBatch.Id}")), cancellationToken);
    }

    public async Task<CleaningApplyResponseDto> RestoreVersionAsync(int projectId, int datasetId, int userId, CleaningRestoreRequestDto request, CancellationToken cancellationToken = default)
    {
        await RequireDatasetAsync(projectId, datasetId, userId, cancellationToken);
        await _repository.EnsureRawVersionsAsync(projectId, userId, cancellationToken);
        var target = await _repository.GetVersionAsync(datasetId, request.VersionId, cancellationToken)
            ?? throw new KeyNotFoundException("Dataset version not found.");
        var active = await _repository.GetActiveDatasetVersionAsync(datasetId, cancellationToken)
            ?? throw new KeyNotFoundException("Active dataset version not found.");
        if (active.Version.Id == target.Id) throw new InvalidOperationException("The selected version is already active.");
        var batch = await _repository.CreateBatchAsync(projectId, userId, $"Restore {active.Dataset.TableName} version {target.VersionNumber}", false, true, cancellationToken);
        return await CopyVersionsAsync(batch, userId, new[] { (Active: active, TargetVersionId: target.Id, OperationType: "restore_version", Summary: $"Restore version {target.VersionNumber}") }, cancellationToken);
    }

    public async Task<QualityConfirmationDto> ConfirmQualityAsync(int projectId, int userId, CancellationToken cancellationToken = default)
    {
        await RequireProjectAsync(projectId, userId, cancellationToken);
        var active = await _repository.GetActiveProjectVersionsAsync(projectId, cancellationToken);
        if (active.Count == 0 || active.Any(item => item.Version.AnalyzedAt is null))
        {
            throw new InvalidOperationException("Re-run analysis for every active dataset version before confirming data quality.");
        }

        var history = await _repository.GetHistoryAsync(projectId, cancellationToken);
        var hasBatches = history.Any(batch => batch.Status is "Succeeded" or "PartiallySucceeded");
        if (!hasBatches)
        {
            // Data with zero detected issues can never produce a batch (there is nothing to fix),
            // so only require one when there are actual outstanding suggestions to address.
            var suggestions = CleaningSuggestionBuilder.BuildSuggestions(projectId, active);
            if (suggestions.Count > 0)
            {
                throw new InvalidOperationException("Apply at least one cleaning batch before confirming data quality.");
            }
        }

        var versions = active.ToDictionary(item => item.Dataset.Id, item => item.Version.Id);
        var state = await _repository.ConfirmQualityAsync(projectId, userId, versions, cancellationToken);
        return new QualityConfirmationDto
        {
            ProjectId = projectId,
            QualityConfirmed = true,
            SchemaReady = await _repository.IsSchemaReadyAsync(projectId, cancellationToken),
            ConfirmedAt = state.QualityConfirmedAt!.Value,
            ConfirmedVersions = versions
        };
    }

    private async Task<CleaningApplyResponseDto> CopyVersionsAsync(CleaningBatch batch, int userId, IEnumerable<(CleaningDatasetVersionData Active, int TargetVersionId, string OperationType, string Summary)> copies, CancellationToken cancellationToken)
    {
        var response = new CleaningApplyResponseDto { BatchId = batch.Id, CorrelationId = batch.CorrelationId, Status = "Succeeded" };
        foreach (var copy in copies)
        {
            var target = await _repository.GetVersionAsync(copy.Active.Dataset.Id, copy.TargetVersionId, cancellationToken)
                ?? throw new KeyNotFoundException("Source version for restore was not found.");
            var columns = CleaningSnapshotSerializer.DeserializeColumns(target.ColumnsJson);
            var rows = CleaningSnapshotSerializer.DeserializeRows(target.RowsJson);
            var request = new CleaningOperationRequestDto
            {
                OperationId = "operation-1",
                DatasetId = copy.Active.Dataset.Id,
                ExpectedSourceVersionId = copy.Active.Version.Id,
                OperationType = copy.OperationType,
                Parameters = JsonSerializer.SerializeToElement(new { targetVersionId = target.Id }, JsonOptions)
            };
            var pythonResult = new PythonCleaningResponseDto
            {
                DatasetId = copy.Active.Dataset.Id,
                SourceVersionId = copy.Active.Version.Id,
                ExecutionOrder = new() { "operation-1" },
                Columns = columns,
                ResultRows = rows,
                AffectedRows = Math.Max(copy.Active.Version.RowCount, target.RowCount),
                AffectedCells = Math.Max(copy.Active.Version.RowCount, target.RowCount) * Math.Max(copy.Active.Version.ColumnCount, target.ColumnCount),
                Destructive = false,
                OperationResults = new() { new CleaningOperationResultDto { OperationId = "operation-1", OperationType = copy.OperationType, AffectedRows = Math.Max(copy.Active.Version.RowCount, target.RowCount), AffectedCells = Math.Max(copy.Active.Version.RowCount, target.RowCount) * Math.Max(copy.Active.Version.ColumnCount, target.ColumnCount) } }
            };
            var version = await _repository.PersistVersionAsync(copy.Active.Dataset.Id, copy.Active.Version.Id, userId, batch, copy.Summary, pythonResult, new[] { request }, cancellationToken);
            response.Datasets.Add(new DatasetCleaningApplyResultDto { DatasetId = copy.Active.Dataset.Id, DatasetName = copy.Active.Dataset.TableName, Success = true, VersionId = version.Id, VersionNumber = version.VersionNumber, RowsAffected = pythonResult.AffectedRows, CellsAffected = pythonResult.AffectedCells });
        }
        response.RowsAffected = response.Datasets.Sum(item => item.RowsAffected);
        response.CellsAffected = response.Datasets.Sum(item => item.CellsAffected);
        await _repository.CompleteBatchAsync(batch, "Succeeded", response.RowsAffected, response.CellsAffected, null, cancellationToken);
        return response;
    }

    private static CleaningOperationRequestDto StrategyToOperation(CleaningSuggestionDto suggestion, CleaningStrategyDto strategy) => new()
    {
        OperationId = suggestion.Id,
        SuggestionId = suggestion.Id,
        DatasetId = suggestion.DatasetId,
        ExpectedSourceVersionId = suggestion.VersionId,
        OperationType = strategy.OperationType,
        Column = suggestion.Column,
        Parameters = JsonSerializer.SerializeToElement(strategy.Parameters, JsonOptions)
    };

    private static PythonCleaningRequestDto BuildPythonRequest(CleaningDatasetVersionData data, IReadOnlyList<CleaningOperationRequestDto> operations) => new()
    {
        DatasetId = data.Dataset.Id,
        VersionId = data.Version.Id,
        TableName = data.Dataset.TableName,
        Columns = data.Columns,
        Rows = data.Rows,
        Operations = operations.Select((operation, index) => new PythonCleaningOperationDto
        {
            OperationId = operation.OperationId ?? $"operation-{index + 1}",
            OperationType = operation.OperationType.Trim().ToLowerInvariant(),
            Column = operation.Column,
            Parameters = operation.Parameters.ValueKind is JsonValueKind.Undefined
                ? new Dictionary<string, object?>()
                : JsonSerializer.Deserialize<Dictionary<string, object?>>(operation.Parameters.GetRawText(), JsonOptions) ?? new()
        }).ToList()
    };

    private static DatasetCleaningPreviewDto MapPreview(string datasetName, PythonCleaningResponseDto response) => new()
    {
        DatasetId = response.DatasetId,
        DatasetName = datasetName,
        SourceVersionId = response.SourceVersionId,
        ExecutionOrder = response.ExecutionOrder,
        Rows = response.PreviewRows,
        OperationResults = response.OperationResults,
        AffectedRows = response.AffectedRows,
        AffectedCells = response.AffectedCells,
        RowsRemoved = response.RowsRemoved,
        ColumnsRemoved = response.ColumnsRemoved,
        ColumnsRenamed = response.ColumnsRenamed,
        Destructive = response.Destructive,
        ConversionFailures = response.ConversionFailures,
        Warnings = response.Warnings
    };

    private static DatasetVersionDto MapVersion(DatasetVersion version) => new()
    {
        Id = version.Id,
        DatasetId = version.DatasetId,
        ParentVersionId = version.ParentVersionId,
        VersionNumber = version.VersionNumber,
        IsRawOriginal = version.IsRawOriginal,
        IsActive = version.IsActive,
        RowCount = version.RowCount,
        ColumnCount = version.ColumnCount,
        OperationSummary = version.OperationSummary,
        CreatedAt = version.CreatedAt,
        AnalyzedAt = version.AnalyzedAt,
        CreatedBy = version.CreatedByUser is null ? "ForgeDB user" : $"{version.CreatedByUser.FirstName} {version.CreatedByUser.LastName}".Trim()
    };

    private async Task<Project> RequireProjectAsync(int projectId, int userId, CancellationToken cancellationToken)
    {
        if (projectId <= 0 || userId <= 0) throw new ArgumentException("Project and authenticated user IDs must be positive.");
        return await _repository.GetOwnedProjectAsync(projectId, userId, cancellationToken)
            ?? throw new UnauthorizedAccessException("Project was not found or is not owned by the authenticated user.");
    }

    private async Task RequireDatasetAsync(int projectId, int datasetId, int userId, CancellationToken cancellationToken)
    {
        await RequireProjectAsync(projectId, userId, cancellationToken);
        if (datasetId <= 0 || !await _repository.DatasetOwnedByAsync(datasetId, projectId, userId, cancellationToken))
            throw new UnauthorizedAccessException("Dataset was not found or is not owned by the authenticated user.");
    }

    private static void ValidateOperations(IReadOnlyList<CleaningOperationRequestDto>? operations)
    {
        if (operations is null || operations.Count == 0) throw new ArgumentException("At least one cleaning operation is required.");
        if (operations.Count > 100) throw new ArgumentException("A cleaning request may contain at most 100 operations.");
        if (operations.Any(operation => operation.DatasetId <= 0 || string.IsNullOrWhiteSpace(operation.OperationType)))
            throw new ArgumentException("Every cleaning operation requires a dataset and operation type.");
        if (operations.Any(operation => operation.ExpectedSourceVersionId <= 0))
            throw new ArgumentException("Every cleaning operation requires a positive expected source version ID.");
    }

    private static void EnsureExpectedSourceVersion(IReadOnlyList<CleaningOperationRequestDto> operations, int activeVersionId)
    {
        if (operations.Any(operation => operation.ExpectedSourceVersionId != activeVersionId))
        {
            throw new ActiveCleaningVersionChangedException();
        }
    }

    private static string DescribeOperation(CleaningOperationRequestDto operation) => operation.Column is null
        ? operation.OperationType.Replace('_', ' ')
        : $"{operation.OperationType.Replace('_', ' ')} on {operation.Column}";

    private static string SafeFailureMessage(Exception exception) => exception is HttpRequestException
        ? "The cleaning execution service could not complete this dataset."
        : exception.Message;

    private static Dictionary<int, int> ParseConfirmedVersions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<int, int>>(json, JsonOptions) ?? new(); }
        catch (JsonException) { return new(); }
    }
}
