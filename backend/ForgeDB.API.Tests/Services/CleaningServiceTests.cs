using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using ForgeDB.API.Clients;
using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Services;

public class CleaningServiceTests
{
    [Fact]
    public async Task Preview_DoesNotPersistAnyVersionOrModifyOriginalRows()
    {
        await using var fixture = await Fixture.CreateAsync();
        var before = await fixture.Context.DatasetRows.Select(row => row.RowData).ToListAsync();
        var response = await fixture.Service.PreviewAsync(1, 1, PreviewRequest(1), CancellationToken.None);

        Assert.Single(response.Datasets);
        Assert.Single(await fixture.Context.DatasetVersions.ToListAsync());
        Assert.Equal(before, await fixture.Context.DatasetRows.Select(row => row.RowData).ToListAsync());
        Assert.Empty(await fixture.Context.CleaningBatches.ToListAsync());
    }

    [Fact]
    public async Task Preview_RejectsAnExpectedSourceVersionThatIsNoLongerActive()
    {
        await using var fixture = await Fixture.CreateAsync();
        var summary = await fixture.Service.GetSummaryAsync(1, 1, CancellationToken.None);
        var request = PreviewRequest(1);
        request.Operations[0].ExpectedSourceVersionId = summary.Datasets.Single().ActiveVersionId + 1;

        await Assert.ThrowsAsync<ActiveCleaningVersionChangedException>(() =>
            fixture.Service.PreviewAsync(1, 1, request, CancellationToken.None));

        Assert.Empty(await fixture.Context.CleaningBatches.ToListAsync());
    }

    [Fact]
    public async Task Controller_ReturnsActiveVersionConflictCode_ForAStalePreview()
    {
        await using var fixture = await Fixture.CreateAsync();
        var summary = await fixture.Service.GetSummaryAsync(1, 1, CancellationToken.None);
        var request = PreviewRequest(1);
        request.Operations[0].ExpectedSourceVersionId = summary.Datasets.Single().ActiveVersionId + 1;
        var controller = new CleaningController(fixture.Service)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, "1") }, "Test"))
                }
            }
        };

        var response = await controller.Preview(1, request, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(response.Result);
        Assert.Equal(409, conflict.StatusCode);
        Assert.Contains("active_version_changed", JsonSerializer.Serialize(conflict.Value));
    }

    [Fact]
    public async Task Apply_CreatesNewActiveVersion_AndPreservesRawDatasetRows()
    {
        await using var fixture = await Fixture.CreateAsync();
        var original = await fixture.Context.DatasetRows.OrderBy(row => row.RowNumber).Select(row => row.RowData).ToListAsync();

        var response = await fixture.Service.ApplyAsync(1, 1, ApplyRequest(1), CancellationToken.None);

        Assert.Equal("Succeeded", response.Status);
        var versions = await fixture.Context.DatasetVersions.OrderBy(version => version.VersionNumber).ToListAsync();
        Assert.Equal(2, versions.Count);
        Assert.True(versions[0].IsRawOriginal);
        Assert.False(versions[0].IsActive);
        Assert.True(versions[1].IsActive);
        Assert.Equal(2, versions[1].VersionNumber);
        Assert.Null(versions[1].AnalyzedAt);
        Assert.Contains("cleaned", versions[1].RowsJson);
        var dataset = await fixture.Context.Datasets.SingleAsync();
        Assert.Equal(versions[1].Id, dataset.ActiveVersionId);
        Assert.Null(dataset.AnalyzedAt);
        Assert.Null(dataset.AnalysisResultJson);
        Assert.Equal(original, await fixture.Context.DatasetRows.OrderBy(row => row.RowNumber).Select(row => row.RowData).ToListAsync());
        Assert.Single(await fixture.Context.CleaningBatches.ToListAsync());
        Assert.Single(await fixture.Context.CleaningOperations.ToListAsync());
    }

    [Fact]
    public async Task Apply_RejectsAnExpectedSourceVersionThatIsNoLongerActive()
    {
        await using var fixture = await Fixture.CreateAsync();
        var summary = await fixture.Service.GetSummaryAsync(1, 1, CancellationToken.None);
        var request = ApplyRequest(1);
        request.Operations[0].ExpectedSourceVersionId = summary.Datasets.Single().ActiveVersionId + 1;

        await Assert.ThrowsAsync<ActiveCleaningVersionChangedException>(() =>
            fixture.Service.ApplyAsync(1, 1, request, CancellationToken.None));

        Assert.Empty(await fixture.Context.CleaningBatches.ToListAsync());
        Assert.Single(await fixture.Context.DatasetVersions.ToListAsync());
    }

    [Fact]
    public async Task Apply_RejectsInvalidOperationsAndForeignOwnership()
    {
        await using var fixture = await Fixture.CreateAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => fixture.Service.ApplyAsync(1, 1, new CleaningApplyRequestDto(), CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => fixture.Service.GetSummaryAsync(1, 2, CancellationToken.None));
    }

    [Fact]
    public async Task Apply_RejectsProjectWithUnanalyzedActiveDataset()
    {
        await using var fixture = await Fixture.CreateAsync(datasetAnalyzed: false);

        var exception = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() =>
            fixture.Service.ApplyAsync(1, 1, ApplyRequest(1), CancellationToken.None));

        Assert.Contains("analysis_required", exception.BlockerCodes);
        Assert.Empty(await fixture.Context.CleaningBatches.ToListAsync());
    }

    [Fact]
    public async Task Apply_ReportsPartialDatasetFailureWithoutRollingBackSuccess()
    {
        await using var fixture = await Fixture.CreateAsync(includeSecondDataset: true, failApplyDatasetId: 2);
        var request = new CleaningApplyRequestDto
        {
            BatchName = "Project fixes",
            Operations = new() { Operation(1), Operation(2) }
        };

        var response = await fixture.Service.ApplyAsync(1, 1, request, CancellationToken.None);

        Assert.Equal("PartiallySucceeded", response.Status);
        Assert.Contains(response.Datasets, result => result.DatasetId == 1 && result.Success);
        Assert.Contains(response.Datasets, result => result.DatasetId == 2 && !result.Success);
        Assert.Equal(2, await fixture.Context.DatasetVersions.CountAsync(version => version.DatasetId == 1));
        Assert.Single(await fixture.Context.DatasetVersions.Where(version => version.DatasetId == 2).ToListAsync());
        Assert.Contains(await fixture.Context.CleaningOperations.ToListAsync(), operation => operation.DatasetId == 2 && operation.Status == "Failed");
    }

    [Fact]
    public async Task Undo_CreatesRestorationVersionWithoutRecalculatingInverse()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.ApplyAsync(1, 1, ApplyRequest(1), CancellationToken.None);

        var undo = await fixture.Service.UndoLatestAsync(1, 1, CancellationToken.None);

        Assert.Equal("Succeeded", undo.Status);
        var versions = await fixture.Context.DatasetVersions.OrderBy(version => version.VersionNumber).ToListAsync();
        Assert.Equal(3, versions.Count);
        Assert.True(versions[2].IsActive);
        Assert.Equal(versions[0].RowsJson, versions[2].RowsJson);
        Assert.Contains(await fixture.Context.CleaningBatches.ToListAsync(), batch => batch.IsUndo);
    }

    [Fact]
    public async Task Restore_CreatesNewVersionAndPreservesVersionHistory()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.ApplyAsync(1, 1, ApplyRequest(1), CancellationToken.None);
        var raw = await fixture.Context.DatasetVersions.SingleAsync(version => version.IsRawOriginal);

        var restore = await fixture.Service.RestoreVersionAsync(1, 1, 1, new CleaningRestoreRequestDto { VersionId = raw.Id }, CancellationToken.None);

        Assert.Equal("Succeeded", restore.Status);
        Assert.Equal(3, await fixture.Context.DatasetVersions.CountAsync());
        Assert.Contains(await fixture.Context.CleaningBatches.ToListAsync(), batch => batch.IsRestore);
    }

    [Fact]
    public async Task QualityConfirmation_RequiresReanalysisAndPersistsConfirmedVersions()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.Service.ApplyAsync(1, 1, ApplyRequest(1), CancellationToken.None);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Service.ConfirmQualityAsync(1, 1, CancellationToken.None));
        var active = await fixture.Context.DatasetVersions.SingleAsync(version => version.IsActive);
        active.AnalyzedAt = DateTime.UtcNow;
        await fixture.Context.SaveChangesAsync();

        var confirmation = await fixture.Service.ConfirmQualityAsync(1, 1, CancellationToken.None);

        Assert.True(confirmation.QualityConfirmed);
        Assert.True(confirmation.SchemaReady);
        var state = await fixture.Context.ProjectCleaningStates.SingleAsync();
        Assert.NotNull(state.QualityConfirmedAt);
        Assert.Contains(active.Id.ToString(), state.ConfirmedVersionsJson);
    }

    [Fact]
    public async Task GetSummary_AllowsQualityConfirmation_ForCleanDataWithNoIssuesAndNoBatches()
    {
        // A dataset with zero detected issues can never produce a cleaning batch (there is nothing
        // to fix), so gating confirmation behind "a batch has run" would permanently block schema
        // design for genuinely clean data. Confirmation must be reachable once analysis is current.
        await using var fixture = await Fixture.CreateAsync(datasetHasIssues: false);

        var summary = await fixture.Service.GetSummaryAsync(1, 1, CancellationToken.None);

        Assert.Equal(0, summary.TotalIssues);
        Assert.False(summary.HasCleaningBatches);
        Assert.False(summary.RequiresReanalysis);
        Assert.True(summary.CanConfirmQuality);

        var confirmation = await fixture.Service.ConfirmQualityAsync(1, 1, CancellationToken.None);
        Assert.True(confirmation.QualityConfirmed);
        Assert.True(confirmation.SchemaReady);
    }

    [Fact]
    public async Task Suggestions_ExposeImportedWhitespaceAsVersionedTrimOperation()
    {
        await using var fixture = await Fixture.CreateAsync(datasetHasIssues: false);
        var firstRow = await fixture.Context.DatasetRows.OrderBy(row => row.RowNumber).FirstAsync();
        firstRow.RowData = "{\"name\":\" Alpha \",\"amount\":1}";
        await fixture.Context.SaveChangesAsync();

        var suggestions = await fixture.Service.GetSuggestionsAsync(1, 1, null, null, null, null, CancellationToken.None);

        var whitespace = Assert.Single(suggestions, suggestion =>
            suggestion.DatasetName == "customers"
            && suggestion.IssueType == "Extra Spaces"
            && suggestion.Column == "name");
        Assert.Equal("text_normalize", whitespace.RecommendedStrategy.OperationType);
        Assert.Equal("trim-collapse", whitespace.RecommendedStrategy.Key);
    }

    [Fact]
    public void Controller_RequiresAuthorization()
    {
        Assert.NotNull(typeof(CleaningController).GetCustomAttribute<AuthorizeAttribute>());
    }

    private static CleaningPreviewRequestDto PreviewRequest(int datasetId) => new() { Operations = new() { Operation(datasetId) } };
    private static CleaningApplyRequestDto ApplyRequest(int datasetId) => new() { BatchName = "Fill missing", Operations = new() { Operation(datasetId) } };
    private static CleaningOperationRequestDto Operation(int datasetId) => new()
    {
        OperationId = $"missing-{datasetId}",
        DatasetId = datasetId,
        OperationType = "fill_missing",
        Column = "name",
        Parameters = JsonSerializer.SerializeToElement(new { strategy = "custom", value = "cleaned" })
    };

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(ForgeDbContext context, CleaningService service)
        {
            Context = context;
            Service = service;
        }

        public ForgeDbContext Context { get; }
        public CleaningService Service { get; }

        public static async Task<Fixture> CreateAsync(
            bool includeSecondDataset = false,
            int? failApplyDatasetId = null,
            bool datasetHasIssues = true,
            bool datasetAnalyzed = true)
        {
            var options = new DbContextOptionsBuilder<ForgeDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            var context = new ForgeDbContext(options);
            context.Users.AddRange(
                new User { Id = 1, FirstName = "Owner", LastName = "User", Email = "owner@example.com", PasswordHash = "x", Role = "User", CreatedAt = DateTime.UtcNow },
                new User { Id = 2, FirstName = "Other", LastName = "User", Email = "other@example.com", PasswordHash = "x", Role = "User", CreatedAt = DateTime.UtcNow });
            context.Projects.Add(new Project { Id = 1, UserId = 1, Name = "Cleaning project", CreatedAt = DateTime.UtcNow });
            context.Datasets.Add(CreateDataset(1, "customers", datasetHasIssues, datasetAnalyzed));
            if (includeSecondDataset) context.Datasets.Add(CreateDataset(2, "orders", datasetHasIssues, datasetAnalyzed));
            await context.SaveChangesAsync();
            var repository = new CleaningRepository(context);
            var service = new CleaningService(repository, new FakePythonClient(failApplyDatasetId), new ProjectWorkflowService(context));
            return new Fixture(context, service);
        }

        private static Dataset CreateDataset(int id, string name, bool hasIssues = true, bool analyzed = true) => new()
        {
            Id = id,
            ProjectId = 1,
            TableName = name,
            SourceType = "csv",
            RowCount = 2,
            ColumnCount = 2,
            MissingValuesCount = hasIssues ? 1 : 0,
            Status = analyzed ? "Analyzed" : "Imported",
            CreatedAt = DateTime.UtcNow,
            AnalyzedAt = analyzed ? DateTime.UtcNow : null,
            AnalysisResultJson = !analyzed
                ? null
                : hasIssues
                ? "{\"rowCount\":2,\"columnCount\":2,\"missingValuesCount\":1,\"duplicateRowsCount\":0,\"columns\":[{\"columnName\":\"name\",\"detectedDataType\":\"string\",\"missingValuesCount\":1},{\"columnName\":\"amount\",\"detectedDataType\":\"integer\",\"missingValuesCount\":0}]}"
                : "{\"rowCount\":2,\"columnCount\":2,\"missingValuesCount\":0,\"duplicateRowsCount\":0,\"columns\":[{\"columnName\":\"name\",\"detectedDataType\":\"string\",\"missingValuesCount\":0},{\"columnName\":\"amount\",\"detectedDataType\":\"integer\",\"missingValuesCount\":0}]}",
            Columns = new List<DatasetColumn>
            {
                new() { ColumnName = "name", DetectedDataType = "string", MissingValuesCount = hasIssues ? 1 : 0, IsNullable = hasIssues },
                new() { ColumnName = "amount", DetectedDataType = "integer" }
            },
            Rows = hasIssues
                ? new List<DatasetRow>
                {
                    new() { RowNumber = 1, RowData = "{\"name\":null,\"amount\":1}", CreatedAt = DateTime.UtcNow },
                    new() { RowNumber = 2, RowData = "{\"name\":\"Original\",\"amount\":2}", CreatedAt = DateTime.UtcNow }
                }
                : new List<DatasetRow>
                {
                    new() { RowNumber = 1, RowData = "{\"name\":\"Alpha\",\"amount\":1}", CreatedAt = DateTime.UtcNow },
                    new() { RowNumber = 2, RowData = "{\"name\":\"Beta\",\"amount\":2}", CreatedAt = DateTime.UtcNow }
                }
        };

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }

    private sealed class FakePythonClient : IPythonAnalysisClient
    {
        private readonly int? _failApplyDatasetId;
        public FakePythonClient(int? failApplyDatasetId) => _failApplyDatasetId = failApplyDatasetId;
        public Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PythonCleaningResponseDto> PreviewCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default) => Task.FromResult(Transform(request));
        public Task<PythonCleaningResponseDto> ApplyCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default)
        {
            if (request.DatasetId == _failApplyDatasetId) throw new HttpRequestException("simulated failure");
            return Task.FromResult(Transform(request));
        }

        private static PythonCleaningResponseDto Transform(PythonCleaningRequestDto request)
        {
            var rows = request.Rows.Select(row => new Dictionary<string, object?>(row)).ToList();
            foreach (var row in rows) if (!row.TryGetValue("name", out var value) || value is null) row["name"] = "cleaned";
            var operation = request.Operations[0];
            return new PythonCleaningResponseDto
            {
                DatasetId = request.DatasetId,
                SourceVersionId = request.VersionId,
                ExecutionOrder = new() { operation.OperationId! },
                Columns = request.Columns,
                ResultRows = rows,
                AffectedRows = 1,
                AffectedCells = 1,
                OperationResults = new() { new CleaningOperationResultDto { OperationId = operation.OperationId!, OperationType = operation.OperationType, Column = operation.Column, AffectedRows = 1, AffectedCells = 1 } },
                PreviewRows = new() { new CleaningPreviewRowDto { RowNumber = 1, Before = request.Rows[0], After = rows[0] } }
            };
        }
    }
}
