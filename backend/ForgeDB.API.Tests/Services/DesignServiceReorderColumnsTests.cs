using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ForgeDB.API.Tests.Services;

/// <summary>Proves FIX 4: POST design-tables/{tableId}/columns/reorder applies a complete
/// column-id order in one transaction/revision bump (replacing the old sequential-PATCH swap),
/// and rejects anything that isn't exactly the existing column set.</summary>
public class DesignServiceReorderColumnsTests
{
    private static ForgeDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new ForgeDbContext(options);
    }

    private static async Task<(ForgeDbContext Context, DesignModel Design, DesignTable Widgets)> SeedAsync()
    {
        var context = NewContext();

        var user = new User
        {
            FirstName = "Test",
            LastName = "User",
            Email = $"{Guid.NewGuid()}@example.com",
            PasswordHash = "hash",
            Role = "Owner",
            CreatedAt = DateTime.UtcNow
        };
        var project = new Project { Name = "Demo", CreatedAt = DateTime.UtcNow, User = user };
        context.Projects.Add(project);
        await context.SaveChangesAsync();

        var widgets = new DesignTable
        {
            Name = "widgets",
            Origin = DesignOrigin.Generated,
            Columns = new List<DesignColumn>
            {
                new() { Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0, Origin = DesignOrigin.Generated },
                new() { Name = "a", SqlType = "TEXT", Ordinal = 1, Origin = DesignOrigin.Generated },
                new() { Name = "b", SqlType = "TEXT", Ordinal = 2, Origin = DesignOrigin.Generated },
                new() { Name = "c", SqlType = "TEXT", Ordinal = 3, Origin = DesignOrigin.Generated }
            }
        };

        var design = new DesignModel
        {
            ProjectId = project.Id,
            Revision = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Tables = new List<DesignTable> { widgets }
        };

        context.DesignModels.Add(design);
        await context.SaveChangesAsync();

        return (context, design, widgets);
    }

    private static DesignService BuildService(IDesignRepository repository)
    {
        var generators = new IDesignSchemaGenerator[] { new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator() };
        return new DesignService(
            repository,
            new NotImplementedDatasetRepository(),
            new DesignSchemaGeneratorResolver(generators),
            new DesignValidationService());
    }

    private static int ColumnIdByName(DesignTable table, string name) => table.Columns.First(c => c.Name == name).Id;

    [Fact]
    public async Task ReorderColumnsAsync_MidListReorder_YieldsContiguousOrdinalsInOneRevisionBump()
    {
        var (context, design, widgets) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            var idId = ColumnIdByName(widgets, "id");
            var aId = ColumnIdByName(widgets, "a");
            var bId = ColumnIdByName(widgets, "b");
            var cId = ColumnIdByName(widgets, "c");

            // Swap the two middle columns: id, a, b, c -> id, b, a, c.
            var response = await service.ReorderColumnsAsync(
                widgets.Id,
                design.Revision,
                new ReorderDesignColumnsRequestDto { ColumnIds = new List<int> { idId, bId, aId, cId } },
                CancellationToken.None);

            Assert.Equal(2, response.Revision); // single bump, not one per column

            var reordered = response.Tables.Single(t => t.Id == widgets.Id).Columns.OrderBy(c => c.Ordinal).ToList();
            Assert.Equal(new[] { "id", "b", "a", "c" }, reordered.Select(c => c.Name));
            Assert.Equal(new[] { 0, 1, 2, 3 }, reordered.Select(c => c.Ordinal)); // contiguous, no gaps
        }
    }

    [Fact]
    public async Task ReorderColumnsAsync_SetMismatch_ThrowsArgumentException()
    {
        var (context, design, widgets) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            var idId = ColumnIdByName(widgets, "id");
            var aId = ColumnIdByName(widgets, "a");
            var bId = ColumnIdByName(widgets, "b");
            // Omits column "c" entirely — not a valid permutation of the existing set.

            await Assert.ThrowsAsync<ArgumentException>(() =>
                service.ReorderColumnsAsync(
                    widgets.Id,
                    design.Revision,
                    new ReorderDesignColumnsRequestDto { ColumnIds = new List<int> { idId, aId, bId } },
                    CancellationToken.None));
        }
    }

    [Fact]
    public async Task ReorderColumnsAsync_DuplicateIdPaddingSameCount_ThrowsArgumentException()
    {
        var (context, design, widgets) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            var idId = ColumnIdByName(widgets, "id");
            var aId = ColumnIdByName(widgets, "a");
            var bId = ColumnIdByName(widgets, "b");
            // Same length as the real column count (4), but "b" appears twice and "c" is missing.

            await Assert.ThrowsAsync<ArgumentException>(() =>
                service.ReorderColumnsAsync(
                    widgets.Id,
                    design.Revision,
                    new ReorderDesignColumnsRequestDto { ColumnIds = new List<int> { idId, aId, bId, bId } },
                    CancellationToken.None));
        }
    }

    [Fact]
    public async Task ReorderColumnsAsync_StaleIfMatch_ThrowsConcurrencyException()
    {
        var (context, design, widgets) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            var ids = widgets.Columns.OrderBy(c => c.Ordinal).Select(c => c.Id).ToList();

            await Assert.ThrowsAsync<DesignConcurrencyException>(() =>
                service.ReorderColumnsAsync(
                    widgets.Id,
                    design.Revision + 99,
                    new ReorderDesignColumnsRequestDto { ColumnIds = ids },
                    CancellationToken.None));
        }
    }

    private sealed class NotImplementedDatasetRepository : IDatasetRepository
    {
        public Task<bool> ProjectExistsAsync(int projectId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<Dataset?> GetByIdAsync(int datasetId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<Dataset?> GetByIdWithColumnsAsync(int datasetId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<Dataset?> GetByIdWithPreviewAsync(int datasetId, int rowLimit, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<Dataset?> GetByIdWithRowsAndColumnsAsync(int datasetId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<IReadOnlyList<Dataset>> GetByProjectIdAsync(int projectId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<IReadOnlyList<Dataset>> GetByProjectIdWithColumnsAsync(int projectId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<IReadOnlyList<Dataset>> GetByProjectIdWithRowsAndColumnsAsync(int projectId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task AddAsync(Dataset dataset, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task SaveAnalysisResultAsync(int datasetId, string analysisResultJson, int missingValuesCount, int duplicateRowsCount, DateTime analyzedAt, CancellationToken cancellationToken = default) => throw new NotImplementedException();
    }
}
