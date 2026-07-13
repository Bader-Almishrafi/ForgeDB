using System.Text;
using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ForgeDB.API.Tests.Services;

/// <summary>
/// Covers the Delete/Replace Dataset endpoints added to close the "Delete dataset" / "Replace
/// dataset" Required Final ForgeDB Scope gap. Focuses on the cascade cleanup of rows that would
/// otherwise block deletion via RESTRICT foreign keys (CleaningOperation, RelationshipSuggestion).
/// </summary>
public class DatasetManagementTests
{
    [Fact]
    public async Task DeleteDatasetAsync_RemovesDatasetAndDependentRows_ButKeepsSiblingCleaningBatchData()
    {
        await using var context = NewContext();
        var seed = await SeedProjectWithTwoDatasetsAndHistoryAsync(context);
        var service = BuildService(context);

        var deleted = await service.DeleteDatasetAsync(seed.DatasetToDeleteId, CancellationToken.None);

        Assert.True(deleted);
        Assert.False(await context.Datasets.AnyAsync(dataset => dataset.Id == seed.DatasetToDeleteId));
        Assert.False(await context.DatasetVersions.AnyAsync(version => version.DatasetId == seed.DatasetToDeleteId));
        Assert.False(await context.CleaningOperations.AnyAsync(operation => operation.DatasetId == seed.DatasetToDeleteId));
        Assert.False(await context.RelationshipSuggestions.AnyAsync(suggestion =>
            suggestion.SourceDatasetId == seed.DatasetToDeleteId || suggestion.TargetDatasetId == seed.DatasetToDeleteId));

        // The sibling dataset and the shared cleaning batch (which may cover other datasets too) survive.
        Assert.True(await context.Datasets.AnyAsync(dataset => dataset.Id == seed.OtherDatasetId));
        Assert.True(await context.CleaningBatches.AnyAsync(batch => batch.Id == seed.CleaningBatchId));
    }

    [Fact]
    public async Task DeleteDatasetAsync_ReturnsFalse_WhenDatasetDoesNotExist()
    {
        await using var context = NewContext();
        var service = BuildService(context);

        var deleted = await service.DeleteDatasetAsync(12345, CancellationToken.None);

        Assert.False(deleted);
    }

    [Fact]
    public async Task ReplaceDatasetAsync_SwapsContent_ResetsAnalysisStatus_AndClearsStaleSuggestions()
    {
        await using var context = NewContext();
        var seed = await SeedProjectWithTwoDatasetsAndHistoryAsync(context);
        var service = BuildService(context);

        var newCsv = "id,name\n1,Alpha\n2,Beta\n3,Gamma\n";
        var request = new DatasetUploadDto { File = BuildCsvFile(newCsv, "replacement.csv") };

        var response = await service.ReplaceDatasetAsync(seed.DatasetToDeleteId, request, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(3, response!.RowCount);
        Assert.Equal(2, response.ColumnCount);
        Assert.Equal("Imported", response.Status);

        var reloaded = await context.Datasets
            .Include(dataset => dataset.Columns)
            .Include(dataset => dataset.Rows)
            .Include(dataset => dataset.Versions)
            .FirstAsync(dataset => dataset.Id == seed.DatasetToDeleteId);

        Assert.Equal(3, reloaded.Rows.Count);
        Assert.Equal(2, reloaded.Columns.Count);
        Assert.Empty(reloaded.Versions);
        Assert.Null(reloaded.ActiveVersionId);
        Assert.Null(reloaded.AnalyzedAt);
        Assert.Null(reloaded.AnalysisResultJson);

        // Suggestions/cleaning history referencing the old content must not survive a content replace.
        Assert.False(await context.CleaningOperations.AnyAsync(operation => operation.DatasetId == seed.DatasetToDeleteId));
        Assert.False(await context.RelationshipSuggestions.AnyAsync(suggestion =>
            suggestion.SourceDatasetId == seed.DatasetToDeleteId || suggestion.TargetDatasetId == seed.DatasetToDeleteId));
    }

    [Fact]
    public async Task GetDatasetPreviewAsync_ReturnsTypedValuesFromActiveCleaningVersion()
    {
        await using var context = NewContext();
        var seed = await SeedProjectWithTwoDatasetsAndHistoryAsync(context);
        var dataset = await context.Datasets.FirstAsync(item => item.Id == seed.DatasetToDeleteId);
        var version = await context.DatasetVersions.FirstAsync(item => item.Id == dataset.ActiveVersionId);
        version.ColumnsJson = """
            [{"name":"score","dataType":"decimal"},{"name":"enabled","dataType":"boolean"},{"name":"note","dataType":"string"}]
            """;
        version.RowsJson = """
            [{"score":42.5,"enabled":true,"note":null}]
            """;
        version.RowCount = 1;
        version.ColumnCount = 3;
        await context.SaveChangesAsync();

        var preview = await BuildService(context).GetDatasetPreviewAsync(dataset.Id, CancellationToken.None);
        var row = Assert.Single(preview.Rows);

        Assert.Equal(42.5m, Assert.IsType<decimal>(row["score"]));
        Assert.True(Assert.IsType<bool>(row["enabled"]));
        Assert.Null(row["note"]);
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DatasetImportService BuildService(ForgeDbContext context)
    {
        var datasetRepository = new DatasetRepository(context);
        var pythonClient = new PythonAnalysisClient(new HttpClient { BaseAddress = new Uri("http://localhost:8002") });
        return new DatasetImportService(datasetRepository, pythonClient, NullLogger<DatasetImportService>.Instance);
    }

    private static IFormFile BuildCsvFile(string csv, string fileName)
    {
        var bytes = Encoding.UTF8.GetBytes(csv);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName) { Headers = new HeaderDictionary(), ContentType = "text/csv" };
    }

    private sealed record SeedResult(int DatasetToDeleteId, int OtherDatasetId, int CleaningBatchId);

    private static async Task<SeedResult> SeedProjectWithTwoDatasetsAndHistoryAsync(ForgeDbContext context)
    {
        var user = new User { FirstName = "Test", LastName = "User", Email = "owner@example.com", PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow };
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var project = new Project { UserId = user.Id, Name = "Test project", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();

        var datasetToDelete = new Dataset
        {
            ProjectId = project.Id,
            TableName = "customers",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 2,
            ColumnCount = 1,
            CreatedAt = DateTime.UtcNow,
            AnalyzedAt = DateTime.UtcNow,
            AnalysisResultJson = "{}",
            Columns = [new DatasetColumn { ColumnName = "id", DetectedDataType = "integer" }],
            Rows =
            [
                new DatasetRow { RowNumber = 1, RowData = "{\"id\":\"1\"}", CreatedAt = DateTime.UtcNow },
                new DatasetRow { RowNumber = 2, RowData = "{\"id\":\"2\"}", CreatedAt = DateTime.UtcNow },
            ]
        };
        var otherDataset = new Dataset
        {
            ProjectId = project.Id,
            TableName = "orders",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 1,
            ColumnCount = 1,
            CreatedAt = DateTime.UtcNow,
        };
        context.Datasets.AddRange(datasetToDelete, otherDataset);
        await context.SaveChangesAsync();

        var version = new DatasetVersion
        {
            DatasetId = datasetToDelete.Id,
            CreatedByUserId = user.Id,
            VersionNumber = 1,
            IsRawOriginal = true,
            IsActive = true,
            RowCount = 2,
            ColumnCount = 1,
            OperationSummary = "Raw import",
            CreatedAt = DateTime.UtcNow,
        };
        context.DatasetVersions.Add(version);
        await context.SaveChangesAsync();

        datasetToDelete.ActiveVersionId = version.Id;
        await context.SaveChangesAsync();

        var batch = new CleaningBatch
        {
            CorrelationId = Guid.NewGuid(),
            ProjectId = project.Id,
            CreatedByUserId = user.Id,
            Name = "Fix all recommended",
            Status = "Completed",
            OperationCount = 1,
            CreatedAt = DateTime.UtcNow,
        };
        context.CleaningBatches.Add(batch);
        await context.SaveChangesAsync();

        context.CleaningOperations.Add(new CleaningOperation
        {
            CleaningBatchId = batch.Id,
            DatasetId = datasetToDelete.Id,
            SourceVersionId = version.Id,
            Order = 1,
            OperationType = "fill_missing",
            ParametersJson = "{}",
            Status = "Completed",
            CreatedAt = DateTime.UtcNow,
        });

        context.RelationshipSuggestions.Add(new RelationshipSuggestion
        {
            ProjectId = project.Id,
            SourceDatasetId = datasetToDelete.Id,
            SourceColumnName = "id",
            TargetDatasetId = otherDataset.Id,
            TargetColumnName = "customer_id",
            Score = 0.9,
            Status = RelationshipSuggestionStatus.Suggested,
            CreatedAt = DateTime.UtcNow,
        });
        await context.SaveChangesAsync();

        return new SeedResult(datasetToDelete.Id, otherDataset.Id, batch.Id);
    }
}
