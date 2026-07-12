using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ForgeDB.API.Tests.Services;

/// <summary>
/// The generic /design-tables and /design-columns CRUD endpoints (used by the ER-diagram editor,
/// distinct from the newer /schema/draft whitelist path) used to accept any non-blank Name/SqlType
/// string and write it straight into DesignColumn.SqlType, which the SQL generator then emits
/// unescaped. That let an authenticated project owner inject arbitrary text into generated SQL/DBML
/// output through a route that bypassed SchemaColumnRules/SqlIdentifiers entirely. These tests prove
/// CreateColumnAsync/UpdateColumnAsync/CreateTableAsync/UpdateTableAsync now enforce the same rules
/// as SaveSchemaDraftAsync.
/// </summary>
public class DesignServiceLegacyColumnValidationTests
{
    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static DesignService BuildService(ForgeDbContext context) => new(
        new DesignRepository(context),
        new DatasetRepository(context),
        new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
        new DesignValidationService());

    private static async Task<(DesignService Service, DesignResponseDto Design)> SeedGeneratedDesignAsync(ForgeDbContext context)
    {
        var project = new Project { Name = "Demo", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        var dataset = new Dataset
        {
            Project = project,
            TableName = "people",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 2,
            ColumnCount = 1,
            CreatedAt = DateTime.UtcNow,
            Columns = new List<DatasetColumn> { new() { ColumnName = "id", DetectedDataType = "integer", IsNullable = false, UniqueValuesCount = 2 } }
        };
        context.Datasets.Add(dataset);
        await context.SaveChangesAsync();

        var service = BuildService(context);
        var design = await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);
        return (service, design);
    }

    [Fact]
    public async Task CreateColumnAsync_RejectsInjectionStyleSqlType()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var table = design.Tables[0];

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateColumnAsync(table.Id, design.Revision, new CreateDesignColumnRequestDto
        {
            Name = "evil",
            SqlType = "TEXT); DROP TABLE design_models; --"
        }, CancellationToken.None));
    }

    [Fact]
    public async Task CreateColumnAsync_RejectsInvalidIdentifierName()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var table = design.Tables[0];

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateColumnAsync(table.Id, design.Revision, new CreateDesignColumnRequestDto
        {
            Name = "bad name; drop",
            SqlType = "TEXT"
        }, CancellationToken.None));
    }

    [Fact]
    public async Task CreateColumnAsync_RejectsPrimaryKeyNullableCombination()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var table = design.Tables[0];

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateColumnAsync(table.Id, design.Revision, new CreateDesignColumnRequestDto
        {
            Name = "bad_pk",
            SqlType = "INTEGER",
            IsPrimaryKey = true,
            IsNullable = true
        }, CancellationToken.None));
    }

    [Fact]
    public async Task CreateColumnAsync_NeverEmitsRedundantUniqueOnPrimaryKey()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var table = design.Tables[0];

        var updated = await service.CreateColumnAsync(table.Id, design.Revision, new CreateDesignColumnRequestDto
        {
            Name = "record_id",
            SqlType = "INTEGER",
            IsPrimaryKey = true,
            IsUnique = true,
            IsNullable = false
        }, CancellationToken.None);

        var created = updated.Tables.Single(t => t.Id == table.Id).Columns.Single(c => c.Name == "record_id");
        Assert.True(created.IsPrimaryKey);
        Assert.False(created.IsUnique);
    }

    [Fact]
    public async Task UpdateColumnAsync_NormalizesSqlTypeAndRejectsUnsupportedType()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var table = design.Tables[0];
        var column = table.Columns[0];

        await Assert.ThrowsAsync<ArgumentException>(() => service.UpdateColumnAsync(column.Id, design.Revision, new UpdateDesignColumnRequestDto
        {
            Name = column.Name,
            SqlType = "NOT_A_REAL_TYPE",
            IsNullable = true
        }, CancellationToken.None));
    }

    [Fact]
    public async Task CreateTableAsync_RejectsReservedKeywordName()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateTableAsync(design.Id, design.Revision, new CreateDesignTableRequestDto
        {
            Name = "select"
        }, CancellationToken.None));
    }

    [Fact]
    public async Task CreateTableAsync_RejectsDuplicateTableName()
    {
        await using var context = NewContext();
        var (service, design) = await SeedGeneratedDesignAsync(context);
        var existingName = design.Tables[0].Name;

        await Assert.ThrowsAsync<ArgumentException>(() => service.CreateTableAsync(design.Id, design.Revision, new CreateDesignTableRequestDto
        {
            Name = existingName
        }, CancellationToken.None));
    }
}
