using ForgeDB.API.Data;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ForgeDB.API.Tests.Services;

public class DeploymentRepositoryPostgresTests
{
    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task SuccessfulDeploymentCountsPersistAndFailedReplacementRollsBackToPriorSchema()
    {
        var connectionString = Environment.GetEnvironmentVariable("FORGEDB_TEST_POSTGRES")
            ?? "Host=localhost;Port=5433;Database=forgedb;Username=postgres;Password=postgres";
        var schema = $"forgedb_test_{Guid.NewGuid():N}";
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        await using var context = new ForgeDbContext(options);
        Assert.True(await context.Database.CanConnectAsync(),
            "The PostgreSQL integration test requires ForgeDB's local Docker database on port 5433 or FORGEDB_TEST_POSTGRES.");
        var repository = new DeploymentRepository(context);
        const string ddl = """
            CREATE TABLE parent_rows (
                id INTEGER PRIMARY KEY,
                amount NUMERIC,
                optional_count INTEGER,
                occurred_on DATE,
                occurred_at TIMESTAMP
            );
            CREATE TABLE child_rows (
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL REFERENCES parent_rows(id)
            );
            """;

        var successfulPlans = new List<TableInsertPlan>
        {
            new(
                "parent_rows",
                ["id", "amount", "optional_count", "occurred_on", "occurred_at"],
                ["INTEGER", "NUMERIC", "INTEGER", "DATE", "TIMESTAMP"],
                [
                    [1, DBNull.Value, DBNull.Value, DBNull.Value, DBNull.Value],
                    [2, 99999.99m, 42, new DateOnly(2026, 7, 13), new DateTime(2026, 7, 13, 8, 30, 0, DateTimeKind.Unspecified)]
                ]),
            new(
                "child_rows",
                ["id", "parent_id"],
                ["INTEGER", "INTEGER"],
                [[10, 1], [11, 2]])
        };

        try
        {
            var counts = await repository.ExecuteDeploymentTransactionAsync(schema, ddl, successfulPlans, string.Empty);

            Assert.Equal(2, counts["parent_rows"]);
            Assert.Equal(2, counts["child_rows"]);
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            Assert.Equal(2L, await ScalarAsync<long>(connection, $"SELECT count(*) FROM \"{schema}\".parent_rows"));
            Assert.Equal(1L, await ScalarAsync<long>(connection,
                $"SELECT count(*) FROM \"{schema}\".parent_rows WHERE amount IS NULL AND optional_count IS NULL AND occurred_on IS NULL AND occurred_at IS NULL"));
            Assert.Equal(99999.99m, await ScalarAsync<decimal>(connection,
                $"SELECT amount FROM \"{schema}\".parent_rows WHERE id = 2"));
            Assert.Equal(new DateTime(2026, 7, 13, 8, 30, 0), await ScalarAsync<DateTime>(connection,
                $"SELECT occurred_at FROM \"{schema}\".parent_rows WHERE id = 2"));

            var failingPlans = new List<TableInsertPlan>
            {
                successfulPlans[0],
                new(
                    "child_rows",
                    ["id", "parent_id"],
                    ["INTEGER", "INTEGER"],
                    [[20, 999]])
            };

            var failure = await Assert.ThrowsAsync<PostgresException>(() =>
                repository.ExecuteDeploymentTransactionAsync(schema, ddl, failingPlans, string.Empty));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, failure.SqlState);

            // DROP/CREATE and all new inserts were in the failed transaction, so the committed
            // deployment from above must still be present byte-for-byte after rollback.
            Assert.Equal(2L, await ScalarAsync<long>(connection, $"SELECT count(*) FROM \"{schema}\".parent_rows"));
            Assert.Equal(2L, await ScalarAsync<long>(connection, $"SELECT count(*) FROM \"{schema}\".child_rows"));
            Assert.Equal(99999.99m, await ScalarAsync<decimal>(connection,
                $"SELECT amount FROM \"{schema}\".parent_rows WHERE id = 2"));
        }
        finally
        {
            await using var cleanup = new NpgsqlConnection(connectionString);
            await cleanup.OpenAsync();
            await using var command = new NpgsqlCommand($"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE", cleanup);
            await command.ExecuteNonQueryAsync();
        }
    }

    private static async Task<T> ScalarAsync<T>(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        var value = await command.ExecuteScalarAsync();
        return Assert.IsType<T>(value);
    }
}
