using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ForgeDB.API.Tests.Services;

public class DesignRelationshipMutationTests
{
    private sealed record Seed(
        string DatabaseName,
        int DesignId,
        int Revision,
        int SourceColumnId,
        int TargetColumnId,
        int AlternateTargetColumnId);

    [Fact]
    public async Task CreateRelationship_NonKeyTargetIsRejectedWithoutRevisionOrStatusMutation()
    {
        var seed = await SeedAsync(targetIsPrimaryKey: false, targetIsUnique: false);
        await using var context = NewContext(seed.DatabaseName);
        var service = BuildService(context);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateRelationshipAsync(
            seed.DesignId,
            seed.Revision,
            Request(seed.SourceColumnId, seed.TargetColumnId),
            CancellationToken.None));

        Assert.Contains("Primary Key or Unique", exception.Message, StringComparison.Ordinal);
        await AssertUnchangedAsync(seed, expectedRelationshipCount: 0);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task CreateRelationship_PrimaryKeyOrUniqueTargetSucceeds(bool primaryKey, bool unique)
    {
        var seed = await SeedAsync(primaryKey, unique);
        await using var context = NewContext(seed.DatabaseName);
        var service = BuildService(context);

        var response = await service.CreateRelationshipAsync(
            seed.DesignId,
            seed.Revision,
            Request(seed.SourceColumnId, seed.TargetColumnId),
            CancellationToken.None);

        Assert.Equal(seed.Revision + 1, response.Revision);
        Assert.Single(response.Relationships);
        Assert.Equal(DesignStatus.Draft, response.Status);
    }

    [Fact]
    public async Task CreateRelationship_DuplicateReturnsConflictWithoutRevisionIncrement()
    {
        var seed = await SeedAsync(targetIsPrimaryKey: true, targetIsUnique: false, seedFirstRelationship: true);
        await using var context = NewContext(seed.DatabaseName);
        var service = BuildService(context);

        var exception = await Assert.ThrowsAsync<DesignRelationshipConflictException>(() => service.CreateRelationshipAsync(
            seed.DesignId,
            seed.Revision,
            Request(seed.SourceColumnId, seed.TargetColumnId),
            CancellationToken.None));

        Assert.Contains("identical relationship", exception.Message, StringComparison.OrdinalIgnoreCase);
        await AssertUnchangedAsync(seed, expectedRelationshipCount: 1);
    }

    [Fact]
    public async Task UpdateRelationship_IntoDuplicateReturnsConflictWithoutRevisionIncrement()
    {
        var seed = await SeedAsync(targetIsPrimaryKey: true, targetIsUnique: false, seedBothCardinalities: true);
        int relationshipId;
        await using (var lookup = NewContext(seed.DatabaseName))
        {
            relationshipId = await lookup.DesignRelationships
                .Where(item => item.Cardinality == DesignCardinality.OneToOne)
                .Select(item => item.Id)
                .SingleAsync();
        }

        await using var context = NewContext(seed.DatabaseName);
        var service = BuildService(context);
        await Assert.ThrowsAsync<DesignRelationshipConflictException>(() => service.UpdateRelationshipAsync(
            relationshipId,
            seed.Revision,
            new UpdateDesignRelationshipRequestDto
            {
                Cardinality = DesignCardinality.ManyToOne,
                OnDelete = DesignOnDelete.NoAction
            },
            CancellationToken.None));

        await AssertUnchangedAsync(seed, expectedRelationshipCount: 2);
    }

    [Fact]
    public async Task CreateRelationship_TypeMismatchAndSameEndpointAreRejected()
    {
        var seed = await SeedAsync(targetIsPrimaryKey: true, targetIsUnique: false);
        await using var context = NewContext(seed.DatabaseName);
        var service = BuildService(context);

        var mismatch = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateRelationshipAsync(
            seed.DesignId,
            seed.Revision,
            Request(seed.SourceColumnId, seed.AlternateTargetColumnId),
            CancellationToken.None));
        Assert.Contains("same PostgreSQL type", mismatch.Message, StringComparison.Ordinal);

        var sameEndpoint = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateRelationshipAsync(
            seed.DesignId,
            seed.Revision,
            Request(seed.TargetColumnId, seed.TargetColumnId),
            CancellationToken.None));
        Assert.Contains("same source and target", sameEndpoint.Message, StringComparison.Ordinal);
        await AssertUnchangedAsync(seed, expectedRelationshipCount: 0);
    }

    [Fact]
    public void ModelDefinesUniqueRelationshipEndpointCardinalityIndex()
    {
        using var context = NewContext(Guid.NewGuid().ToString());
        var entity = context.Model.FindEntityType(typeof(DesignRelationship))!;
        var index = entity.GetIndexes().Single(item => item.GetDatabaseName() == DesignRelationshipRules.UniqueIndexName);

        Assert.True(index.IsUnique);
        Assert.Equal(
            new[] { nameof(DesignRelationship.DesignModelId), nameof(DesignRelationship.FromColumnId), nameof(DesignRelationship.ToColumnId), nameof(DesignRelationship.Cardinality) },
            index.Properties.Select(property => property.Name));
    }

    [Fact]
    public void UniqueConstraintViolationIsRecognizedForCleanConflictTranslation()
    {
        var postgres = new PostgresException(
            "duplicate relationship", "ERROR", "ERROR", PostgresErrorCodes.UniqueViolation,
            constraintName: DesignRelationshipRules.UniqueIndexName);
        var exception = new DbUpdateException("duplicate", postgres);

        Assert.True(DesignRelationshipRules.IsUniqueConstraintViolation(exception));
    }

    private static ForgeDbContext NewContext(string databaseName)
    {
        return new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(databaseName)
            .Options);
    }

    private static DesignService BuildService(ForgeDbContext context)
    {
        return new DesignService(
            new DesignRepository(context),
            new DatasetRepository(context),
            new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
            new DesignValidationService());
    }

    private static CreateDesignRelationshipRequestDto Request(int fromColumnId, int toColumnId) => new()
    {
        FromColumnId = fromColumnId,
        ToColumnId = toColumnId,
        Cardinality = DesignCardinality.ManyToOne,
        OnDelete = DesignOnDelete.NoAction
    };

    private static async Task<Seed> SeedAsync(
        bool targetIsPrimaryKey,
        bool targetIsUnique,
        bool seedFirstRelationship = false,
        bool seedBothCardinalities = false)
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var context = NewContext(databaseName);
        var user = new User
        {
            FirstName = "Relationship", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com",
            PasswordHash = "hash", Role = "Owner", CreatedAt = DateTime.UtcNow
        };
        var project = new Project { Name = "Relationships", User = user, CreatedAt = DateTime.UtcNow };
        var targetTable = new DesignTable
        {
            Name = "customers",
            Columns =
            [
                new DesignColumn
                {
                    Name = "id", SqlType = "INTEGER", IsPrimaryKey = targetIsPrimaryKey,
                    IsUnique = targetIsUnique, Ordinal = 0
                },
                new DesignColumn
                {
                    Name = "external_key", SqlType = "TEXT", IsUnique = true, Ordinal = 1
                }
            ]
        };
        var sourceTable = new DesignTable
        {
            Name = "orders",
            Columns = [new DesignColumn { Name = "customer_id", SqlType = "INTEGER", Ordinal = 0 }]
        };
        var design = new DesignModel
        {
            Project = project,
            Revision = 7,
            Status = DesignStatus.Valid,
            ValidatedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Tables = [targetTable, sourceTable]
        };
        context.DesignModels.Add(design);
        await context.SaveChangesAsync();

        if (seedFirstRelationship || seedBothCardinalities)
        {
            design.Relationships.Add(new DesignRelationship
            {
                DesignModelId = design.Id,
                FromColumnId = sourceTable.Columns.Single().Id,
                ToColumnId = targetTable.Columns.ElementAt(0).Id,
                Cardinality = DesignCardinality.ManyToOne,
                OnDelete = DesignOnDelete.NoAction
            });
        }

        if (seedBothCardinalities)
        {
            design.Relationships.Add(new DesignRelationship
            {
                DesignModelId = design.Id,
                FromColumnId = sourceTable.Columns.Single().Id,
                ToColumnId = targetTable.Columns.ElementAt(0).Id,
                Cardinality = DesignCardinality.OneToOne,
                OnDelete = DesignOnDelete.NoAction
            });
        }

        await context.SaveChangesAsync();
        return new Seed(
            databaseName,
            design.Id,
            design.Revision,
            sourceTable.Columns.Single().Id,
            targetTable.Columns.ElementAt(0).Id,
            targetTable.Columns.ElementAt(1).Id);
    }

    private static async Task AssertUnchangedAsync(Seed seed, int expectedRelationshipCount)
    {
        await using var verify = NewContext(seed.DatabaseName);
        var design = await verify.DesignModels.SingleAsync();
        Assert.Equal(seed.Revision, design.Revision);
        Assert.Equal(DesignStatus.Valid, design.Status);
        Assert.NotNull(design.ValidatedAt);
        Assert.Equal(expectedRelationshipCount, await verify.DesignRelationships.CountAsync());
    }
}
