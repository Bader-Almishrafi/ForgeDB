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
    [InlineData("integer", "42", 42)]
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

    [Theory]
    [InlineData("SMALLINT", NpgsqlDbType.Smallint)]
    [InlineData("INTEGER", NpgsqlDbType.Integer)]
    [InlineData("BIGINT", NpgsqlDbType.Bigint)]
    [InlineData("NUMERIC", NpgsqlDbType.Numeric)]
    [InlineData("DECIMAL", NpgsqlDbType.Numeric)]
    [InlineData("REAL", NpgsqlDbType.Real)]
    [InlineData("DOUBLE PRECISION", NpgsqlDbType.Double)]
    [InlineData("BOOLEAN", NpgsqlDbType.Boolean)]
    [InlineData("VARCHAR(120)", NpgsqlDbType.Varchar)]
    [InlineData("TEXT", NpgsqlDbType.Text)]
    [InlineData("DATE", NpgsqlDbType.Date)]
    [InlineData("TIMESTAMP", NpgsqlDbType.Timestamp)]
    [InlineData("TIMESTAMPTZ", NpgsqlDbType.TimestampTz)]
    [InlineData("UUID", NpgsqlDbType.Uuid)]
    public void CreateParameter_ExplicitlyTypesNullForEverySupportedStoreType(string sqlType, NpgsqlDbType expected)
    {
        var parameter = DeploymentPlanBuilder.CreateParameter(sqlType, "p_t0_r0_c0", DBNull.Value);

        Assert.Equal("p_t0_r0_c0", parameter.ParameterName);
        Assert.Equal(expected, parameter.NpgsqlDbType);
        Assert.Equal(DBNull.Value, parameter.Value);
    }

    [Fact]
    public void BuildParameterName_IsUniqueAcrossTablesRowsAndRenamedColumns()
    {
        var names = (from table in Enumerable.Range(0, 2)
                     from row in Enumerable.Range(0, 3)
                     from column in Enumerable.Range(0, 4)
                     select DeploymentPlanBuilder.BuildParameterName(table, row, column)).ToList();

        Assert.Equal(24, names.Distinct(StringComparer.Ordinal).Count());
        Assert.Contains("p_t0_r0_c0", names);
        Assert.Contains("p_t1_r2_c3", names);
    }

    [Fact]
    public void AlternatingNullAndNonNullValuesKeepTheirColumnTypesAndNames()
    {
        var values = new object[]
        {
            DeploymentPlanBuilder.ConvertValue(null, "NUMERIC"),
            DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement("19.95"), "NUMERIC"),
            DeploymentPlanBuilder.ConvertValue(null, "INTEGER"),
            DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement("7"), "INTEGER"),
            DeploymentPlanBuilder.ConvertValue(null, "DATE"),
            DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement("2026-07-13"), "DATE"),
        };

        var sqlTypes = new[] { "NUMERIC", "NUMERIC", "INTEGER", "INTEGER", "DATE", "DATE" };
        var parameters = values.Select((value, index) => DeploymentPlanBuilder.CreateParameter(
            sqlTypes[index], DeploymentPlanBuilder.BuildParameterName(0, index / 2, index), value)).ToList();

        Assert.Equal(parameters.Count, parameters.Select(parameter => parameter.ParameterName).Distinct().Count());
        Assert.Equal(DBNull.Value, parameters[0].Value);
        Assert.Equal(19.95m, parameters[1].Value);
        Assert.Equal(DBNull.Value, parameters[2].Value);
        Assert.Equal(7, parameters[3].Value);
        Assert.Equal(DBNull.Value, parameters[4].Value);
        Assert.Equal(new DateOnly(2026, 7, 13), parameters[5].Value);
    }

    [Fact]
    public void ConvertValue_ParsesUuidAndTimestampKindsForExplicitBinding()
    {
        var uuid = Guid.NewGuid();
        var parsedUuid = DeploymentPlanBuilder.ConvertValue(JsonSerializer.SerializeToElement(uuid.ToString()), "UUID");
        var timestamp = Assert.IsType<DateTime>(DeploymentPlanBuilder.ConvertValue(
            JsonSerializer.SerializeToElement("2026-07-13T20:30:00"), "TIMESTAMP"));
        var timestampTz = Assert.IsType<DateTime>(DeploymentPlanBuilder.ConvertValue(
            JsonSerializer.SerializeToElement("2026-07-13T20:30:00Z"), "TIMESTAMPTZ"));

        Assert.Equal(uuid, parsedUuid);
        Assert.Equal(DateTimeKind.Unspecified, timestamp.Kind);
        Assert.Equal(new DateTime(2026, 7, 13, 20, 30, 0, DateTimeKind.Unspecified), timestamp);
        Assert.Equal(DateTimeKind.Utc, timestampTz.Kind);
        Assert.Equal(new DateTime(2026, 7, 13, 20, 30, 0, DateTimeKind.Utc), timestampTz);
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
