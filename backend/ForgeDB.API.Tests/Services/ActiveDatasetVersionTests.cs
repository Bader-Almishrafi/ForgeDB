using System.Text;
using System.Text.Json;
using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ForgeDB.API.Tests.Services;

public class ActiveDatasetVersionTests
{
    [Fact]
    public async Task CsvImport_CreatesActiveVersionOne_AndAnalysisPersistsAgainstIt()
    {
        await using var context = NewContext();
        var projectId = await SeedProjectAsync(context);
        var service = BuildService(context);

        var imported = await service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = CsvFile("id,name\n1,Alpha\n2,Beta\n", "customers.csv")
        });

        var dataset = await context.Datasets
            .Include(item => item.Versions)
            .Include(item => item.ActiveVersion)
            .SingleAsync(item => item.Id == imported.Id);
        var version = Assert.Single(dataset.Versions);
        Assert.Equal(1, version.VersionNumber);
        Assert.True(version.IsRawOriginal);
        Assert.True(version.IsActive);
        Assert.Equal(version.Id, dataset.ActiveVersionId);

        context.ChangeTracker.Clear();
        var analysis = await service.AnalyzeDatasetAsync(dataset.Id, new DatasetAnalysisRequestDto());

        Assert.Equal(dataset.Id, analysis.DatasetId);
        Assert.Equal(version.Id, analysis.DatasetVersionId);
        Assert.Equal(1, analysis.DatasetVersionNumber);
        Assert.False(analysis.IsCleanedVersion);
        Assert.NotNull(analysis.AnalyzedAt);
        var stored = await context.DatasetVersions.SingleAsync(item => item.Id == version.Id);
        Assert.NotNull(stored.AnalysisResultJson);
        Assert.NotNull(stored.AnalyzedAt);
        using var storedJson = JsonDocument.Parse(stored.AnalysisResultJson);
        Assert.Equal(dataset.Id, storedJson.RootElement.GetProperty("datasetId").GetInt32());
        Assert.Equal(version.Id, storedJson.RootElement.GetProperty("datasetVersionId").GetInt32());
        Assert.Equal(1, storedJson.RootElement.GetProperty("datasetVersionNumber").GetInt32());
        Assert.Equal(JsonValueKind.String, storedJson.RootElement.GetProperty("analyzedAt").ValueKind);
        Assert.False(storedJson.RootElement.GetProperty("isCleanedVersion").GetBoolean());
    }

    [Fact]
    public async Task ReanalysisAndPreview_ReadVersionTwoAfterActivePointerChanges()
    {
        await using var context = NewContext();
        var projectId = await SeedProjectAsync(context);
        var service = BuildService(context);
        var imported = await service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = CsvFile("id,name\n1,raw\n", "customers.csv")
        });
        var firstAnalysis = await service.AnalyzeDatasetAsync(imported.Id, new DatasetAnalysisRequestDto());
        var dataset = await context.Datasets.Include(item => item.Versions).SingleAsync(item => item.Id == imported.Id);
        var versionOne = dataset.Versions.Single();
        versionOne.IsActive = false;
        await context.SaveChangesAsync();

        var versionTwo = new DatasetVersion
        {
            DatasetId = dataset.Id,
            ParentVersionId = versionOne.Id,
            CreatedByUserId = await context.Projects.Where(item => item.Id == projectId).Select(item => item.UserId).SingleAsync(),
            VersionNumber = 2,
            IsRawOriginal = false,
            IsActive = true,
            RowsJson = "[{\"id\":2,\"name\":\"cleaned\"}]",
            ColumnsJson = "[{\"name\":\"id\",\"dataType\":\"integer\"},{\"name\":\"name\",\"dataType\":\"string\"}]",
            RowCount = 1,
            ColumnCount = 2,
            OperationSummary = "Cleaned",
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(versionTwo);
        await context.SaveChangesAsync();
        dataset.ActiveVersionId = versionTwo.Id;
        dataset.Status = "Cleaned - Analysis Required";
        dataset.AnalysisResultJson = null;
        dataset.AnalyzedAt = null;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var preview = await service.GetDatasetPreviewAsync(dataset.Id);
        Assert.Equal("cleaned", preview.Rows.Single()["name"]);

        var secondAnalysis = await service.AnalyzeDatasetAsync(dataset.Id, new DatasetAnalysisRequestDto());
        Assert.Equal(versionTwo.Id, secondAnalysis.DatasetVersionId);
        Assert.Equal(2, secondAnalysis.DatasetVersionNumber);
        Assert.True(secondAnalysis.IsCleanedVersion);
        Assert.Equal(1, secondAnalysis.AnalysisResult.RowCount);

        var versions = await context.DatasetVersions.OrderBy(item => item.VersionNumber).ToListAsync();
        Assert.False(versions[0].IsActive);
        Assert.NotNull(versions[0].AnalysisResultJson);
        Assert.True(versions[1].IsActive);
        Assert.NotNull(versions[1].AnalysisResultJson);
        Assert.NotEqual(firstAnalysis.DatasetVersionId, secondAnalysis.DatasetVersionId);
    }

    [Fact]
    public async Task AnalysisPersistenceRejectsAnExpectedVersionThatIsNoLongerActive()
    {
        await using var context = NewContext();
        var projectId = await SeedProjectAsync(context);
        var service = BuildService(context);
        var imported = await service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = CsvFile("id\n1\n", "values.csv")
        });
        var dataset = await context.Datasets.Include(item => item.Versions).SingleAsync(item => item.Id == imported.Id);
        var versionOne = dataset.Versions.Single();
        versionOne.IsActive = false;
        await context.SaveChangesAsync();
        var versionTwo = new DatasetVersion
        {
            DatasetId = dataset.Id,
            ParentVersionId = versionOne.Id,
            CreatedByUserId = await context.Projects.Where(item => item.Id == projectId).Select(item => item.UserId).SingleAsync(),
            VersionNumber = 2,
            IsActive = true,
            RowsJson = versionOne.RowsJson,
            ColumnsJson = versionOne.ColumnsJson,
            RowCount = versionOne.RowCount,
            ColumnCount = versionOne.ColumnCount,
            OperationSummary = "Concurrent clean",
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(versionTwo);
        await context.SaveChangesAsync();
        dataset.ActiveVersionId = versionTwo.Id;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var saved = await new DatasetRepository(context).SaveAnalysisResultAsync(
            dataset.Id,
            versionOne.Id,
            "{\"rowCount\":1}",
            0,
            0,
            DateTime.UtcNow);

        Assert.False(saved);
        Assert.Null((await context.Datasets.SingleAsync(item => item.Id == dataset.Id)).AnalysisResultJson);
        Assert.Null((await context.DatasetVersions.SingleAsync(item => item.Id == versionTwo.Id)).AnalysisResultJson);
    }

    [Fact]
    public async Task ActiveVersionChangeDuringAnalysisPreventsPersistence()
    {
        await using var context = NewContext();
        var projectId = await SeedProjectAsync(context);
        var python = new FailingPythonClient();
        var service = BuildService(context, python);
        var imported = await service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = CsvFile("id,name\n1,raw\n", "customers.csv")
        });
        var dataset = await context.Datasets.Include(item => item.Versions).SingleAsync(item => item.Id == imported.Id);
        var versionOne = dataset.Versions.Single();
        var versionTwo = new DatasetVersion
        {
            DatasetId = dataset.Id,
            ParentVersionId = versionOne.Id,
            CreatedByUserId = await context.Projects.Where(item => item.Id == projectId).Select(item => item.UserId).SingleAsync(),
            VersionNumber = 2,
            IsActive = false,
            RowsJson = "[{\"id\":2,\"name\":\"cleaned\"}]",
            ColumnsJson = versionOne.ColumnsJson,
            RowCount = 1,
            ColumnCount = versionOne.ColumnCount,
            OperationSummary = "Concurrent clean",
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(versionTwo);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        python.DuringAnalysis = async () =>
        {
            var changingDataset = await context.Datasets.Include(item => item.Versions).SingleAsync(item => item.Id == imported.Id);
            foreach (var version in changingDataset.Versions) version.IsActive = version.Id == versionTwo.Id;
            changingDataset.ActiveVersionId = versionTwo.Id;
            changingDataset.AnalysisResultJson = null;
            changingDataset.AnalyzedAt = null;
            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();
        };

        await Assert.ThrowsAsync<ActiveDatasetVersionChangedException>(() =>
            service.AnalyzeDatasetAsync(imported.Id, new DatasetAnalysisRequestDto()));

        Assert.Null((await context.Datasets.SingleAsync(item => item.Id == imported.Id)).AnalysisResultJson);
        Assert.Null((await context.DatasetVersions.SingleAsync(item => item.Id == versionTwo.Id)).AnalysisResultJson);
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DatasetImportService BuildService(ForgeDbContext context, FailingPythonClient? python = null) => new(
        new DatasetRepository(context),
        python ?? new FailingPythonClient(),
        NullLogger<DatasetImportService>.Instance);

    private static async Task<int> SeedProjectAsync(ForgeDbContext context)
    {
        var user = new User
        {
            FirstName = "Version",
            LastName = "Owner",
            Email = $"{Guid.NewGuid()}@example.com",
            PasswordHash = "x",
            Role = "User",
            CreatedAt = DateTime.UtcNow
        };
        var project = new Project { Name = "Version project", User = user, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return project.Id;
    }

    private static IFormFile CsvFile(string content, string fileName)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = "text/csv"
        };
    }

    private sealed class FailingPythonClient : IPythonAnalysisClient
    {
        public Func<Task>? DuringAnalysis { get; set; }

        public async Task<PythonAnalysisResponseDto> AnalyzeDatasetAsync(PythonAnalysisRequestDto request, CancellationToken cancellationToken = default)
        {
            if (DuringAnalysis is not null) await DuringAnalysis();
            throw new HttpRequestException("Use the deterministic .NET fallback.");
        }

        public Task<PythonCleaningResponseDto> PreviewCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PythonCleaningResponseDto> ApplyCleaningAsync(PythonCleaningRequestDto request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
