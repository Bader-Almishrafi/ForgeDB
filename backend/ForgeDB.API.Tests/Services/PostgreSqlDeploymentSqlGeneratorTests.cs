using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;

namespace ForgeDB.API.Tests.Services;

public class PostgreSqlDeploymentSqlGeneratorTests
{
    [Fact]
    public void SeedSql_FormatsFinalizedValuesWithoutLosingMeaning()
    {
        var plans = new[]
        {
            new TableInsertPlan(
                "order",
                new[] { "name", "notes", "active", "created", "amount", "empty", "path" },
                new[] { "TEXT", "TEXT", "BOOLEAN", "DATE", "NUMERIC", "TEXT", "TEXT" },
                new object[][]
                {
                    new object[] { "Sara O'Connor – سارة", DBNull.Value, true, new DateOnly(2026, 7, 15), 19.95m, "", @"C:\data" }
                })
        };

        var sql = PostgreSqlDeploymentSqlGenerator.GenerateSeedSql("project schema", plans);

        Assert.Contains("\"project schema\".\"order\"", sql);
        Assert.Contains("E'Sara O''Connor – سارة'", sql);
        Assert.Contains("NULL", sql);
        Assert.Contains("TRUE", sql);
        Assert.Contains("'2026-07-15'::date", sql);
        Assert.Contains("19.95", sql);
        Assert.Contains("E''", sql);
        Assert.Contains(@"E'C:\\data'", sql);
    }

    [Fact]
    public void SeedSql_ContainsEveryDuplicateFinalizedRow_InParentBeforeChildOrder()
    {
        var plans = new[]
        {
            Plan("customers", new object[] { 1, "Ahmed" }, new object[] { 1, "Ahmed" }),
            Plan("orders", new object[] { 10, 1 }, new object[] { 11, 1 })
        };

        var sql = PostgreSqlDeploymentSqlGenerator.GenerateSeedSql("forgedb_project_7", plans);

        Assert.True(sql.IndexOf("\"customers\"", StringComparison.Ordinal) < sql.IndexOf("\"orders\"", StringComparison.Ordinal));
        Assert.Equal(2, CountOccurrences(sql, "(1, E'Ahmed')"));
        Assert.Contains("(10, 1)", sql);
        Assert.Contains("(11, 1)", sql);
    }

    [Fact]
    public void EmptyFinalizedData_ProducesExecutableSchemaSeedAndDeployFiles()
    {
        const string ddl = "BEGIN;\nCREATE TABLE customers (id INTEGER PRIMARY KEY);\nCOMMIT;\n";
        var artifacts = PostgreSqlDeploymentSqlGenerator.Generate(
            "forgedb_project_9",
            ddl,
            new[] { new TableInsertPlan("customers", new[] { "id" }, new[] { "INTEGER" }, Array.Empty<object[]>()) });

        Assert.Contains("CREATE TABLE customers", artifacts.SchemaSql);
        Assert.Contains("-- No finalized rows to seed.", artifacts.SeedSql);
        Assert.StartsWith("BEGIN;", artifacts.SeedSql);
        Assert.EndsWith("COMMIT;" + Environment.NewLine, artifacts.SeedSql);
        Assert.Contains("-- No finalized rows to seed.", artifacts.DeploySql);
    }

    [Fact]
    public void DeploySql_SeedsRowsBeforeForeignKeysThatRequireDeferral()
    {
        const string ddl = """
            BEGIN;
            CREATE TABLE a (b_id INTEGER);
            CREATE TABLE b (a_id INTEGER);
            ALTER TABLE a ADD CONSTRAINT fk_a_b FOREIGN KEY (b_id) REFERENCES b (a_id);
            COMMIT;
            """;
        var artifacts = PostgreSqlDeploymentSqlGenerator.Generate(
            "forgedb_project_1",
            ddl,
            new[] { new TableInsertPlan("a", new[] { "b_id" }, new[] { "INTEGER" }, new object[][] { new object[] { 2 } }) });

        var insertAt = artifacts.DeploySql.IndexOf("INSERT INTO", StringComparison.Ordinal);
        var constraintAt = artifacts.DeploySql.IndexOf("ALTER TABLE", StringComparison.Ordinal);
        Assert.True(insertAt > 0 && constraintAt > insertAt);
        Assert.DoesNotContain("ALTER TABLE", artifacts.PreSeedDdlSql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ALTER TABLE", artifacts.PostSeedDdlSql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DeploySql_DefersInlineForeignKeysUntilAfterParentAndChildRows()
    {
        var customers = new DesignTable { Id = 1, Name = "customers" };
        var orders = new DesignTable { Id = 2, Name = "orders" };
        var customerId = new DesignColumn { Id = 11, DesignTableId = 1, DesignTable = customers, Name = "id" };
        var orderCustomerId = new DesignColumn { Id = 21, DesignTableId = 2, DesignTable = orders, Name = "customer_id" };
        var relationship = new DesignRelationship
        {
            Id = 31,
            FromColumnId = orderCustomerId.Id,
            FromColumn = orderCustomerId,
            ToColumnId = customerId.Id,
            ToColumn = customerId,
            OnDelete = DesignOnDelete.Cascade,
        };
        const string ddl = """
            BEGIN;
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY
            );
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY,
                customer_id INTEGER NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
            );
            COMMIT;
            """;

        var artifacts = PostgreSqlDeploymentSqlGenerator.Generate(
            "forgedb_project_2",
            ddl,
            new[]
            {
                new TableInsertPlan("customers", new[] { "id" }, new[] { "INTEGER" }, new object[][] { new object[] { 1 } }),
                new TableInsertPlan("orders", new[] { "id", "customer_id" }, new[] { "INTEGER", "INTEGER" }, new object[][] { new object[] { 4, 1 } }),
            },
            new[] { relationship });

        Assert.DoesNotContain("FOREIGN KEY", artifacts.PreSeedDdlSql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("customer_id INTEGER NOT NULL,\n);", artifacts.PreSeedDdlSql, StringComparison.Ordinal);
        Assert.Contains("ADD CONSTRAINT \"fk_orders_customer_id\"", artifacts.PostSeedDdlSql);
        Assert.True(
            artifacts.DeploySql.LastIndexOf("INSERT INTO", StringComparison.Ordinal)
            < artifacts.DeploySql.IndexOf("ALTER TABLE", StringComparison.Ordinal));
    }

    [Fact]
    public void SeedSql_BatchesLargeFinalizedDatasets()
    {
        var rows = Enumerable.Range(1, PostgreSqlDeploymentSqlGenerator.InsertBatchSize + 1)
            .Select(value => new object[] { value })
            .ToArray();

        var sql = PostgreSqlDeploymentSqlGenerator.GenerateSeedSql(
            "forgedb_project_5",
            new[] { new TableInsertPlan("items", new[] { "id" }, new[] { "INTEGER" }, rows) });

        Assert.Equal(2, CountOccurrences(sql, "INSERT INTO"));
        Assert.Contains($"({PostgreSqlDeploymentSqlGenerator.InsertBatchSize + 1})", sql);
    }

    [Fact]
    public void SeedSql_SynchronizesExplicitIdentityValues()
    {
        var plan = new TableInsertPlan(
            "customers",
            new[] { "id", "name" },
            new[] { "INTEGER", "TEXT" },
            new object[][] { new object[] { 41, "Ahmed" } })
        {
            IdentityColumnNames = new[] { "id" }
        };

        var sql = PostgreSqlDeploymentSqlGenerator.GenerateSeedSql("forgedb_project_4", new[] { plan });

        Assert.Contains("(41, E'Ahmed')", sql);
        Assert.Contains("pg_get_serial_sequence(E'\"forgedb_project_4\".\"customers\"', E'id')", sql);
        Assert.Contains("MAX(\"id\")", sql);
    }

    private static TableInsertPlan Plan(string table, params object[][] rows) =>
        new(table, new[] { "id", "value" }, new[] { "INTEGER", "TEXT" }, rows);

    private static int CountOccurrences(string value, string fragment) =>
        (value.Length - value.Replace(fragment, string.Empty, StringComparison.Ordinal).Length) / fragment.Length;
}
