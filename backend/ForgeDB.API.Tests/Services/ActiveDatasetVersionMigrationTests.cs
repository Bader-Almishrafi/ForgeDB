using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ForgeDB.API.Tests.Services;

public class ActiveDatasetVersionMigrationTests
{
    [Fact]
    public void ModelPreventsMoreThanOneActiveVersionPerDataset()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=model_only;Username=model;Password=model")
            .Options);

        var entity = context.Model.FindEntityType(typeof(DatasetVersion))!;
        var activeIndex = entity.GetIndexes().Single(index => index.GetDatabaseName() == "IX_dataset_versions_DatasetId_Active");

        Assert.True(activeIndex.IsUnique);
        Assert.Equal("\"IsActive\" = TRUE", activeIndex.GetFilter());
        Assert.Equal(nameof(DatasetVersion.DatasetId), Assert.Single(activeIndex.Properties).Name);
    }

    [Fact]
    public void MigrationBackfillsPointersAndFlagsBeforeCreatingUniqueActiveIndex()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=script_only;Username=script;Password=script")
            .Options);
        var migrations = context.Database.GetMigrations().ToList();
        var previous = migrations.Single(name => name.EndsWith("AddPasswordResetTokens", StringComparison.Ordinal));
        var activeVersion = migrations.Single(name => name.EndsWith("EstablishActiveDatasetVersion", StringComparison.Ordinal));

        var script = context.GetService<IMigrator>().GenerateScript(previous, activeVersion);

        Assert.Contains("INSERT INTO dataset_versions", script, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("UPDATE datasets", script, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("SET \"IsActive\" =", script, StringComparison.Ordinal);
        Assert.Contains("'datasetVersionId', version.\"Id\"", script, StringComparison.Ordinal);
        Assert.Contains("'isCleanedVersion', NOT version.\"IsRawOriginal\"", script, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX \"IX_dataset_versions_DatasetId_Active\"", script, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("WHERE \"IsActive\" = TRUE", script, StringComparison.OrdinalIgnoreCase);
    }
}
