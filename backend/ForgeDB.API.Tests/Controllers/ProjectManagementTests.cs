using System.Security.Claims;
using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Controllers;

public class ProjectManagementTests
{
    [Fact]
    public async Task GetAll_ReturnsEmptyList_WhenAuthenticatedUserHasNoProjects()
    {
        await using var context = NewContext();
        await SeedUserAsync(context, 1);

        var result = await BuildController(context, 1).GetAll(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<ProjectSummaryDto>>(ok.Value));
    }

    [Fact]
    public async Task GetAll_ReturnsOnlyAuthenticatedUsersProjects_WithWorkflowSummaries()
    {
        await using var context = NewContext();
        await SeedUserAsync(context, 1);
        await SeedUserAsync(context, 2);
        context.Projects.AddRange(
            new Project { UserId = 1, Name = "First", CreatedAt = DateTime.UtcNow.AddMinutes(-2) },
            new Project { UserId = 1, Name = "Second", CreatedAt = DateTime.UtcNow.AddMinutes(-1) },
            new Project { UserId = 2, Name = "Other", CreatedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();

        var result = await BuildController(context, 1).GetAll(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var projects = Assert.IsAssignableFrom<IEnumerable<ProjectSummaryDto>>(ok.Value).ToList();
        Assert.Equal(2, projects.Count);
        Assert.DoesNotContain(projects, project => project.Name == "Other");
        Assert.All(projects, project =>
        {
            Assert.Equal(ProjectWorkflowStates.NoData, project.WorkflowState);
            Assert.Equal(ProjectWorkflowSteps.Data, project.CurrentStep);
            Assert.Equal($"/projects/{project.Id}/data", project.RecommendedRoute);
            Assert.Equal(0, project.DatasetsCount);
        });
    }

    [Fact]
    public async Task Create_DoesNotAcceptUserId_AndStartsAtNoData()
    {
        await using var context = NewContext();
        await SeedUserAsync(context, 1);

        var result = await BuildController(context, 1).Create(
            new ProjectCreateRequestDto { Name = "  New project  ", Description = "  Notes  " },
            CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var project = Assert.IsType<ProjectDetailsDto>(created.Value);
        Assert.Equal("New project", project.Name);
        Assert.Equal("Notes", project.Description);
        Assert.Equal(ProjectWorkflowStates.NoData, project.WorkflowState);
        Assert.Equal(ProjectWorkflowSteps.Data, project.CurrentStep);
        Assert.Equal($"/projects/{project.Id}/data", project.RecommendedRoute);
        Assert.Equal(0, project.DatasetsCount);
        Assert.Equal(1, (await context.Projects.SingleAsync(item => item.Id == project.Id)).UserId);
    }

    [Fact]
    public async Task Create_RejectsEmptyName()
    {
        await using var context = NewContext();
        await SeedUserAsync(context, 1);

        var result = await BuildController(context, 1).Create(
            new ProjectCreateRequestDto { Name = "   " },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(context.Projects);
    }

    [Fact]
    public async Task GetById_ReturnsOwnedProject_AndRejectsAnotherOwner()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 1, name: "Owned");
        await SeedUserAsync(context, 2);

        var ownedResult = await BuildController(context, 1).GetById(project.Id, CancellationToken.None);
        var owned = Assert.IsType<ProjectDetailsDto>(Assert.IsType<OkObjectResult>(ownedResult.Result).Value);
        Assert.Equal(project.Id, owned.Id);
        Assert.Equal(ProjectWorkflowStates.NoData, owned.WorkflowState);

        var forbiddenResult = await BuildController(context, 2).GetById(project.Id, CancellationToken.None);
        Assert.Equal(403, Assert.IsType<ObjectResult>(forbiddenResult.Result).StatusCode);
    }

    [Fact]
    public async Task Update_TrimsName_UpdatesAndClearsDescription_WithoutChangingWorkflow()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 1, name: "Original");
        var controller = BuildController(context, 1);

        var updatedResult = await controller.Update(project.Id, new ProjectUpdateRequestDto
        {
            Name = "  Renamed  ",
            Description = "  New description  "
        }, CancellationToken.None);
        var updated = Assert.IsType<ProjectDetailsDto>(Assert.IsType<OkObjectResult>(updatedResult.Result).Value);
        Assert.Equal("Renamed", updated.Name);
        Assert.Equal("New description", updated.Description);
        Assert.Equal(ProjectWorkflowStates.NoData, updated.WorkflowState);

        var clearedResult = await controller.Update(project.Id, new ProjectUpdateRequestDto
        {
            Name = "Renamed",
            Description = "   "
        }, CancellationToken.None);
        var cleared = Assert.IsType<ProjectDetailsDto>(Assert.IsType<OkObjectResult>(clearedResult.Result).Value);
        Assert.Null(cleared.Description);
        Assert.Null((await context.Projects.SingleAsync(item => item.Id == project.Id)).Description);
    }

    [Fact]
    public async Task Update_RejectsAnotherOwner()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 1, name: "Owned");
        await SeedUserAsync(context, 2);

        var result = await BuildController(context, 2).Update(
            project.Id,
            new ProjectUpdateRequestDto { Name = "Hijacked" },
            CancellationToken.None);

        Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Equal("Owned", (await context.Projects.SingleAsync(item => item.Id == project.Id)).Name);
    }

    [Fact]
    public async Task Delete_RemovesOnlyOwnedTargetProject()
    {
        await using var context = NewContext();
        var target = await SeedProjectAsync(context, ownerId: 1, name: "Delete me");
        var survivor = new Project { UserId = 1, Name = "Keep me", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(survivor);
        await context.SaveChangesAsync();

        var result = await BuildController(context, 1).Delete(target.Id, CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await context.Projects.AnyAsync(project => project.Id == target.Id));
        Assert.True(await context.Projects.AnyAsync(project => project.Id == survivor.Id));
    }

    [Fact]
    public async Task Delete_RemovesAllProjectOwnedDependents_WithoutOrphans()
    {
        await using var context = NewContext();
        var target = await SeedProjectAsync(context, ownerId: 1, name: "Delete graph");
        var survivor = new Project { UserId = 1, Name = "Survivor", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(survivor);
        await context.SaveChangesAsync();

        var dataset = new Dataset
        {
            ProjectId = target.Id,
            TableName = "customers",
            SourceType = "csv",
            Status = "Analyzed",
            CreatedAt = DateTime.UtcNow
        };
        var survivorDataset = new Dataset
        {
            ProjectId = survivor.Id,
            TableName = "survivor_data",
            SourceType = "csv",
            Status = "Imported",
            CreatedAt = DateTime.UtcNow
        };
        context.Datasets.AddRange(dataset, survivorDataset);
        await context.SaveChangesAsync();

        context.DatasetRows.Add(new DatasetRow
        {
            DatasetId = dataset.Id,
            RowNumber = 1,
            RowData = "{\"id\":1}",
            CreatedAt = DateTime.UtcNow
        });
        context.DatasetColumns.Add(new DatasetColumn
        {
            DatasetId = dataset.Id,
            ColumnName = "id",
            DetectedDataType = "integer"
        });
        var version1 = new DatasetVersion
        {
            DatasetId = dataset.Id,
            CreatedByUserId = 1,
            VersionNumber = 1,
            IsRawOriginal = true,
            IsActive = false,
            RowsJson = "[]",
            ColumnsJson = "[]",
            AnalysisResultJson = "{}",
            AnalyzedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(version1);
        await context.SaveChangesAsync();

        var batch = new CleaningBatch
        {
            CorrelationId = Guid.NewGuid(),
            ProjectId = target.Id,
            CreatedByUserId = 1,
            Name = "Clean",
            Status = "Completed",
            CreatedAt = DateTime.UtcNow
        };
        context.CleaningBatches.Add(batch);
        await context.SaveChangesAsync();

        var version2 = new DatasetVersion
        {
            DatasetId = dataset.Id,
            ParentVersionId = version1.Id,
            CleaningBatchId = batch.Id,
            CreatedByUserId = 1,
            VersionNumber = 2,
            IsRawOriginal = false,
            IsActive = true,
            RowsJson = "[]",
            ColumnsJson = "[]",
            AnalysisResultJson = "{}",
            AnalyzedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        context.DatasetVersions.Add(version2);
        await context.SaveChangesAsync();
        dataset.ActiveVersionId = version2.Id;
        await context.SaveChangesAsync();

        context.CleaningOperations.Add(new CleaningOperation
        {
            CleaningBatchId = batch.Id,
            DatasetId = dataset.Id,
            SourceVersionId = version1.Id,
            ResultVersionId = version2.Id,
            OperationType = "trim",
            Status = "Completed",
            CreatedAt = DateTime.UtcNow
        });
        context.ProjectCleaningStates.Add(new ProjectCleaningState
        {
            ProjectId = target.Id,
            LastCleaningBatchId = batch.Id,
            QualityConfirmedAt = DateTime.UtcNow,
            QualityConfirmedByUserId = 1,
            ConfirmedVersionsJson = $"{{\"{dataset.Id}\":{version2.Id}}}",
            UpdatedAt = DateTime.UtcNow
        });
        var suggestion = new RelationshipSuggestion
        {
            ProjectId = target.Id,
            SourceDatasetId = dataset.Id,
            SourceColumnName = "id",
            TargetDatasetId = dataset.Id,
            TargetColumnName = "parent_id",
            Score = 0.9,
            CreatedAt = DateTime.UtcNow
        };
        context.RelationshipSuggestions.Add(suggestion);
        var design = new DesignModel
        {
            ProjectId = target.Id,
            LastModifiedByUserId = 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        context.DesignModels.Add(design);
        context.Deployments.Add(new Deployment
        {
            ProjectId = target.Id,
            DesignRevision = 1,
            SchemaName = "delete_graph",
            TriggeredByUserId = 1,
            StartedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var table = new DesignTable
        {
            DesignModelId = design.Id,
            Name = "customers",
            SourceDatasetId = dataset.Id,
            SourceDatasetVersionId = version2.Id
        };
        context.DesignTables.Add(table);
        await context.SaveChangesAsync();
        var fromColumn = new DesignColumn { DesignTableId = table.Id, Name = "id", SqlType = "integer", Ordinal = 0 };
        var toColumn = new DesignColumn { DesignTableId = table.Id, Name = "parent_id", SqlType = "integer", Ordinal = 1 };
        context.DesignColumns.AddRange(fromColumn, toColumn);
        await context.SaveChangesAsync();
        context.DesignRelationships.Add(new DesignRelationship
        {
            DesignModelId = design.Id,
            FromColumnId = fromColumn.Id,
            ToColumnId = toColumn.Id,
            SuggestionId = suggestion.Id
        });
        await context.SaveChangesAsync();

        var targetDatasetId = dataset.Id;
        var targetVersionIds = new[] { version1.Id, version2.Id };
        var targetBatchId = batch.Id;
        var targetDesignId = design.Id;
        var targetSuggestionId = suggestion.Id;
        context.ChangeTracker.Clear();

        var result = await BuildController(context, 1).Delete(target.Id, CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await context.Projects.AnyAsync(project => project.Id == target.Id));
        Assert.False(await context.Datasets.AnyAsync(item => item.ProjectId == target.Id));
        Assert.False(await context.DatasetRows.AnyAsync(item => item.DatasetId == targetDatasetId));
        Assert.False(await context.DatasetColumns.AnyAsync(item => item.DatasetId == targetDatasetId));
        Assert.False(await context.DatasetVersions.AnyAsync(item => targetVersionIds.Contains(item.Id)));
        Assert.False(await context.CleaningBatches.AnyAsync(item => item.Id == targetBatchId));
        Assert.False(await context.CleaningOperations.AnyAsync(item => item.CleaningBatchId == targetBatchId));
        Assert.False(await context.ProjectCleaningStates.AnyAsync(item => item.ProjectId == target.Id));
        Assert.False(await context.DesignModels.AnyAsync(item => item.Id == targetDesignId));
        Assert.False(await context.DesignTables.AnyAsync(item => item.DesignModelId == targetDesignId));
        Assert.False(await context.DesignColumns.AnyAsync(item => item.DesignTableId == table.Id));
        Assert.False(await context.DesignRelationships.AnyAsync(item => item.DesignModelId == targetDesignId));
        Assert.False(await context.RelationshipSuggestions.AnyAsync(item => item.Id == targetSuggestionId));
        Assert.False(await context.Deployments.AnyAsync(item => item.ProjectId == target.Id));
        Assert.True(await context.Projects.AnyAsync(project => project.Id == survivor.Id));
        Assert.True(await context.Datasets.AnyAsync(item => item.Id == survivorDataset.Id));
    }

    [Fact]
    public async Task CompatibilityListEndpoint_RemainsOwnershipProtected()
    {
        await using var context = NewContext();
        await SeedProjectAsync(context, ownerId: 1, name: "Owned");
        await SeedUserAsync(context, 2);

#pragma warning disable CS0618
        var result = await BuildController(context, 2).GetByUserId(1, CancellationToken.None);
#pragma warning restore CS0618

        Assert.Equal(403, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<User> SeedUserAsync(ForgeDbContext context, int userId)
    {
        var user = new User
        {
            Id = userId,
            FirstName = "Project",
            LastName = "Owner",
            Email = $"project-owner-{userId}@example.com",
            PasswordHash = "x",
            Role = "user",
            CreatedAt = DateTime.UtcNow
        };
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    private static async Task<Project> SeedProjectAsync(ForgeDbContext context, int ownerId, string name)
    {
        if (!await context.Users.AnyAsync(user => user.Id == ownerId)) await SeedUserAsync(context, ownerId);
        var project = new Project { UserId = ownerId, Name = name, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return project;
    }

    private static ProjectsController BuildController(ForgeDbContext context, int userId)
    {
        var projectRepository = new ProjectRepository(context);
        var cleaningRepository = new CleaningRepository(context);
        var workflowService = new ProjectWorkflowService(context);
        var projectService = new ProjectService(
            projectRepository,
            new DesignService(
                new DesignRepository(context),
                new DatasetRepository(context),
                new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
                new DesignValidationService(),
                cleaningRepository),
            new RelationshipDetectionService(
                new DatasetRepository(context),
                new RelationshipSuggestionRepository(context),
                new DesignRepository(context)),
            cleaningRepository,
            workflowService);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth");
        return new ProjectsController(projectService, projectRepository)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }
}
