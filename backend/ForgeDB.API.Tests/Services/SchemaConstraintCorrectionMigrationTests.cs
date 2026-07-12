using ForgeDB.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;

namespace ForgeDB.API.Tests.Services;

public class SchemaConstraintCorrectionMigrationTests
{
    [Fact]
    public void Migration_ClearsOnlyGeneratedInferredFlagsWithoutDeletingSchemaObjects()
    {
        using var context = new ForgeDbContext(new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql("Host=localhost;Database=script_only;Username=script;Password=script")
            .Options);
        var migrations = context.Database.GetMigrations().ToList();
        var previous = migrations.Single(name => name.EndsWith("AddSchemaDraftWorkflow", StringComparison.Ordinal));
        var correction = migrations.Single(name => name.EndsWith("CorrectGeneratedSchemaConstraints", StringComparison.Ordinal));

        var script = context.GetService<IMigrator>().GenerateScript(previous, correction);

        Assert.Contains("UPDATE design_columns", script);
        Assert.Contains("\"Origin\" = 'generated'", script);
        Assert.Contains("\"IsPrimaryKey\" = FALSE", script);
        Assert.Contains("\"IsUnique\" = FALSE", script);
        Assert.DoesNotContain("DELETE FROM design_relationships", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM design_columns", script, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM design_tables", script, StringComparison.OrdinalIgnoreCase);
    }
}
