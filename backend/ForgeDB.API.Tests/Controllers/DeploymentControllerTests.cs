using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using ForgeDB.API.Tests.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Controllers;

public class DeploymentControllerTests
{
    [Fact]
    public async Task Preview_ReturnsBackendDerivedSummaryForOwnedProject()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 3);
        var service = Proxy<IDeploymentService>(new()
        {
            [nameof(IDeploymentService.GetPreviewAsync)] = _ => Task.FromResult(new DeploymentPreviewDto
            {
                SchemaName = "forgedb_project_1",
                DesignRevision = 7,
                TablesCount = 2,
                RelationshipsCount = 1,
                TotalRowsPlanned = 125,
                SourceVersionCount = 2,
                IsRedeployment = true
            })
        });
        var controller = BuildController(context, service, callingUserId: 3);

        var result = await controller.GetPreview(project.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var preview = Assert.IsType<DeploymentPreviewDto>(ok.Value);
        Assert.Equal(125, preview.TotalRowsPlanned);
        Assert.True(preview.IsRedeployment);
    }

    [Fact]
    public async Task Deploy_ReturnsStableConflictWhenAnotherDeploymentIsRunning()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 3);
        var service = Proxy<IDeploymentService>(new()
        {
            [nameof(IDeploymentService.DeployAsync)] = _ => throw new DeploymentInProgressException()
        });
        var controller = BuildController(context, service, callingUserId: 3);
        controller.Request.Headers.IfMatch = "7";

        var result = await controller.Deploy(project.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Contains("deployment_in_progress", JsonSerializer.Serialize(conflict.Value));
    }

    [Fact]
    public async Task Deploy_ReturnsStableConflictWhenActiveSourceChanges()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 3);
        var service = Proxy<IDeploymentService>(new()
        {
            [nameof(IDeploymentService.DeployAsync)] = _ => throw new DeploymentSourceChangedException()
        });
        var controller = BuildController(context, service, callingUserId: 3);
        controller.Request.Headers.IfMatch = "7";

        var result = await controller.Deploy(project.Id, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Contains("active_version_changed", JsonSerializer.Serialize(conflict.Value));
    }

    [Fact]
    public async Task DeploymentFile_ReturnsForbiddenForForeignProjectBeforeReadingArtifact()
    {
        await using var context = NewContext();
        var project = await SeedProjectAsync(context, ownerId: 3);
        var service = Proxy<IDeploymentService>(new());
        var controller = BuildController(context, service, callingUserId: 99);

        var result = await controller.DownloadSchemaSql(project.Id, deploymentId: 50, CancellationToken.None);

        var forbidden = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
    }

    private static ForgeDbContext NewContext() => new(new DbContextOptionsBuilder<ForgeDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<Project> SeedProjectAsync(ForgeDbContext context, int ownerId)
    {
        var user = new User
        {
            Id = ownerId,
            FirstName = "Deployment",
            LastName = "Owner",
            Email = $"deployment-{ownerId}@example.com",
            PasswordHash = "x",
            Role = "User",
            CreatedAt = DateTime.UtcNow
        };
        var project = new Project { User = user, Name = "Deployment project", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        return project;
    }

    private static DeploymentController BuildController(
        ForgeDbContext context,
        IDeploymentService service,
        int callingUserId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, callingUserId.ToString())],
            "TestAuth");
        return new DeploymentController(service, new ProjectRepository(context))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }

    private static T Proxy<T>(Dictionary<string, Func<object?[]?, object?>> handlers) where T : class
    {
        var proxy = DispatchProxy.Create<T, TestInterfaceProxy<T>>();
        ((TestInterfaceProxy<T>)(object)proxy).Handlers = handlers;
        return proxy;
    }
}
