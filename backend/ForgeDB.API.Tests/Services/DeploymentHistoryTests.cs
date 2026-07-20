using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Tests.Services;

public class DeploymentHistoryTests
{
    [Fact]
    public async Task HistoryIsNewestFirstAndProjectsAvailabilityWithoutSqlContents()
    {
        await using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var project = new Project { Name = "History", CreatedAt = DateTime.UtcNow };
        context.Projects.Add(project);
        await context.SaveChangesAsync();
        context.Deployments.AddRange(
            NewDeployment(project.Id, 1, DateTime.UtcNow.AddMinutes(-5), DeploymentStatus.Completed),
            NewDeployment(project.Id, 2, DateTime.UtcNow, DeploymentStatus.Failed));
        await context.SaveChangesAsync();

        var history = await new DeploymentRepository(context).GetHistoryAsync(project.Id);

        Assert.Equal([2, 1], history.Select(item => item.DesignRevision));
        Assert.All(history, item => Assert.True(item.SchemaSqlAvailable && item.SeedSqlAvailable && item.DeploySqlAvailable));
        Assert.Null(typeof(ForgeDB.API.Repositories.Interfaces.DeploymentHistoryData).GetProperty(nameof(Deployment.GeneratedSql)));
    }

    private static Deployment NewDeployment(int projectId, int revision, DateTime startedAt, string status) => new()
    {
        ProjectId = projectId,
        DesignRevision = revision,
        SchemaName = $"forgedb_project_{projectId}",
        Status = status,
        GeneratedSql = "CREATE TABLE hidden_from_history();",
        SeedSql = "INSERT INTO hidden_from_history VALUES (1);",
        DeploySql = "BEGIN; COMMIT;",
        StartedAt = startedAt,
        CompletedAt = startedAt.AddSeconds(1)
    };
}
