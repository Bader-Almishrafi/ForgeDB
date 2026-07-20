using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Generators;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ForgeDB.API.Repositories;

public class DeploymentRepository : IDeploymentRepository
{
    private readonly ForgeDbContext _context;

    public DeploymentRepository(ForgeDbContext context)
    {
        _context = context;
    }

    public Task<Project?> GetOwnedProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default) =>
        _context.Projects.AsNoTracking().FirstOrDefaultAsync(project => project.Id == projectId && project.UserId == userId, cancellationToken);

    public Task<bool> HasRunningAsync(int projectId, CancellationToken cancellationToken = default) =>
        _context.Deployments.AsNoTracking()
            .AnyAsync(deployment => deployment.ProjectId == projectId && deployment.Status == DeploymentStatus.Running, cancellationToken);

    public async Task<Deployment> AddRunningAsync(Deployment deployment, CancellationToken cancellationToken = default)
    {
        _context.Deployments.Add(deployment);
        try
        {
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsRunningDeploymentConflict(exception))
        {
            _context.Entry(deployment).State = EntityState.Detached;
            throw new DeploymentInProgressException();
        }
        return deployment;
    }

    private static bool IsRunningDeploymentConflict(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "UX_deployments_ProjectId_Running"
        };

    public async Task MarkSucceededAsync(
        int deploymentId,
        Dictionary<string, int> insertedRowCounts,
        List<string> createdTables,
        int relationshipsCreated,
        CancellationToken cancellationToken = default)
    {
        var deployment = await _context.Deployments.FirstAsync(item => item.Id == deploymentId, cancellationToken);
        deployment.Status = DeploymentStatus.Completed;
        deployment.CompletedAt = DateTime.UtcNow;
        deployment.CreatedTablesJson = System.Text.Json.JsonSerializer.Serialize(createdTables);
        deployment.InsertedRowCountsJson = System.Text.Json.JsonSerializer.Serialize(insertedRowCounts);
        deployment.TablesCreated = createdTables.Count;
        deployment.TotalRowsInserted = insertedRowCounts.Values.Sum();
        deployment.RelationshipsCreated = relationshipsCreated;
        deployment.FailedRows = 0;
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkFailedAsync(int deploymentId, string errorMessage, int failedRows, CancellationToken cancellationToken = default)
    {
        // Runs after the deployment transaction has already been rolled back, and must succeed
        // independently of it so the failure is never silently lost.
        var deployment = await _context.Deployments.FirstAsync(item => item.Id == deploymentId, cancellationToken);
        deployment.Status = DeploymentStatus.Failed;
        deployment.CompletedAt = DateTime.UtcNow;
        deployment.ErrorMessage = errorMessage;
        deployment.TablesCreated = 0;
        deployment.TotalRowsInserted = 0;
        deployment.RelationshipsCreated = 0;
        deployment.FailedRows = failedRows;
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DeploymentHistoryData>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default) =>
        await _context.Deployments.AsNoTracking()
            .Where(deployment => deployment.ProjectId == projectId)
            .OrderByDescending(deployment => deployment.StartedAt)
            .ThenByDescending(deployment => deployment.Id)
            .Select(deployment => new DeploymentHistoryData
            {
                Id = deployment.Id,
                ProjectId = deployment.ProjectId,
                DesignRevision = deployment.DesignRevision,
                SchemaName = deployment.SchemaName,
                Status = deployment.Status,
                ErrorMessage = deployment.ErrorMessage,
                CreatedTablesJson = deployment.CreatedTablesJson,
                InsertedRowCountsJson = deployment.InsertedRowCountsJson,
                TablesCreated = deployment.TablesCreated,
                TotalRowsInserted = deployment.TotalRowsInserted,
                RelationshipsCreated = deployment.RelationshipsCreated,
                FailedRows = deployment.FailedRows,
                SchemaSqlAvailable = deployment.GeneratedSql != string.Empty,
                SeedSqlAvailable = deployment.SeedSql != string.Empty,
                DeploySqlAvailable = deployment.DeploySql != string.Empty,
                StartedAt = deployment.StartedAt,
                CompletedAt = deployment.CompletedAt
            })
            .ToListAsync(cancellationToken);

    public Task<Deployment?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default) =>
        _context.Deployments.AsNoTracking()
            .Where(deployment => deployment.ProjectId == projectId)
            .OrderByDescending(deployment => deployment.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<Deployment?> GetAsync(int projectId, int deploymentId, CancellationToken cancellationToken = default) =>
        _context.Deployments.AsNoTracking()
            .FirstOrDefaultAsync(deployment => deployment.ProjectId == projectId && deployment.Id == deploymentId, cancellationToken);

    public async Task<Dictionary<string, int>> ExecuteDeploymentTransactionAsync(
        string schemaName,
        string preSeedDdlSql,
        IReadOnlyList<TableInsertPlan> insertPlans,
        string postSeedDdlSql,
        CancellationToken cancellationToken = default)
    {
        var quotedSchema = SqlIdentifiers.Quote(schemaName);
        var rowCounts = new Dictionary<string, int>();

        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

        // Schema/table identifiers cannot be bound as query parameters in Postgres DDL (only
        // values can); SqlIdentifiers.Quote() is the sanitization step instead. Built with plain
        // concatenation (not string interpolation) since ExecuteSqlRaw's analyzer cannot tell an
        // already-quoted identifier apart from an unsanitized value spliced into the command text.
        var createSchemaSql = "DROP SCHEMA IF EXISTS " + quotedSchema + " CASCADE; CREATE SCHEMA "
            + quotedSchema + "; SET LOCAL search_path TO " + quotedSchema + ", public;";
        await _context.Database.ExecuteSqlRawAsync(createSchemaSql, cancellationToken);

        if (!string.IsNullOrWhiteSpace(preSeedDdlSql))
        {
            await _context.Database.ExecuteSqlRawAsync(preSeedDdlSql, cancellationToken);
        }

        foreach (var (plan, tableIndex) in insertPlans.Select((value, index) => (value, index)))
        {
            var tableRef = DeploymentPlanBuilder.QuoteSchemaQualified(schemaName, plan.TableName);
            var columnList = string.Join(", ", plan.ColumnNames.Select(SqlIdentifiers.QuoteIfNeeded));

            var inserted = 0;
            if (plan.ColumnNames.Count > 0)
            {
                foreach (var (row, rowIndex) in plan.Rows.Select((value, index) => (value, index)))
                {
                    var parameters = row.Select((value, columnIndex) => DeploymentPlanBuilder.CreateParameter(
                        plan.ColumnSqlTypes[columnIndex],
                        DeploymentPlanBuilder.BuildParameterName(tableIndex, rowIndex, columnIndex),
                        value)).ToArray();
                    var placeholders = string.Join(", ", parameters.Select(parameter => "@" + parameter.ParameterName));
                    var insertSql = $"INSERT INTO {tableRef} ({columnList}) VALUES ({placeholders})";
                    await _context.Database.ExecuteSqlRawAsync(insertSql, parameters.Cast<object>().ToArray(), cancellationToken);
                    inserted++;
                }
            }

            rowCounts[plan.TableName] = inserted;

            foreach (var identityColumn in plan.IdentityColumnNames)
            {
                var resetSequenceSql = PostgreSqlDeploymentSqlGenerator.BuildIdentitySequenceSql(
                    schemaName,
                    plan.TableName,
                    identityColumn);
                await _context.Database.ExecuteSqlRawAsync(resetSequenceSql, cancellationToken);
            }
        }

        if (!string.IsNullOrWhiteSpace(postSeedDdlSql))
        {
            await _context.Database.ExecuteSqlRawAsync(postSeedDdlSql, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return rowCounts;
    }
}
