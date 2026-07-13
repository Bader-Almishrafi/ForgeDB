using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services;
using ForgeDB.API.Services.Generators;
using Microsoft.EntityFrameworkCore;

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

    public async Task<Deployment> AddRunningAsync(Deployment deployment, CancellationToken cancellationToken = default)
    {
        _context.Deployments.Add(deployment);
        await _context.SaveChangesAsync(cancellationToken);
        return deployment;
    }

    public async Task MarkSucceededAsync(int deploymentId, Dictionary<string, int> insertedRowCounts, List<string> createdTables, CancellationToken cancellationToken = default)
    {
        var deployment = await _context.Deployments.FirstAsync(item => item.Id == deploymentId, cancellationToken);
        deployment.Status = DeploymentStatus.Succeeded;
        deployment.CompletedAt = DateTime.UtcNow;
        deployment.CreatedTablesJson = System.Text.Json.JsonSerializer.Serialize(createdTables);
        deployment.InsertedRowCountsJson = System.Text.Json.JsonSerializer.Serialize(insertedRowCounts);
        deployment.TotalRowsInserted = insertedRowCounts.Values.Sum();
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task MarkFailedAsync(int deploymentId, string errorMessage, CancellationToken cancellationToken = default)
    {
        // Runs after the deployment transaction has already been rolled back, and must succeed
        // independently of it so the failure is never silently lost.
        var deployment = await _context.Deployments.FirstAsync(item => item.Id == deploymentId, cancellationToken);
        deployment.Status = DeploymentStatus.Failed;
        deployment.CompletedAt = DateTime.UtcNow;
        deployment.ErrorMessage = errorMessage;
        await _context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<Deployment>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default) =>
        await _context.Deployments.AsNoTracking()
            .Where(deployment => deployment.ProjectId == projectId)
            .OrderByDescending(deployment => deployment.StartedAt)
            .ToListAsync(cancellationToken);

    public Task<Deployment?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default) =>
        _context.Deployments.AsNoTracking()
            .Where(deployment => deployment.ProjectId == projectId)
            .OrderByDescending(deployment => deployment.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<Dictionary<string, int>> ExecuteDeploymentTransactionAsync(
        string schemaName,
        string ddlSql,
        IReadOnlyList<TableInsertPlan> insertPlans,
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
            + quotedSchema + "; SET search_path TO " + quotedSchema + ", public;";
        await _context.Database.ExecuteSqlRawAsync(createSchemaSql, cancellationToken);

        if (!string.IsNullOrWhiteSpace(ddlSql))
        {
            await _context.Database.ExecuteSqlRawAsync(ddlSql, cancellationToken);
        }

        foreach (var plan in insertPlans)
        {
            var tableRef = DeploymentPlanBuilder.QuoteSchemaQualified(schemaName, plan.TableName);
            var columnList = string.Join(", ", plan.ColumnNames.Select(SqlIdentifiers.QuoteIfNeeded));
            var placeholders = string.Join(", ", Enumerable.Range(0, plan.ColumnNames.Count).Select(index => "{" + index + "}"));
            var insertSql = plan.ColumnNames.Count > 0
                ? $"INSERT INTO {tableRef} ({columnList}) VALUES ({placeholders})"
                : null;

            var inserted = 0;
            if (insertSql is not null)
            {
                foreach (var row in plan.Rows)
                {
                    var parameters = row.Select((value, index) => value is DBNull
                        ? (object)DeploymentPlanBuilder.CreateDbNullParameter(plan.ColumnSqlTypes[index], index)
                        : value).ToArray();
                    await _context.Database.ExecuteSqlRawAsync(insertSql, parameters, cancellationToken);
                    inserted++;
                }
            }

            rowCounts[plan.TableName] = inserted;
        }

        await transaction.CommitAsync(cancellationToken);
        return rowCounts;
    }
}
