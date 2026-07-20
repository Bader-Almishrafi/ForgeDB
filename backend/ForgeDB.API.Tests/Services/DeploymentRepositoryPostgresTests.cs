using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ForgeDB.API.Tests.Services;

public class DeploymentRepositoryPostgresTests
{
    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task AbandonedRunningDeploymentIsFailedAtomicallyButRecentRunRemainsProtected()
    {
        var connectionString = GetConnectionString();
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        var (userId, projectIds) = await CreateOwnedProjectsAsync(options, 2);
        var staleProjectId = projectIds[0];
        var recentProjectId = projectIds[1];
        var now = DateTime.UtcNow;

        try
        {
            await using (var seedContext = new ForgeDbContext(options))
            {
                seedContext.Deployments.AddRange(
                    CreateRunningDeployment(staleProjectId, userId, now.AddMinutes(-31)),
                    CreateRunningDeployment(recentProjectId, userId, now.AddMinutes(-5)));
                await seedContext.SaveChangesAsync();
            }

            await using (var recoveryContext = new ForgeDbContext(options))
            {
                var repository = new DeploymentRepository(recoveryContext);
                var recovered = await repository.FailAbandonedRunningAsync(
                    staleProjectId,
                    now.AddMinutes(-30),
                    "Deployment was abandoned before completion and is no longer considered running.");

                Assert.Equal(1, recovered);
                Assert.False(await repository.HasRunningAsync(staleProjectId));
                await repository.AddRunningAsync(CreateRunningDeployment(staleProjectId, userId, now));
            }

            await using (var recentContext = new ForgeDbContext(options))
            {
                var repository = new DeploymentRepository(recentContext);
                var recovered = await repository.FailAbandonedRunningAsync(
                    recentProjectId,
                    now.AddMinutes(-30),
                    "Deployment was abandoned before completion and is no longer considered running.");

                Assert.Equal(0, recovered);
                Assert.True(await repository.HasRunningAsync(recentProjectId));
                await Assert.ThrowsAsync<DeploymentInProgressException>(() =>
                    repository.AddRunningAsync(CreateRunningDeployment(recentProjectId, userId, now)));
            }

            await using var verificationContext = new ForgeDbContext(options);
            var staleHistory = await verificationContext.Deployments.AsNoTracking()
                .Where(deployment => deployment.ProjectId == staleProjectId)
                .OrderBy(deployment => deployment.StartedAt)
                .ToListAsync();
            Assert.Equal([DeploymentStatus.Failed, DeploymentStatus.Running], staleHistory.Select(item => item.Status));
            Assert.Equal(
                "Deployment was abandoned before completion and is no longer considered running.",
                staleHistory[0].ErrorMessage);
            Assert.NotNull(staleHistory[0].CompletedAt);
        }
        finally
        {
            await DeleteOwnedProjectsAsync(options, userId, projectIds);
        }
    }

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task ConcurrentRunningDeploymentInsertsAllowOnePerProjectAndIndependentProjects()
    {
        var connectionString = GetConnectionString();
        var options = new DbContextOptionsBuilder<ForgeDbContext>()
            .UseNpgsql(connectionString)
            .Options;
        var (userId, projectIds) = await CreateOwnedProjectsAsync(options, 3);

        try
        {
            var sameProjectResults = await Task.WhenAll(
                TryAddRunningAsync(options, CreateRunningDeployment(projectIds[0], userId, DateTime.UtcNow)),
                TryAddRunningAsync(options, CreateRunningDeployment(projectIds[0], userId, DateTime.UtcNow)));

            Assert.Single(sameProjectResults, result => result == "added");
            Assert.Single(sameProjectResults, result => result == DeploymentInProgressException.ErrorCode);

            var independentResults = await Task.WhenAll(
                TryAddRunningAsync(options, CreateRunningDeployment(projectIds[1], userId, DateTime.UtcNow)),
                TryAddRunningAsync(options, CreateRunningDeployment(projectIds[2], userId, DateTime.UtcNow)));

            Assert.All(independentResults, result => Assert.Equal("added", result));
        }
        finally
        {
            await DeleteOwnedProjectsAsync(options, userId, projectIds);
        }
    }

    [Fact]
    [Trait("Category", "PostgreSQLIntegration")]
    public async Task SuccessfulDeploymentCountsPersistAndFailedReplacementRollsBackToPriorSchema()
    {
        var connectionString = GetConnectionString();
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

    private static string GetConnectionString() =>
        Environment.GetEnvironmentVariable("FORGEDB_TEST_POSTGRES")
        ?? "Host=localhost;Port=5433;Database=forgedb;Username=postgres;Password=postgres";

    private static Deployment CreateRunningDeployment(int projectId, int userId, DateTime startedAt) => new()
    {
        ProjectId = projectId,
        DesignRevision = 1,
        SchemaName = $"forgedb_project_{projectId}",
        Status = DeploymentStatus.Running,
        TriggeredByUserId = userId,
        StartedAt = startedAt
    };

    private static async Task<(int UserId, int[] ProjectIds)> CreateOwnedProjectsAsync(
        DbContextOptions<ForgeDbContext> options,
        int projectCount)
    {
        await using var context = new ForgeDbContext(options);
        Assert.True(await context.Database.CanConnectAsync(),
            "The PostgreSQL integration test requires ForgeDB's local Docker database on port 5433 or FORGEDB_TEST_POSTGRES.");
        var user = new User
        {
            FirstName = "Deployment",
            LastName = "Integration",
            Email = $"deployment-{Guid.NewGuid():N}@example.test",
            PasswordHash = "not-used",
            Role = "User",
            CreatedAt = DateTime.UtcNow
        };
        var projects = Enumerable.Range(1, projectCount)
            .Select(index => new Project
            {
                User = user,
                Name = $"Deployment integration {index}",
                CreatedAt = DateTime.UtcNow
            })
            .ToList();
        context.Projects.AddRange(projects);
        await context.SaveChangesAsync();
        return (user.Id, projects.Select(project => project.Id).ToArray());
    }

    private static async Task<string> TryAddRunningAsync(
        DbContextOptions<ForgeDbContext> options,
        Deployment deployment)
    {
        await using var context = new ForgeDbContext(options);
        var repository = new DeploymentRepository(context);
        try
        {
            await repository.AddRunningAsync(deployment);
            return "added";
        }
        catch (DeploymentInProgressException)
        {
            return DeploymentInProgressException.ErrorCode;
        }
    }

    private static async Task DeleteOwnedProjectsAsync(
        DbContextOptions<ForgeDbContext> options,
        int userId,
        IReadOnlyCollection<int> projectIds)
    {
        await using var context = new ForgeDbContext(options);
        await context.Projects.Where(project => projectIds.Contains(project.Id)).ExecuteDeleteAsync();
        await context.Users.Where(user => user.Id == userId).ExecuteDeleteAsync();
    }
}
