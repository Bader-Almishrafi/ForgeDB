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

    [Fact]
    public async Task CreateRelationship_Returns409_WhenExactRelationshipAlreadyExists()
    {
        await using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var user = new User
        {
            FirstName = "Relationship", LastName = "Owner", Email = $"{Guid.NewGuid()}@example.com",
            PasswordHash = "x", Role = "user", CreatedAt = DateTime.UtcNow
        };
        var project = new Project { Name = "Duplicate relationship", User = user, CreatedAt = DateTime.UtcNow };
        var design = new DesignModel
        {
            Project = project,
            Revision = 4,
            Status = DesignStatus.Draft,
            SourceVersionsJson = "{}",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        var sourceTable = new DesignTable { DesignModel = design, Name = "orders", Origin = DesignOrigin.Generated };
        var targetTable = new DesignTable { DesignModel = design, Name = "customers", Origin = DesignOrigin.Generated };
        var source = new DesignColumn
        {
            DesignTable = sourceTable, Name = "customer_id", SqlType = "INTEGER", Ordinal = 0,
            Origin = DesignOrigin.Generated
        };
        var target = new DesignColumn
        {
            DesignTable = targetTable, Name = "customer_id", SqlType = "INTEGER", Ordinal = 0,
            IsPrimaryKey = true, Origin = DesignOrigin.Generated
        };
        sourceTable.Columns.Add(source);
        targetTable.Columns.Add(target);
        design.Tables.Add(sourceTable);
        design.Tables.Add(targetTable);
        design.Relationships.Add(new DesignRelationship
        {
            DesignModel = design,
            FromColumn = source,
            ToColumn = target,
            Cardinality = DesignCardinality.ManyToOne,
            OnDelete = DesignOnDelete.NoAction,
            Origin = DesignOrigin.User
        });
        context.DesignModels.Add(design);
        await context.SaveChangesAsync();
        var controller = BuildController(context, user.Id);
        controller.Request.Headers.IfMatch = "4";

        var result = await controller.CreateRelationship(
            design.Id,
            new ForgeDB.API.Models.DTOs.CreateDesignRelationshipRequestDto
            {
                FromColumnId = source.Id,
                ToColumnId = target.Id,
                Cardinality = DesignCardinality.ManyToOne,
                OnDelete = DesignOnDelete.NoAction
            },
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Contains("identical relationship", conflict.Value!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(4, design.Revision);
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
