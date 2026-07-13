using System.Text.Json;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Services;
using NpgsqlTypes;

namespace ForgeDB.API.Tests.Services;

public class DeploymentPlanBuilderTests
{
    [Fact]
    public void BuildSchemaName_IsDeterministicAndSafe()
    {
        Assert.Equal("forgedb_project_42", DeploymentPlanBuilder.BuildSchemaName(42));
    }

    [Fact]
    public void OrderTablesForInsertion_PlacesReferencedTableBeforeReferencingTable()
    {
        var (customers, orders, columns) = BuildCustomersOrders();
        var relationship = new DesignRelationship
        {
            Id = 1,
            FromColumnId = columns.OrdersCustomerId.Id,
            FromColumn = columns.OrdersCustomerId,
            ToColumnId = columns.CustomersId.Id,
            ToColumn = columns.CustomersId,
        };

        // Declared in "child first" order to prove the sort — not declaration order — decides placement.
        var ordered = DeploymentPlanBuilder.OrderTablesForInsertion(new[] { orders, customers }, new[] { relationship });

        Assert.Equal(new[] { "customers", "orders" }, ordered.Select(table => table.Name));
    }

    [Fact]
    public void OrderTablesForInsertion_FallsBackToDeclarationOrder_OnCycle()
    {
        var tableA = new DesignTable { Id = 1, Name = "a", Columns = new List<DesignColumn>() };
        var tableB = new DesignTable { Id = 2, Name = "b", Columns = new List<DesignColumn>() };
        var columnA = new DesignColumn { Id = 1, DesignTableId = 1, DesignTable = tableA, Name = "b_id" };
        var columnB = new DesignColumn { Id = 2, DesignTableId = 2, DesignTable = tableB, Name = "a_id" };

        var aToB = new DesignRelationship { Id = 1, FromColumnId = 1, FromColumn = columnA, ToColumnId = 2, ToColumn = columnB };
        var bToA = new DesignRelationship { Id = 2, FromColumnId = 2, FromColumn = columnB, ToColumnId = 1, ToColumn = columnA };

        var ordered = DeploymentPlanBuilder.OrderTablesForInsertion(new[] { tableA, tableB }, new[] { aToB, bToA });

        Assert.Equal(new[] { "a", "b" }, ordered.Select(table => table.Name));
    }

    [Fact]
    public void StripTransactionWrapper_RemovesBeginAndCommitLines()
    {
        var sql = "BEGIN;\n\nCREATE TABLE \"customers\" (\n    \"id\" integer NOT NULL\n);\n\nCOMMIT;\n";

        var stripped = DeploymentPlanBuilder.StripTransactionWrapper(sql);

        Assert.DoesNotContain("BEGIN;", stripped, StringComparison.Ordinal);
        Assert.DoesNotContain("COMMIT;", stripped, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE \"customers\"", stripped, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("integer", "42", 42L)]
    [InlineData("bigint", "42", 42L)]
    [InlineData("numeric(10,2)", "19.99", 19.99)]
    [InlineData("boolean", "true", true)]
    [InlineData("text", "hello", "hello")]
    [InlineData("varchar(50)", "hello", "hello")]
    public void ConvertValue_ParsesToExpectedClrType(string sqlType, string rawText, object expected)
    {
        var element = JsonSerializer.SerializeToElement(rawText);

        var result = DeploymentPlanBuilder.ConvertValue(element, sqlType);

        if (expected is double expectedDouble)
        {
            Assert.Equal((decimal)expectedDouble, Assert.IsType<decimal>(result));
        }
        else
        {
            Assert.Equal(expected, result);
        }
    }

    [Fact]
    public void ConvertValue_ReturnsDbNull_ForNullOrEmptyOrUnparseable()
    {
        Assert.Equal(DBNull.Value, DeploymentPlanBuilder.ConvertValue(null, "integer"));
        Assert.Equal(DBNull.Value, DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement(""), "integer"));
        Assert.Equal(DBNull.Value, DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement("not-a-number"), "integer"));
    }

    [Fact]
    public void ConvertValue_ParsesTimestamp()
    {
        var element = JsonSerializer.SerializeToElement("2026-03-05T00:00:00Z");

        var result = DeploymentPlanBuilder.ConvertValue(element, "timestamp with time zone");

        var dateTime = Assert.IsType<DateTime>(result);
        Assert.Equal(2026, dateTime.Year);
        Assert.Equal(3, dateTime.Month);
        Assert.Equal(5, dateTime.Day);
    }

    [Theory]
    [InlineData("INTEGER", NpgsqlDbType.Integer)]
    [InlineData("NUMERIC", NpgsqlDbType.Numeric)]
    [InlineData("VARCHAR(42)", NpgsqlDbType.Varchar)]
    [InlineData("TIMESTAMPTZ", NpgsqlDbType.TimestampTz)]
    public void CreateDbNullParameter_PreservesValidatedStoreType(string sqlType, NpgsqlDbType expected)
    {
        var parameter = DeploymentPlanBuilder.CreateDbNullParameter(sqlType, 2);

        Assert.Equal("p2", parameter.ParameterName);
        Assert.Equal(expected, parameter.NpgsqlDbType);
        Assert.Equal(DBNull.Value, parameter.Value);
    }

    private static (DesignTable Customers, DesignTable Orders, (DesignColumn CustomersId, DesignColumn OrdersCustomerId) Columns) BuildCustomersOrders()
    {
        var customers = new DesignTable { Id = 1, Name = "customers", Columns = new List<DesignColumn>() };
        var orders = new DesignTable { Id = 2, Name = "orders", Columns = new List<DesignColumn>() };
        var customersId = new DesignColumn { Id = 1, DesignTableId = 1, DesignTable = customers, Name = "id" };
        var ordersCustomerId = new DesignColumn { Id = 2, DesignTableId = 2, DesignTable = orders, Name = "customer_id" };
        return (customers, orders, (customersId, ordersCustomerId));
    }
}
