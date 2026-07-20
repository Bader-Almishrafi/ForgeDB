using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ForgeDB.API.Tests.Services;

public class DeploymentConcurrencyMigrationTests
{
    [Fact]
    public void ModelPreventsTwoRunningDeploymentsForOneProject()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=model_only;Username=model;Password=model")
            .Options);

        var entity = context.Model.FindEntityType(typeof(Deployment))!;
        var runningIndex = entity.GetIndexes()
            .Single(index => index.GetDatabaseName() == "UX_deployments_ProjectId_Running");

        Assert.True(runningIndex.IsUnique);
        Assert.Equal("\"Status\" = 'Running'", runningIndex.GetFilter());
        Assert.Equal(nameof(Deployment.ProjectId), Assert.Single(runningIndex.Properties).Name);
    }

    [Fact]
    public void MigrationSettlesOlderRunningRowsBeforeCreatingUniqueIndex()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=script_only;Username=script;Password=script")
            .Options);
        var migrations = context.Database.GetMigrations().ToList();
        var previous = migrations.Single(name => name.EndsWith("EstablishActiveDatasetVersion", StringComparison.Ordinal));
        var concurrency = migrations.Single(name => name.EndsWith("PreventConcurrentProjectDeployments", StringComparison.Ordinal));

        var script = context.GetService<IMigrator>().GenerateScript(previous, concurrency);

        Assert.Contains("row_number() OVER (PARTITION BY \"ProjectId\"", script, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SET \"Status\" = 'Failed'", script, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX \"UX_deployments_ProjectId_Running\"", script, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("WHERE \"Status\" = 'Running'", script, StringComparison.OrdinalIgnoreCase);
    }
}
