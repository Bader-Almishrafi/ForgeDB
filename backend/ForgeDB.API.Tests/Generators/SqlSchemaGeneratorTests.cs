using ForgeDB.API.Services.Generators;
using Xunit;

namespace ForgeDB.API.Tests.Generators;

public class SqlSchemaGeneratorTests
{
    [Fact]
    public void Generate_OrdersReferencesCustomers_EmitsInlineForeignKeyAndIndex()
    {
        var snapshot = Fixtures.TwoTableWithForeignKey();

        var sql = new SqlSchemaGenerator().Generate(snapshot);

        Assert.StartsWith("BEGIN;", sql);
        Assert.Contains("COMMIT;", sql);

        // Customers (the FK target) must be created before Orders in a non-cyclic graph.
        var customersIndex = sql.IndexOf("CREATE TABLE customers", StringComparison.Ordinal);
        var ordersIndex = sql.IndexOf("CREATE TABLE orders", StringComparison.Ordinal);
        Assert.True(customersIndex >= 0 && ordersIndex >= 0 && customersIndex < ordersIndex);

        Assert.Contains("PRIMARY KEY (id)", sql);
        Assert.Contains("FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE", sql);
        Assert.Contains("CREATE INDEX ix_orders_customer_id ON orders (customer_id);", sql);

        // The mixed-case/reserved-word column must be double-quoted, case preserved.
        Assert.Contains("\"Select\"", sql);
    }

    [Fact]
    public void Generate_CyclicRelationships_FallsBackToAlterTableAfterAllCreateTables()
    {
        var snapshot = Fixtures.CyclicTables();

        var sql = new SqlSchemaGenerator().Generate(snapshot);

        var lastCreateTable = sql.LastIndexOf("CREATE TABLE", StringComparison.Ordinal);
        var firstAlterTable = sql.IndexOf("ALTER TABLE", StringComparison.Ordinal);

        Assert.True(firstAlterTable > lastCreateTable, "ALTER TABLE constraints must come after every CREATE TABLE when the graph has a cycle.");
        Assert.DoesNotContain("FOREIGN KEY", sql.Substring(0, firstAlterTable));
        Assert.Contains("ADD CONSTRAINT", sql);
    }

    [Fact]
    public void Generate_TableWithComment_EmitsCommentOnTable()
    {
        var snapshot = Fixtures.TwoTableWithForeignKey();

        var sql = new SqlSchemaGenerator().Generate(snapshot);

        Assert.Contains("COMMENT ON TABLE customers IS 'Master customer list';", sql);
    }
}
