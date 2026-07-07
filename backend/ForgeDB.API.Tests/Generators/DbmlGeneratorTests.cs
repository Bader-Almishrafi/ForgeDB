using ForgeDB.API.Services.Generators;
using Xunit;

namespace ForgeDB.API.Tests.Generators;

public class DbmlGeneratorTests
{
    [Fact]
    public void Generate_TwoTableWithForeignKey_EmitsTablesAndManyToOneRef()
    {
        var snapshot = Fixtures.TwoTableWithForeignKey();

        var dbml = new DbmlGenerator().Generate(snapshot);

        Assert.Contains("Project \"Demo Project\" {", dbml);
        Assert.Contains("database_type: \"PostgreSQL\"", dbml);
        Assert.Contains("Table customers {", dbml);
        Assert.Contains("id integer [pk, not null]", dbml);
        Assert.Contains("\"Select\" text [not null]", dbml);
        Assert.Contains("Table orders {", dbml);
        Assert.Contains("Ref: orders.customer_id > customers.id", dbml);
        Assert.Contains("Note: 'Master customer list'", dbml);
    }

    [Fact]
    public void Generate_OneToOneRelationship_UsesDashMarker()
    {
        var snapshot = Fixtures.TwoTableWithForeignKey();
        snapshot.Relationships[0].Cardinality = "one-to-one";

        var dbml = new DbmlGenerator().Generate(snapshot);

        Assert.Contains("Ref: orders.customer_id - customers.id", dbml);
    }
}
