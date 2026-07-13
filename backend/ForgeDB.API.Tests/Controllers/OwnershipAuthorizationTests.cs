using System.Security.Claims;
using ForgeDB.API.Clients;
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
using Microsoft.Extensions.Logging.Abstractions;

namespace ForgeDB.API.Tests.Controllers;

/// <summary>
/// Regression coverage for the IDOR gap where ProjectsController, DatasetsController, and
/// RelationshipSuggestionsController had no [Authorize] attribute and no ownership checks, so any
/// authenticated (or even unauthenticated, pre-fix) caller could read/mutate another user's
/// projects, datasets, and relationship suggestions by guessing IDs.
/// </summary>
public class OwnershipAuthorizationTests
{
    [Fact]
    public async Task ProjectsController_GetById_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (ownerProject, _) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: 99);

        var result = await controller.GetById(ownerProject.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task ProjectsController_GetById_Succeeds_ForOwningUser()
    {
        await using var context = NewContext();
        var (ownerProject, ownerUserId) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: ownerUserId);

        var result = await controller.GetById(ownerProject.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var project = Assert.IsType<ProjectResponseDto>(ok.Value);
        Assert.Equal(ownerProject.Id, project.Id);
    }

    [Fact]
    public async Task ProjectsController_GetByUserId_Returns403_WhenRequestingAnotherUsersProjectList()
    {
        await using var context = NewContext();
        var (_, ownerUserId) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: 99);

        var result = await controller.GetByUserId(ownerUserId, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task ProjectsController_Create_IgnoresClientSuppliedUserId_UsesAuthenticatedUser()
    {
        await using var context = NewContext();
        await SeedUserAsync(context, 1);
        await SeedUserAsync(context, 2);
        var controller = BuildProjectsController(context, callingUserId: 1);

        var result = await controller.Create(new ProjectCreateDto { UserId = 2, Name = "Spoofed owner" }, CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var project = Assert.IsType<ProjectResponseDto>(created.Value);
        Assert.Equal(1, project.UserId);
    }

    [Fact]
    public async Task ProjectsController_Update_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (ownerProject, _) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: 99);

        var result = await controller.Update(ownerProject.Id, new ProjectUpdateDto { Name = "Hijacked" }, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task ProjectsController_Update_Succeeds_ForOwningUser_AndPersistsChanges()
    {
        await using var context = NewContext();
        var (ownerProject, ownerUserId) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: ownerUserId);

        var result = await controller.Update(ownerProject.Id, new ProjectUpdateDto { Name = "Renamed", Description = "New description" }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var updated = Assert.IsType<ProjectResponseDto>(ok.Value);
        Assert.Equal("Renamed", updated.Name);
        Assert.Equal("New description", updated.Description);
    }

    [Fact]
    public async Task ProjectsController_Delete_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (ownerProject, _) = await SeedTwoUsersOneProjectAsync(context, otherUserId: 99);
        var controller = BuildProjectsController(context, callingUserId: 99);

        var result = await controller.Delete(ownerProject.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task ProjectsController_Delete_Succeeds_ForOwningUser_AndCascadesDataset()
    {
        await using var context = NewContext();
        var (project, dataset, ownerUserId) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildProjectsController(context, callingUserId: ownerUserId);

        var result = await controller.Delete(project.Id, CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await context.Projects.AnyAsync(p => p.Id == project.Id));
        Assert.False(await context.Datasets.AnyAsync(d => d.Id == dataset.Id));
    }

    [Fact]
    public async Task DatasetsController_GetPreview_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (_, dataset, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.GetPreview(dataset.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task DatasetsController_UploadExcel_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (project, _, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.Upload(project.Id, new DatasetUploadDto
        {
            SourceType = "excel"
        }, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task DatasetsController_ImportApi_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (project, _, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.ImportApi(project.Id, new ApiJsonImportRequestDto
        {
            ApiUrl = "https://example.com/data"
        }, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task DatasetsController_Delete_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (_, dataset, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.Delete(dataset.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task DatasetsController_Replace_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (_, dataset, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.Replace(dataset.Id, new DatasetUploadDto(), CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task DatasetsController_GetByProject_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (project, _, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildDatasetsController(context, callingUserId: 99);

        var result = await controller.GetByProject(project.Id, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    [Fact]
    public async Task RelationshipSuggestionsController_GetSuggestions_Returns403_ForNonOwningUser()
    {
        await using var context = NewContext();
        var (project, _, _) = await SeedProjectWithDatasetAsync(context, ownerUserId: 1);
        var controller = BuildRelationshipSuggestionsController(context, callingUserId: 99);

        var result = await controller.GetSuggestions(project.Id, null, CancellationToken.None);

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(403, status.StatusCode);
    }

    // ---- fixtures ----

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<User> SeedUserAsync(ForgeDbContext context, int userId)
    {
        var user = new User { Id = userId, FirstName = "Test", LastName = "User", Email = $"user{userId}@example.com", PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow };
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    private static async Task<(Project Project, int OwnerUserId)> SeedTwoUsersOneProjectAsync(ForgeDbContext context, int otherUserId)
    {
        await SeedUserAsync(context, 1);
        await SeedUserAsync(context, otherUserId);
        var project = new Project { UserId = 1, Name = "Owner project", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return (project, 1);
    }

    private static async Task<(Project Project, Dataset Dataset, int OwnerUserId)> SeedProjectWithDatasetAsync(ForgeDbContext context, int ownerUserId)
    {
        await SeedUserAsync(context, ownerUserId);
        await SeedUserAsync(context, 99);
        var project = new Project { UserId = ownerUserId, Name = "Owner project", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        var dataset = new Dataset { ProjectId = project.Id, TableName = "customers", SourceType = "csv", Status = "Imported", CreatedAt = DateTime.UtcNow };
        context.Datasets.Add(dataset);
        await context.SaveChangesAsync();
        return (project, dataset, ownerUserId);
    }

    private static ControllerContext BuildControllerContext(int callingUserId)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callingUserId.ToString())], "TestAuth");
        return new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } };
    }

    private static ProjectsController BuildProjectsController(ForgeDbContext context, int callingUserId)
    {
        var projectRepository = new ProjectRepository(context);
        var projectService = new ProjectService(
            projectRepository,
            new DesignService(new DesignRepository(context), new DatasetRepository(context),
                new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
                new DesignValidationService(), new CleaningRepository(context)),
            new RelationshipDetectionService(new DatasetRepository(context), new RelationshipSuggestionRepository(context), new DesignRepository(context)),
            new CleaningRepository(context));
        return new ProjectsController(projectService, projectRepository) { ControllerContext = BuildControllerContext(callingUserId) };
    }

    private static DatasetsController BuildDatasetsController(ForgeDbContext context, int callingUserId)
    {
        var datasetRepository = new DatasetRepository(context);
        var projectRepository = new ProjectRepository(context);
        var pythonClient = new PythonAnalysisClient(new HttpClient { BaseAddress = new Uri("http://localhost:8002") });
        var datasetImportService = new DatasetImportService(datasetRepository, pythonClient, NullLogger<DatasetImportService>.Instance);
        var dashboardService = new DashboardService(datasetRepository);
        return new DatasetsController(datasetImportService, dashboardService, projectRepository, datasetRepository)
        {
            ControllerContext = BuildControllerContext(callingUserId)
        };
    }

    private static RelationshipSuggestionsController BuildRelationshipSuggestionsController(ForgeDbContext context, int callingUserId)
    {
        var suggestionRepository = new RelationshipSuggestionRepository(context);
        var projectRepository = new ProjectRepository(context);
        var detectionService = new RelationshipDetectionService(new DatasetRepository(context), suggestionRepository, new DesignRepository(context));
        return new RelationshipSuggestionsController(detectionService, projectRepository, suggestionRepository)
        {
            ControllerContext = BuildControllerContext(callingUserId)
        };
    }
}
