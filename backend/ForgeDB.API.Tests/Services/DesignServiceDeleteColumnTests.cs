using ForgeDB.API.Data;
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

/// <summary>Proves the entity-spec requirement (prompt §2, DesignRelationship): deleting a
/// DesignColumn removes relationships referencing it, in the same save.</summary>
public class DesignServiceDeleteColumnTests
{
    private static ForgeDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new ForgeDbContext(options);
    }

    private static async Task<(ForgeDbContext Context, DesignModel Design, DesignColumn CustomerIdColumn)> SeedAsync()
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

        var customers = new DesignTable
        {
            Name = "customers",
            Origin = DesignOrigin.Generated,
            Columns = new List<DesignColumn>
            {
                new() { Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0, Origin = DesignOrigin.Generated }
            }
        };

        var customerIdColumn = new DesignColumn { Name = "customer_id", SqlType = "INTEGER", Ordinal = 1, Origin = DesignOrigin.Generated };
        var orders = new DesignTable
        {
            Name = "orders",
            Origin = DesignOrigin.Generated,
            Columns = new List<DesignColumn>
            {
                new() { Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0, Origin = DesignOrigin.Generated },
                customerIdColumn
            }
        };

        var design = new DesignModel
        {
            ProjectId = project.Id,
            Revision = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Tables = new List<DesignTable> { customers, orders }
        };

        context.DesignModels.Add(design);
        await context.SaveChangesAsync();

        var relationship = new DesignRelationship
        {
            DesignModelId = design.Id,
            FromColumnId = customerIdColumn.Id,
            ToColumnId = customers.Columns.First().Id,
            Cardinality = DesignCardinality.ManyToOne,
            OnDelete = DesignOnDelete.NoAction,
            Origin = DesignOrigin.User
        };

        context.DesignRelationships.Add(relationship);
        await context.SaveChangesAsync();

        return (context, design, customerIdColumn);
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

    [Fact]
    public async Task DeleteColumnAsync_RemovesRelationshipsReferencingIt()
    {
        var (context, design, customerIdColumn) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            Assert.Single(await context.DesignRelationships.ToListAsync());

            var response = await service.DeleteColumnAsync(customerIdColumn.Id, ifMatchRevision: design.Revision, CancellationToken.None);

            Assert.Empty(await context.DesignRelationships.ToListAsync());
            Assert.DoesNotContain(response.Tables.SelectMany(t => t.Columns), column => column.Id == customerIdColumn.Id);
            Assert.Equal(design.Revision, response.Revision); // design.Revision was mutated in place by the service
            Assert.Equal(2, response.Revision);
        }
    }

    [Fact]
    public async Task DeleteColumnAsync_StaleIfMatch_ThrowsConcurrencyException()
    {
        var (context, design, customerIdColumn) = await SeedAsync();
        using (context)
        {
            var repository = new DesignRepository(context);
            var service = BuildService(repository);

            await Assert.ThrowsAsync<DesignConcurrencyException>(() =>
                service.DeleteColumnAsync(customerIdColumn.Id, ifMatchRevision: design.Revision + 99, CancellationToken.None));
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
        public Task<bool> DeleteAsync(int datasetId, CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<Dataset?> ReplaceContentAsync(int datasetId, string sourceType, string? sourceName, string? sourceUrl, IReadOnlyList<DatasetColumn> columns, IReadOnlyList<DatasetRow> rows, int missingValuesCount, int duplicateRowsCount, CancellationToken cancellationToken = default) => throw new NotImplementedException();
    }
}
