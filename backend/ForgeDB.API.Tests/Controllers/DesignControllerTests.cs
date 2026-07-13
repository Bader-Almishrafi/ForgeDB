using System.Security.Claims;
using ForgeDB.API.Controllers;
using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Controllers;

public class DesignControllerTests
{
    [Fact]
    public async Task GetSchema_Returns204_WhenOwnedProjectHasNoSchema()
    {
        await using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var user = new User
        {
            FirstName = "Schema", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com",
            PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow
        };
        var project = new Project { Name = "Empty schema", User = user, CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        var controller = BuildController(context, user.Id);

        var result = await controller.GetSchema(project.Id, CancellationToken.None);

        Assert.IsType<NoContentResult>(result.Result);
    }

    private static DesignController BuildController(ForgeDbContext context, int userId)
    {
        var designRepository = new DesignRepository(context);
        var datasetRepository = new DatasetRepository(context);
        var cleaningRepository = new CleaningRepository(context);
        var designService = new DesignService(
            designRepository,
            datasetRepository,
            new DesignSchemaGeneratorResolver([new SqlSchemaGenerator(), new DbmlGenerator(), new JsonSchemaGenerator()]),
            new DesignValidationService(),
            cleaningRepository);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth");
        return new DesignController(designService, cleaningRepository, designRepository)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) }
            }
        };
    }
}
