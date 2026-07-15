using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ForgeDB.API.Tests.Services;

/// <summary>Proves FIX 3: accepting a relationship suggestion follows the same If-Match contract
/// as every other design mutation (stale revision -&gt; 409 with currentRevision), the status
/// change + DesignRelationship creation + revision bump commit in one SaveChanges, and a genuine
/// concurrent-accept race resolves to exactly one winner via the existing Revision concurrency
/// token instead of an unhandled exception.</summary>
public class RelationshipDetectionServiceAcceptTests
{
    private static ForgeDbContext NewContext(string dbName)
    {
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new ForgeDbContext(options);
    }

    private sealed record Seed(string DbName, int Revision, int Suggestion1Id, int Suggestion2Id);

    private static async Task<Seed> SeedAsync()
    {
        var dbName = Guid.NewGuid().ToString();
        var context = NewContext(dbName);

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

        var customers = new Dataset
        {
            ProjectId = project.Id,
            TableName = "customers",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 2,
            CreatedAt = DateTime.UtcNow,
            Columns = new List<DatasetColumn>
            {
                new() { ColumnName = "id", DetectedDataType = "integer", UniqueValuesCount = 2 }
            }
        };
        var orders = new Dataset
        {
            ProjectId = project.Id,
            TableName = "orders",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 5,
            CreatedAt = DateTime.UtcNow,
            Columns = new List<DatasetColumn>
            {
                new() { ColumnName = "customer_id", DetectedDataType = "integer" },
                new() { ColumnName = "backup_customer_id", DetectedDataType = "integer" }
            }
        };
        context.Datasets.AddRange(customers, orders);
        await context.SaveChangesAsync();

        var customersTable = new DesignTable
        {
            Name = "customers",
            SourceDatasetId = customers.Id,
            Origin = DesignOrigin.Generated,
            Columns = new List<DesignColumn>
            {
                new() { Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0, SourceColumnName = "id", Origin = DesignOrigin.Generated }
            }
        };
        var ordersTable = new DesignTable
        {
            Name = "orders",
            SourceDatasetId = orders.Id,
            Origin = DesignOrigin.Generated,
            Columns = new List<DesignColumn>
            {
                new() { Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0, SourceColumnName = "id", Origin = DesignOrigin.Generated },
                new() { Name = "customer_id", SqlType = "INTEGER", Ordinal = 1, SourceColumnName = "customer_id", Origin = DesignOrigin.Generated },
                new() { Name = "backup_customer_id", SqlType = "INTEGER", Ordinal = 2, SourceColumnName = "backup_customer_id", Origin = DesignOrigin.Generated }
            }
        };

        var design = new DesignModel
        {
            ProjectId = project.Id,
            Revision = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Tables = new List<DesignTable> { customersTable, ordersTable }
        };
        context.DesignModels.Add(design);
        await context.SaveChangesAsync();

        var suggestion1 = new RelationshipSuggestion
        {
            ProjectId = project.Id,
            SourceDatasetId = orders.Id,
            SourceColumnName = "customer_id",
            TargetDatasetId = customers.Id,
            TargetColumnName = "id",
            Score = 0.9,
            EvidenceJson = "{}",
            Status = RelationshipSuggestionStatus.Suggested,
            CreatedAt = DateTime.UtcNow
        };
        var suggestion2 = new RelationshipSuggestion
        {
            ProjectId = project.Id,
            SourceDatasetId = orders.Id,
            SourceColumnName = "backup_customer_id",
            TargetDatasetId = customers.Id,
            TargetColumnName = "id",
            Score = 0.8,
            EvidenceJson = "{}",
            Status = RelationshipSuggestionStatus.Suggested,
            CreatedAt = DateTime.UtcNow
        };
        context.RelationshipSuggestions.AddRange(suggestion1, suggestion2);
        await context.SaveChangesAsync();

        return new Seed(dbName, design.Revision, suggestion1.Id, suggestion2.Id);
    }

    private static RelationshipDetectionService BuildService(ForgeDbContext context)
    {
        return new RelationshipDetectionService(
            new DatasetRepository(context),
            new RelationshipSuggestionRepository(context),
            new DesignRepository(context));
    }

    [Fact]
    public async Task AcceptAsync_CorrectIfMatch_CreatesRelationshipAndBumpsRevisionInOneSave()
    {
        var seed = await SeedAsync();
        using var context = NewContext(seed.DbName);
        var service = BuildService(context);

        var response = await service.AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);

        Assert.Equal(seed.Revision + 1, response.DesignRevision);
        Assert.Equal(RelationshipSuggestionStatus.Accepted, response.Suggestion.Status);
        Assert.Equal("customer_id", response.Relationship.FromColumnName);
    }

    [Fact]
    public async Task AcceptAsync_StaleIfMatch_ThrowsConcurrencyExceptionAndMutatesNothing()
    {
        var seed = await SeedAsync();
        using var context = NewContext(seed.DbName);
        var service = BuildService(context);

        var exception = await Assert.ThrowsAsync<DesignConcurrencyException>(() =>
            service.AcceptAsync(seed.Suggestion1Id, seed.Revision + 99, null, CancellationToken.None));

        Assert.Equal(seed.Revision, exception.CurrentRevision);

        using var verifyContext = NewContext(seed.DbName);
        var suggestion = await verifyContext.RelationshipSuggestions.FindAsync(seed.Suggestion1Id);
        Assert.Equal(RelationshipSuggestionStatus.Suggested, suggestion!.Status);
        Assert.Empty(await verifyContext.DesignRelationships.ToListAsync());
    }

    [Fact]
    public async Task AcceptAsync_ConcurrentAcceptsRaceOnDesignRevision_ExactlyOneSucceeds()
    {
        var seed = await SeedAsync();

        // Two independent DbContexts against the same store, simulating two requests that each
        // read the design at revision 1 before either has committed.
        using var contextA = NewContext(seed.DbName);
        using var contextB = NewContext(seed.DbName);
        var serviceA = BuildService(contextA);
        var serviceB = BuildService(contextB);

        var responseA = await serviceA.AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);
        Assert.Equal(seed.Revision + 1, responseA.DesignRevision);

        // B loaded its own copy of the design before A committed, so B's ifMatchRevision (1)
        // still matches what B believes the revision to be — the explicit If-Match check alone
        // would pass. The race is instead caught by EF's own concurrency token at SaveChanges time.
        var exception = await Assert.ThrowsAsync<DesignConcurrencyException>(() =>
            serviceB.AcceptAsync(seed.Suggestion2Id, seed.Revision, null, CancellationToken.None));

        Assert.Equal(responseA.DesignRevision, exception.CurrentRevision);

        using var verifyContext = NewContext(seed.DbName);
        Assert.Single(await verifyContext.DesignRelationships.ToListAsync()); // only A's relationship exists
        var suggestion2 = await verifyContext.RelationshipSuggestions.FindAsync(seed.Suggestion2Id);
        Assert.Equal(RelationshipSuggestionStatus.Suggested, suggestion2!.Status); // B's attempt left no trace
    }

    /// <summary>A relationship changes what SQL/constraints/ER preview render, so a design that was
    /// already validated must go back to Draft (matching every other mutation path in
    /// DesignService.SaveAndBuildResponseAsync) instead of keeping a stale "Valid" status.</summary>
    [Fact]
    public async Task AcceptAsync_ResetsDesignStatusAndValidatedAtToDraft()
    {
        var seed = await SeedAsync();
        using (var setupContext = NewContext(seed.DbName))
        {
            var design = await setupContext.DesignModels.SingleAsync();
            design.Status = DesignStatus.Valid;
            design.ValidatedAt = DateTime.UtcNow;
            await setupContext.SaveChangesAsync();
        }

        using (var context = NewContext(seed.DbName))
        {
            var service = BuildService(context);
            await service.AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);
        }

        using var verifyContext = NewContext(seed.DbName);
        var updated = await verifyContext.DesignModels.SingleAsync();
        Assert.Equal(DesignStatus.Draft, updated.Status);
        Assert.Null(updated.ValidatedAt);
    }

    [Fact]
    public async Task AcceptAsync_NonKeyTargetIsRejectedWithoutMutatingSuggestionRevisionOrValidation()
    {
        var seed = await SeedAsync();
        using (var setupContext = NewContext(seed.DbName))
        {
            var target = await setupContext.DesignColumns.SingleAsync(column => column.Name == "id" && column.DesignTable!.Name == "customers");
            target.IsPrimaryKey = false;
            target.IsUnique = false;
            var design = await setupContext.DesignModels.SingleAsync();
            design.Status = DesignStatus.Valid;
            design.ValidatedAt = DateTime.UtcNow;
            await setupContext.SaveChangesAsync();
        }

        using (var context = NewContext(seed.DbName))
        {
            var service = BuildService(context);
            var exception = await Assert.ThrowsAsync<RelationshipSuggestionConflictException>(() =>
                service.AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None));
            Assert.Contains("neither a Primary Key nor Unique", exception.Message, StringComparison.Ordinal);
        }

        using var verify = NewContext(seed.DbName);
        Assert.Equal(RelationshipSuggestionStatus.Suggested, (await verify.RelationshipSuggestions.FindAsync(seed.Suggestion1Id))!.Status);
        Assert.Empty(await verify.DesignRelationships.ToListAsync());
        var unchanged = await verify.DesignModels.SingleAsync();
        Assert.Equal(seed.Revision, unchanged.Revision);
        Assert.Equal(DesignStatus.Valid, unchanged.Status);
        Assert.NotNull(unchanged.ValidatedAt);
    }

    [Fact]
    public async Task AcceptAsync_UniqueNonPrimaryTargetSucceeds()
    {
        var seed = await SeedAsync();
        using (var setupContext = NewContext(seed.DbName))
        {
            var target = await setupContext.DesignColumns.SingleAsync(column => column.Name == "id" && column.DesignTable!.Name == "customers");
            target.IsPrimaryKey = false;
            target.IsUnique = true;
            await setupContext.SaveChangesAsync();
        }

        using var context = NewContext(seed.DbName);
        var response = await BuildService(context).AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);

        Assert.Equal(RelationshipSuggestionStatus.Accepted, response.Suggestion.Status);
        Assert.Equal(seed.Revision + 1, response.DesignRevision);
    }

    [Fact]
    public async Task AcceptAsync_ExistingIdenticalRelationshipIsLinkedIdempotentlyWithoutRevisionBump()
    {
        var seed = await SeedAsync();
        using (var setupContext = NewContext(seed.DbName))
        {
            var design = await setupContext.DesignModels
                .Include(item => item.Tables).ThenInclude(table => table.Columns)
                .SingleAsync();
            var source = design.Tables.Single(table => table.Name == "orders").Columns.Single(column => column.Name == "customer_id");
            var target = design.Tables.Single(table => table.Name == "customers").Columns.Single(column => column.Name == "id");
            design.Relationships.Add(new DesignRelationship
            {
                DesignModelId = design.Id,
                FromColumnId = source.Id,
                ToColumnId = target.Id,
                Cardinality = DesignCardinality.ManyToOne,
                OnDelete = DesignOnDelete.NoAction
            });
            await setupContext.SaveChangesAsync();
        }

        using var context = NewContext(seed.DbName);
        var response = await BuildService(context)
            .AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);

        using var verify = NewContext(seed.DbName);
        var relationship = Assert.Single(await verify.DesignRelationships.ToListAsync());
        Assert.Equal(relationship.Id, response.Relationship.Id);
        Assert.Equal(seed.Suggestion1Id, relationship.SuggestionId);
        Assert.Equal(RelationshipSuggestionStatus.Accepted, (await verify.RelationshipSuggestions.FindAsync(seed.Suggestion1Id))!.Status);
        Assert.Equal(seed.Revision, (await verify.DesignModels.SingleAsync()).Revision);
    }

    [Fact]
    public async Task AcceptAsync_RepeatedRequestReturnsSameRelationshipWithoutSecondRevisionBump()
    {
        var seed = await SeedAsync();

        using var firstContext = NewContext(seed.DbName);
        var first = await BuildService(firstContext)
            .AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);

        using var repeatContext = NewContext(seed.DbName);
        var repeated = await BuildService(repeatContext)
            .AcceptAsync(seed.Suggestion1Id, seed.Revision, null, CancellationToken.None);

        Assert.Equal(first.Relationship.Id, repeated.Relationship.Id);
        Assert.Equal(first.DesignRevision, repeated.DesignRevision);
        using var verify = NewContext(seed.DbName);
        Assert.Single(await verify.DesignRelationships.ToListAsync());
        Assert.Equal(seed.Revision + 1, (await verify.DesignModels.SingleAsync()).Revision);
    }

    [Fact]
    public async Task AcceptAsync_EditedRequestPersistsEndpointsCardinalityAndOnDeleteAtomically()
    {
        var seed = await SeedAsync();
        int sourceColumnId;
        int targetColumnId;
        using (var setupContext = NewContext(seed.DbName))
        {
            sourceColumnId = (await setupContext.DesignColumns
                .SingleAsync(column => column.Name == "backup_customer_id")).Id;
            targetColumnId = (await setupContext.DesignColumns
                .SingleAsync(column => column.Name == "id" && column.DesignTable!.Name == "customers")).Id;
        }

        var request = new AcceptSuggestionRequestDto
        {
            FromColumnId = sourceColumnId,
            ToColumnId = targetColumnId,
            Cardinality = DesignCardinality.OneToOne,
            OnDelete = DesignOnDelete.Cascade
        };
        using var context = NewContext(seed.DbName);
        var response = await BuildService(context)
            .AcceptAsync(seed.Suggestion1Id, seed.Revision, request, CancellationToken.None);

        Assert.Equal("backup_customer_id", response.Relationship.FromColumnName);
        Assert.Equal(DesignCardinality.OneToOne, response.Relationship.Cardinality);
        Assert.Equal(DesignOnDelete.Cascade, response.Relationship.OnDelete);
        using var verify = NewContext(seed.DbName);
        var persisted = Assert.Single(await verify.DesignRelationships.ToListAsync());
        Assert.Equal(sourceColumnId, persisted.FromColumnId);
        Assert.Equal(targetColumnId, persisted.ToColumnId);
        Assert.Equal(DesignCardinality.OneToOne, persisted.Cardinality);
        Assert.Equal(DesignOnDelete.Cascade, persisted.OnDelete);
        Assert.Equal(RelationshipSuggestionStatus.Accepted, (await verify.RelationshipSuggestions.FindAsync(seed.Suggestion1Id))!.Status);
    }

    [Fact]
    public async Task AcceptAsync_InvalidEditedEndpointLeavesSuggestionAndDesignUntouched()
    {
        var seed = await SeedAsync();
        var request = new AcceptSuggestionRequestDto
        {
            FromColumnId = int.MaxValue,
            ToColumnId = int.MaxValue - 1,
            Cardinality = DesignCardinality.ManyToOne,
            OnDelete = DesignOnDelete.NoAction
        };

        using var context = NewContext(seed.DbName);
        await Assert.ThrowsAsync<RelationshipSuggestionConflictException>(() =>
            BuildService(context).AcceptAsync(seed.Suggestion1Id, seed.Revision, request, CancellationToken.None));

        using var verify = NewContext(seed.DbName);
        Assert.Empty(await verify.DesignRelationships.ToListAsync());
        Assert.Equal(RelationshipSuggestionStatus.Suggested, (await verify.RelationshipSuggestions.FindAsync(seed.Suggestion1Id))!.Status);
        Assert.Equal(seed.Revision, (await verify.DesignModels.SingleAsync()).Revision);
    }

    [Fact]
    public async Task RejectAsync_RepeatedRequestReturnsRejectedSuggestionWithoutFurtherMutation()
    {
        var seed = await SeedAsync();

        using var firstContext = NewContext(seed.DbName);
        var first = await BuildService(firstContext).RejectAsync(seed.Suggestion1Id, CancellationToken.None);
        using var repeatContext = NewContext(seed.DbName);
        var repeated = await BuildService(repeatContext).RejectAsync(seed.Suggestion1Id, CancellationToken.None);

        Assert.Equal(RelationshipSuggestionStatus.Rejected, first.Status);
        Assert.Equal(first.DecidedAt, repeated.DecidedAt);
        using var verify = NewContext(seed.DbName);
        Assert.Empty(await verify.DesignRelationships.ToListAsync());
        Assert.Equal(seed.Revision, (await verify.DesignModels.SingleAsync()).Revision);
    }

    [Fact]
    public async Task DetectAsync_WhenBothDirectionsScore_TargetsTheDesignKeyInsteadOfDatasetIdOrder()
    {
        var seed = await SeedAsync();
        using (var setupContext = NewContext(seed.DbName))
        {
            setupContext.RelationshipSuggestions.RemoveRange(setupContext.RelationshipSuggestions);
            var customers = await setupContext.Datasets.SingleAsync(dataset => dataset.TableName == "customers");
            var orders = await setupContext.Datasets.SingleAsync(dataset => dataset.TableName == "orders");
            customers.RowCount = 2;
            orders.RowCount = 2;
            customers.Rows.Add(new DatasetRow { RowNumber = 1, RowData = "{\"id\":1}", CreatedAt = DateTime.UtcNow });
            customers.Rows.Add(new DatasetRow { RowNumber = 2, RowData = "{\"id\":2}", CreatedAt = DateTime.UtcNow });
            orders.Rows.Add(new DatasetRow { RowNumber = 1, RowData = "{\"customer_id\":1}", CreatedAt = DateTime.UtcNow });
            orders.Rows.Add(new DatasetRow { RowNumber = 2, RowData = "{\"customer_id\":2}", CreatedAt = DateTime.UtcNow });
            await setupContext.SaveChangesAsync();
        }

        using var context = NewContext(seed.DbName);
        var suggestions = await BuildService(context).DetectAsync(
            (await context.Projects.SingleAsync()).Id,
            CancellationToken.None);

        var relationship = Assert.Single(suggestions.Where(item =>
            item.SourceColumnName == "customer_id" && item.TargetColumnName == "id"));
        Assert.Equal("orders", relationship.SourceTableName);
        Assert.Equal("customers", relationship.TargetTableName);
    }
}
