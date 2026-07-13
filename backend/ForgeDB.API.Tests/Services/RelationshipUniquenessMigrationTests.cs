using ForgeDB.API.Data;
using ForgeDB.API.Services.Validation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ForgeDB.API.Tests.Services;

public class RelationshipUniquenessMigrationTests
{
    [Fact]
    public void MigrationRemovesOnlyRedundantExactCopiesBeforeCreatingUniqueIndex()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=script_only;Username=script;Password=script")
            .Options);
        var migrations = context.Database.GetMigrations().ToList();
        var previous = migrations.Single(name => name.EndsWith("AddDeployments", StringComparison.Ordinal));
        var uniqueness = migrations.Single(name => name.EndsWith("PreventDuplicateDesignRelationships", StringComparison.Ordinal));

        var script = context.GetService<IMigrator>().GenerateScript(previous, uniqueness);

        Assert.Contains("ROW_NUMBER() OVER", script, StringComparison.Ordinal);
        Assert.Contains("PARTITION BY \"DesignModelId\", \"FromColumnId\", \"ToColumnId\", \"Cardinality\"", script, StringComparison.Ordinal);
        Assert.Contains("duplicate.duplicate_rank > 1", script, StringComparison.Ordinal);
        Assert.Contains(DesignRelationshipRules.UniqueIndexName, script, StringComparison.Ordinal);
        Assert.Contains("CREATE UNIQUE INDEX", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM design_relationships;", script, StringComparison.OrdinalIgnoreCase);
    }
}
