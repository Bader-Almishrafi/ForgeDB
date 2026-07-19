using System.Text;
using System.Text.Json;
using ForgeDB.API.Clients;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Importing;
using ForgeDB.API.Tests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ForgeDB.API.Tests.Services;

public class ExcelImportTests
{
    [Fact]
    public async Task PreviewExcel_DetectsNonEmptyWorksheets_AndRequiresSelectionForMultipleSheets()
    {
        var service = await BuildServiceAsync();
        var workbook = ExcelTestWorkbookFactory.Create(
            ("Empty", []),
            ("Customers", [["id", "name"], ["1", "Ahmed"]]),
            ("Orders", [["id", "total"], ["10", "25.5"]]));

        var preview = await service.PreviewExcelAsync(new ExcelPreviewRequestDto { File = workbook });

        Assert.Equal(["Customers", "Orders"], preview.Worksheets);
        Assert.Null(preview.SelectedWorksheet);
        Assert.Empty(preview.Rows);
    }

    [Fact]
    public async Task PreviewExcel_SelectsOnlyNonEmptySheet_AndNormalizesEmptyAndDuplicateHeaders()
    {
        var service = await BuildServiceAsync();
        var workbook = ExcelTestWorkbookFactory.Create(
            ("Data", [["id", null, "ID"], ["1", null, "2"], ["3", "value", null]]));

        var preview = await service.PreviewExcelAsync(new ExcelPreviewRequestDto { File = workbook });

        Assert.Equal("Data", preview.SelectedWorksheet);
        Assert.Equal(["id", "column_2", "ID_2"], preview.Columns);
        Assert.Equal(2, preview.RowCount);
        Assert.Null(preview.Rows[0]["column_2"]);
        Assert.Null(preview.Rows[1]["ID_2"]);
    }

    [Fact]
    public async Task PreviewExcel_UsesRequestedWorksheet()
    {
        var service = await BuildServiceAsync();
        var workbook = ExcelTestWorkbookFactory.Create(
            ("Customers", [["id"], ["1"]]),
            ("Orders", [["order_id", "total"], ["9", "12.5"], ["10", null]]));

        var preview = await service.PreviewExcelAsync(new ExcelPreviewRequestDto { File = workbook, WorksheetName = "Orders" });

        Assert.Equal("Orders", preview.SelectedWorksheet);
        Assert.Equal(2, preview.RowCount);
        Assert.Equal(2, preview.ColumnCount);
        Assert.Null(preview.Rows[1]["total"]);
    }

    [Fact]
    public async Task PreviewExcel_RejectsCorruptedAndEmptyWorkbooks()
    {
        var service = await BuildServiceAsync();
        var corruptedBytes = Encoding.UTF8.GetBytes("not an xlsx archive");
        var corrupted = new FormFile(new MemoryStream(corruptedBytes), 0, corruptedBytes.Length, "file", "broken.xlsx");

        var corruptError = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.PreviewExcelAsync(new ExcelPreviewRequestDto { File = corrupted }));
        Assert.Contains("corrupted", corruptError.Message, StringComparison.OrdinalIgnoreCase);

        var empty = ExcelTestWorkbookFactory.Create(("Empty", []));
        var emptyError = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.PreviewExcelAsync(new ExcelPreviewRequestDto { File = empty }));
        Assert.Contains("non-empty worksheet", emptyError.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UploadExcel_PersistsSelectedSheetThroughSharedDatasetModel()
    {
        await using var context = NewContext();
        var service = await BuildServiceAsync(context);
        var projectId = await SeedProjectAsync(context);
        var workbook = ExcelTestWorkbookFactory.Create(
            ("Customers", [["id", "name", "email"], ["1", "Ahmed", null], ["2", "Sara", "sara@example.com"]]),
            ("Ignored", [["code"], ["x"]]));

        var response = await service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = workbook,
            SourceType = "excel",
            WorksheetName = "Customers",
            SourceName = "customers.xlsx",
            TableName = "customers"
        });

        Assert.Equal("excel", response.SourceType);
        Assert.Equal(2, response.RowCount);
        Assert.Equal(3, response.ColumnCount);
        Assert.Contains("Customers", response.SourceName);

        var persisted = await context.Datasets
            .Include(item => item.Columns)
            .Include(item => item.Rows)
            .Include(item => item.Versions)
            .Include(item => item.ActiveVersion)
            .SingleAsync();
        Assert.Equal("excel", persisted.SourceType);
        Assert.Equal(2, persisted.Rows.Count);
        Assert.Equal(3, persisted.Columns.Count);
        var version = Assert.Single(persisted.Versions);
        Assert.Equal(1, version.VersionNumber);
        Assert.True(version.IsActive);
        Assert.True(version.IsRawOriginal);
        Assert.Equal(version.Id, persisted.ActiveVersionId);
        var first = JsonSerializer.Deserialize<Dictionary<string, string?>>(persisted.Rows.OrderBy(row => row.RowNumber).First().RowData)!;
        Assert.Null(first["email"]);
    }

    [Fact]
    public async Task UploadExcel_RejectsImportWithoutWorksheetSelection_WhenWorkbookHasMultipleSheets()
    {
        await using var context = NewContext();
        var service = await BuildServiceAsync(context);
        var projectId = await SeedProjectAsync(context);
        var workbook = ExcelTestWorkbookFactory.Create(
            ("One", [["id"], ["1"]]),
            ("Two", [["id"], ["2"]]));

        var error = await Assert.ThrowsAsync<ArgumentException>(() => service.UploadDatasetAsync(projectId, new DatasetUploadDto
        {
            File = workbook,
            SourceType = "excel"
        }));

        Assert.Contains("Select", error.Message);
        Assert.Empty(context.Datasets);
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<DatasetImportService> BuildServiceAsync(ForgeDbContext? existingContext = null)
    {
        var context = existingContext ?? NewContext();
        if (existingContext is null)
        {
            await SeedProjectAsync(context);
        }
        var repository = new DatasetRepository(context);
        var python = new PythonAnalysisClient(new HttpClient { BaseAddress = new Uri("http://localhost:8002") });
        return new DatasetImportService(repository, python, NullLogger<DatasetImportService>.Instance, new ExcelWorkbookReader());
    }

    private static async Task<int> SeedProjectAsync(ForgeDbContext context)
    {
        var user = new User { FirstName = "Excel", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com", PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow };
        var project = new Project { Name = "Excel project", User = user, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return project.Id;
    }
}
