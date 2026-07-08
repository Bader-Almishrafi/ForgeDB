using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ForgeDB.API.Tests.Services;

/// <summary>Proves decision D2 (prompt FIX 2): /design/generate requires If-Match only when a
/// DesignModel already exists for the project. Fresh creation is precondition-free; regenerating
/// over an existing design (merge or replace) requires a matching revision.</summary>
public class DesignServiceGenerateTests
{
    private static ForgeDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new ForgeDbContext(options);
    }

    private static async Task<(ForgeDbContext Context, Project Project)> SeedProjectWithDatasetAsync()
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

        var dataset = new Dataset
        {
            ProjectId = project.Id,
            TableName = "people",
            SourceType = "csv",
            Status = "Analyzed",
            RowCount = 2,
            ColumnCount = 1,
            CreatedAt = DateTime.UtcNow,
            Columns = new List<DatasetColumn>
            {
                new() { ColumnName = "id", DetectedDataType = "integer", IsNullable = false, UniqueValuesCount = 2 }
            }
        };
        context.Datasets.Add(dataset);
        await context.SaveChangesAsync();

        return (context, project);
    }

    private static DesignService BuildService(DesignRepository designRepository, DatasetRepository datasetRepository)
    {
        var generators = new IDesignSchemaGenerator[] { new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator() };
        return new DesignService(
            designRepository,
            datasetRepository,
            new DesignSchemaGeneratorResolver(generators),
            new DesignValidationService());
    }

    [Fact]
    public async Task GenerateAsync_NoExistingDesign_SucceedsWithoutIfMatch()
    {
        var (context, project) = await SeedProjectWithDatasetAsync();
        using (context)
        {
            var service = BuildService(new DesignRepository(context), new DatasetRepository(context));

            var response = await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);

            Assert.Equal(1, response.Revision);
            Assert.Single(response.Tables);
        }
    }

    [Fact]
    public async Task GenerateAsync_ExistingDesign_MissingIfMatch_ThrowsPreconditionRequired()
    {
        var (context, project) = await SeedProjectWithDatasetAsync();
        using (context)
        {
            var service = BuildService(new DesignRepository(context), new DatasetRepository(context));
            await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);

            await Assert.ThrowsAsync<DesignPreconditionRequiredException>(() =>
                service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None));
        }
    }

    [Fact]
    public async Task GenerateAsync_ExistingDesign_CorrectIfMatch_RegeneratesAndBumpsRevision()
    {
        var (context, project) = await SeedProjectWithDatasetAsync();
        using (context)
        {
            var service = BuildService(new DesignRepository(context), new DatasetRepository(context));
            var created = await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);

            var response = await service.GenerateAsync(
                project.Id,
                new GenerateDesignRequestDto { Mode = "merge" },
                ifMatchRevision: created.Revision,
                CancellationToken.None);

            Assert.Equal(created.Revision + 1, response.Revision);
        }
    }

    [Fact]
    public async Task GenerateAsync_ExistingDesign_StaleIfMatch_ThrowsConcurrencyExceptionWithCurrentRevision()
    {
        var (context, project) = await SeedProjectWithDatasetAsync();
        using (context)
        {
            var service = BuildService(new DesignRepository(context), new DatasetRepository(context));
            var created = await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);

            var exception = await Assert.ThrowsAsync<DesignConcurrencyException>(() =>
                service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: created.Revision + 99, CancellationToken.None));

            Assert.Equal(created.Revision, exception.CurrentRevision);
        }
    }

    [Fact]
    public async Task GenerateAsync_ExistingDesign_ReplaceModeAlsoRequiresIfMatch()
    {
        var (context, project) = await SeedProjectWithDatasetAsync();
        using (context)
        {
            var service = BuildService(new DesignRepository(context), new DatasetRepository(context));
            await service.GenerateAsync(project.Id, new GenerateDesignRequestDto(), ifMatchRevision: null, CancellationToken.None);

            await Assert.ThrowsAsync<DesignPreconditionRequiredException>(() =>
                service.GenerateAsync(project.Id, new GenerateDesignRequestDto { Mode = "replace" }, ifMatchRevision: null, CancellationToken.None));
        }
    }
}
