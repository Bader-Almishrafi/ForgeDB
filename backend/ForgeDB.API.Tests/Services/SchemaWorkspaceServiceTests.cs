using System.Text.Json;
using System.Reflection;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Interfaces;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ForgeDB.API.Tests.Services;

public class SchemaWorkspaceServiceTests
{
    [Fact]
    public async Task GenerateSchema_CreatesExactlyOneTablePerConfirmedDatasetVersion_RegardlessOfSourceType()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);

        var result = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);

        Assert.Equal(3, result.Tables.Count);
        Assert.All(result.Tables, table => Assert.NotNull(table.SourceDatasetVersionId));
        Assert.Contains(result.Tables, table => table.SourceName == "external-api");
        Assert.All(result.Tables.SelectMany(table => table.Columns), column =>
        {
            Assert.False(column.IsPrimaryKey);
            Assert.False(column.IsUnique);
            Assert.False(column.IsAutoIncrement);
            Assert.Null(column.DefaultValue);
        });
        Assert.Equal(DesignStatus.Draft, result.Status);
        Assert.Equal(3, result.SourceVersions.Count);
    }

    [Fact]
    public async Task GenerateSchema_UsesConfirmedActiveVersionTwo()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var dataset = await context.Datasets
            .Include(item => item.ActiveVersion)
            .SingleAsync(item => item.ProjectId == seed.ProjectId && item.SourceType == "api");
        var versionOne = dataset.ActiveVersion!;
        versionOne.IsActive = false;
        await context.SaveChangesAsync();
        var versionTwo = new DatasetVersion
        {
            DatasetId = dataset.Id,
            ParentVersionId = versionOne.Id,
            CreatedByUserId = seed.UserId,
            VersionNumber = 2,
            IsActive = true,
            ColumnsJson = versionOne.ColumnsJson,
            RowsJson = versionOne.RowsJson,
            RowCount = versionOne.RowCount,
            ColumnCount = versionOne.ColumnCount,
            AnalysisResultJson = versionOne.AnalysisResultJson,
            AnalyzedAt = DateTime.UtcNow,
            OperationSummary = "cleaned",
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(versionTwo);
        await context.SaveChangesAsync();
        dataset.ActiveVersionId = versionTwo.Id;
        var state = await context.ProjectCleaningStates.SingleAsync(item => item.ProjectId == seed.ProjectId);
        var confirmed = JsonSerializer.Deserialize<Dictionary<int, int>>(state.ConfirmedVersionsJson!)!;
        confirmed[dataset.Id] = versionTwo.Id;
        state.ConfirmedVersionsJson = JsonSerializer.Serialize(confirmed);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var generated = await BuildService(context).GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);

        Assert.Equal(versionTwo.Id, generated.Tables.Single(table => table.SourceDatasetId == dataset.Id).SourceDatasetVersionId);
    }

    [Fact]
    public async Task SaveDraft_PersistsWhitelistedColumnProperties()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var table = generated.Tables[0];
        var column = table.Columns[0];

        var saved = await service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Tables = [new() { Id = table.Id, Name = "customer_records" }],
            Columns = [new()
            {
                Id = column.Id, Name = "record_id", DataType = "BIGINT", IsNullable = false,
                IsPrimaryKey = true, IsUnique = true, DefaultValue = null, IsAutoIncrement = true
            }]
        });

        var savedTable = saved.Tables.Single(item => item.Id == table.Id);
        var savedColumn = savedTable.Columns.Single(item => item.Id == column.Id);
        Assert.Equal("customer_records", savedTable.Name);
        Assert.Equal("record_id", savedColumn.Name);
        Assert.Equal("BIGINT", savedColumn.SqlType);
        Assert.True(savedColumn.IsPrimaryKey);
        Assert.False(savedColumn.IsUnique); // PK uniqueness is implied, never duplicated.
        Assert.False(savedColumn.IsNullable);
        Assert.True(savedColumn.IsAutoIncrement);
        Assert.Null(savedColumn.DefaultValue);
        Assert.Equal(DesignStatus.Draft, saved.Status);
    }

    [Theory]
    [InlineData("select")]
    [InlineData("bad-name")]
    [InlineData("2customers")]
    [InlineData("")]
    [InlineData("authorization")]
    [InlineData("isnull")]
    [InlineData("freeze")]
    [InlineData("collation")]
    public async Task SaveDraftNames_RejectsInvalidIdentifiers(string invalidName)
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);

        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Tables = [new() { Id = generated.Tables[0].Id, Name = invalidName }]
        }));
    }

    [Fact]
    public async Task SaveDraftNames_RejectsDuplicateNamesCaseInsensitively()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);

        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Tables = generated.Tables.Select(table => new DesignTableRenameDto { Id = table.Id, Name = "same_name" }).ToList()
        }));
    }

    [Fact]
    public async Task SaveDraftNames_RejectsUnsupportedMassAssignmentFields()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);

        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            UnsupportedFields = new() { ["status"] = JsonDocument.Parse("\"Valid\"").RootElement.Clone() }
        }));
    }

    [Fact]
    public async Task SaveDraft_PersistsNullableUniqueTypeAndSafeDefault()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var column = generated.Tables[0].Columns[1];

        var saved = await service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns = [new()
            {
                Id = column.Id, Name = column.Name, DataType = "VARCHAR(100)", IsNullable = true,
                IsPrimaryKey = false, IsUnique = true, DefaultValue = "'unknown'", IsAutoIncrement = false
            }]
        });

        var persisted = saved.Tables.SelectMany(table => table.Columns).Single(item => item.Id == column.Id);
        Assert.Equal("VARCHAR(100)", persisted.SqlType);
        Assert.True(persisted.IsNullable);
        Assert.True(persisted.IsUnique);
        Assert.Equal("'unknown'", persisted.DefaultValue);
        Assert.False(persisted.IsAutoIncrement);
    }

    [Fact]
    public async Task SaveDraft_ArbitraryVarcharLength_PersistsAcrossReloadAndRendersInSqlPreview()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var column = generated.Tables[0].Columns[1];

        await service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns = [new() { Id = column.Id, Name = column.Name, DataType = "varchar(42)", IsNullable = true }]
        });

        var reloaded = await service.GetSchemaWorkspaceAsync(seed.ProjectId)
            ?? throw new InvalidOperationException("Schema workspace should exist after save.");
        var persisted = reloaded.Tables.SelectMany(table => table.Columns).Single(item => item.Id == column.Id);
        Assert.Equal("VARCHAR(42)", persisted.SqlType);

        var sql = (await service.GetSchemaSqlAsync(seed.ProjectId)).Sql;
        Assert.Contains($"{persisted.Name} VARCHAR(42)", sql);
    }

    [Fact]
    public async Task SaveDraft_RejectsNullablePrimaryKey()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var column = generated.Tables[0].Columns[0];

        var error = await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns = [new() { Id = column.Id, Name = column.Name, DataType = "INTEGER", IsNullable = true, IsPrimaryKey = true }]
        }));
        Assert.Contains("cannot be nullable", error.Message);
    }

    [Fact]
    public async Task SaveDraft_RejectsUnsafeDefaultAndIdentityOnUnsupportedType()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var column = generated.Tables[0].Columns[1];

        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns = [new() { Id = column.Id, Name = column.Name, DataType = "TEXT", IsNullable = false, DefaultValue = "now(); DROP TABLE users;" }]
        }));
        await Assert.ThrowsAsync<ArgumentException>(() => service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns = [new() { Id = column.Id, Name = column.Name, DataType = "UUID", IsNullable = false, IsAutoIncrement = true }]
        }));
    }

    [Fact]
    public async Task SqlPreview_RendersCompositePkUniqueDefaultIdentityAndNotNullWithoutRedundancy()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var table = generated.Tables[0];
        var first = table.Columns[0];
        var second = table.Columns[1];

        await service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Columns =
            [
                new() { Id = first.Id, Name = first.Name, DataType = "INTEGER", IsNullable = false, IsPrimaryKey = true, IsUnique = true, IsAutoIncrement = true },
                new() { Id = second.Id, Name = second.Name, DataType = "TEXT", IsNullable = false, IsPrimaryKey = true, IsUnique = true }
            ]
        });

        var sql = (await service.GetSchemaSqlAsync(seed.ProjectId)).Sql;
        Assert.Contains("id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL", sql);
        Assert.Contains("name TEXT NOT NULL", sql);
        Assert.Contains("PRIMARY KEY (id, name)", sql);
        Assert.DoesNotContain("id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL UNIQUE", sql);
        Assert.DoesNotContain("name TEXT NOT NULL UNIQUE", sql);
    }

    [Fact]
    public async Task ValidateSchema_WarningsDoNotBlockContinuationAndSqlUsesSavedNames()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var renamed = await service.SaveSchemaDraftAsync(seed.ProjectId, seed.UserId, generated.Revision, new SaveDesignDraftRequestDto
        {
            Tables = [new() { Id = generated.Tables[0].Id, Name = "renamed_customers" }]
        });

        var validated = await service.ValidateSchemaAsync(seed.ProjectId, seed.UserId, renamed.Revision);
        var sql = await service.GetSchemaSqlAsync(seed.ProjectId);

        Assert.Equal(DesignStatus.Valid, validated.Status);
        Assert.True(validated.CanContinue);
        Assert.Contains(validated.ValidationIssues, issue => issue.Severity == ValidationSeverity.Warning);
        Assert.DoesNotContain(validated.ValidationIssues, issue => issue.Severity == ValidationSeverity.Error);
        Assert.Contains("CREATE TABLE renamed_customers", sql.Sql);
    }

    [Fact]
    public async Task ValidateSchema_ActiveVersionChangeMarksSchemaStaleAndInvalid()
    {
        await using var context = NewContext();
        var seed = await SeedConfirmedProjectAsync(context);
        var service = BuildService(context);
        var generated = await service.GenerateSchemaAsync(seed.ProjectId, seed.UserId, null);
        var dataset = await context.Datasets.Include(item => item.ActiveVersion).FirstAsync(item => item.ProjectId == seed.ProjectId && item.SourceType == "csv");
        var replacement = new DatasetVersion
        {
            DatasetId = dataset.Id, CreatedByUserId = seed.UserId, VersionNumber = 2, IsActive = true,
            RowsJson = dataset.ActiveVersion!.RowsJson, ColumnsJson = dataset.ActiveVersion.ColumnsJson,
            RowCount = dataset.RowCount, ColumnCount = dataset.ColumnCount, OperationSummary = "changed",
            AnalyzedAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow
        };
        dataset.ActiveVersion!.IsActive = false;
        context.DatasetVersions.Add(replacement);
        await context.SaveChangesAsync();
        dataset.ActiveVersionId = replacement.Id;
        await context.SaveChangesAsync();

        var validated = await service.ValidateSchemaAsync(seed.ProjectId, seed.UserId, generated.Revision);

        Assert.Equal(DesignStatus.Invalid, validated.Status);
        Assert.True(validated.IsStale);
        Assert.False(validated.CanContinue);
        Assert.Contains(validated.ValidationIssues, issue => issue.Code == "stale-cleaned-versions" && issue.Severity == ValidationSeverity.Error);
        var exportBlocked = await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => service.PrepareExportArtifactsAsync(seed.ProjectId));
        Assert.Contains("analysis_stale", exportBlocked.BlockerCodes);
        Assert.Contains("schema_stale", exportBlocked.BlockerCodes);
        var relationshipService = DispatchProxy.Create<IRelationshipDetectionService, TestInterfaceProxy<IRelationshipDetectionService>>();
        var projectService = new ProjectService(
            new ProjectRepository(context),
            service,
            relationshipService,
            new CleaningRepository(context));
        await Assert.ThrowsAsync<ProjectWorkflowBlockedException>(() => projectService.GetProjectExportPackageAsync(seed.ProjectId));
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DesignService BuildService(ForgeDbContext context)
    {
        var resolver = new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]);
        return new DesignService(
            new DesignRepository(context),
            new DatasetRepository(context),
            resolver,
            new DesignValidationService(),
            new CleaningRepository(context),
            new ProjectWorkflowService(context));
    }

    private static async Task<(int UserId, int ProjectId)> SeedConfirmedProjectAsync(ForgeDbContext context)
    {
        var user = new User { FirstName = "Schema", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com", PasswordHash = "x", Role = "User", CreatedAt = DateTime.UtcNow };
        var project = new Project { Name = "Confirmed CSV project", User = user, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();

        var datasets = new[]
        {
            NewDataset(project.Id, "customers", "customers.csv", "csv", [("id", "integer"), ("name", "string")]),
            NewDataset(project.Id, "orders", "orders.csv", "csv", [("id", "integer"), ("customer_id", "integer")]),
            NewDataset(project.Id, "external", "external-api", "api", [("id", "integer")])
        };
        context.Datasets.AddRange(datasets);
        await context.SaveChangesAsync();

        var confirmed = new Dictionary<int, int>();
        foreach (var dataset in datasets)
        {
            var columnsJson = JsonSerializer.Serialize(dataset.Columns.OrderBy(column => column.Id).Select(column => new { name = column.ColumnName, dataType = column.DetectedDataType }));
            var version = new DatasetVersion
            {
                DatasetId = dataset.Id, CreatedByUserId = user.Id, VersionNumber = 1, IsRawOriginal = true, IsActive = true,
                RowsJson = "[]", ColumnsJson = columnsJson, RowCount = 3, ColumnCount = dataset.Columns.Count,
                OperationSummary = "confirmed",
                AnalysisResultJson = JsonSerializer.Serialize(new
                {
                    columns = dataset.Columns.Select(column => new
                    {
                        columnName = column.ColumnName,
                        uniqueValuesCount = column.UniqueValuesCount,
                        isNullable = column.IsNullable
                    })
                }),
                AnalyzedAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow
            };
            context.DatasetVersions.Add(version);
            await context.SaveChangesAsync();
            dataset.ActiveVersionId = version.Id;
            confirmed[dataset.Id] = version.Id;
        }
        context.ProjectCleaningStates.Add(new ProjectCleaningState
        {
            ProjectId = project.Id, QualityConfirmedAt = DateTime.UtcNow, QualityConfirmedByUserId = user.Id,
            ConfirmedVersionsJson = JsonSerializer.Serialize(confirmed), UpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        return (user.Id, project.Id);
    }

    private static Dataset NewDataset(int projectId, string name, string sourceName, string sourceType, (string Name, string Type)[] columns)
    {
        return new Dataset
        {
            ProjectId = projectId, TableName = name, SourceName = sourceName, SourceType = sourceType,
            Status = "Analyzed", RowCount = 3, ColumnCount = columns.Length, CreatedAt = DateTime.UtcNow, AnalyzedAt = DateTime.UtcNow,
            Columns = columns.Select((column, index) => new DatasetColumn
            {
                ColumnName = column.Name, DetectedDataType = column.Type, IsNullable = false,
                UniqueValuesCount = column.Name == "id" ? 3 : 2
            }).ToList()
        };
    }
}
