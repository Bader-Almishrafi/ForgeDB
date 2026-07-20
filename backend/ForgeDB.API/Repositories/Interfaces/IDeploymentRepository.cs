using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Repositories.Interfaces;

public sealed record TableInsertPlan(
    string TableName,
    IReadOnlyList<string> ColumnNames,
    IReadOnlyList<string> ColumnSqlTypes,
    IReadOnlyList<object[]> Rows)
{
    public IReadOnlyList<string> IdentityColumnNames { get; init; } = Array.Empty<string>();
}

public sealed class DeploymentHistoryData
{
    public int Id { get; init; }
    public int ProjectId { get; init; }
    public int DesignRevision { get; init; }
    public string SchemaName { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string? ErrorMessage { get; init; }
    public string CreatedTablesJson { get; init; } = "[]";
    public string InsertedRowCountsJson { get; init; } = "{}";
    public int TablesCreated { get; init; }
    public int TotalRowsInserted { get; init; }
    public int RelationshipsCreated { get; init; }
    public int FailedRows { get; init; }
    public bool SchemaSqlAvailable { get; init; }
    public bool SeedSqlAvailable { get; init; }
    public bool DeploySqlAvailable { get; init; }
    public DateTime StartedAt { get; init; }
    public DateTime? CompletedAt { get; init; }
}

public interface IDeploymentRepository
{
    Task<Project?> GetOwnedProjectAsync(int projectId, int userId, CancellationToken cancellationToken = default);
    Task<bool> HasRunningAsync(int projectId, CancellationToken cancellationToken = default);
    Task<Deployment> AddRunningAsync(Deployment deployment, CancellationToken cancellationToken = default);
    Task MarkSucceededAsync(int deploymentId, Dictionary<string, int> insertedRowCounts, List<string> createdTables, int relationshipsCreated, CancellationToken cancellationToken = default);
    Task MarkFailedAsync(int deploymentId, string errorMessage, int failedRows, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<DeploymentHistoryData>> GetHistoryAsync(int projectId, CancellationToken cancellationToken = default);
    Task<Deployment?> GetLatestAsync(int projectId, CancellationToken cancellationToken = default);
    Task<Deployment?> GetAsync(int projectId, int deploymentId, CancellationToken cancellationToken = default);

    /// <summary>Runs schema (re)creation, DDL, and cleaned-row inserts inside one transaction that
    /// is fully committed on success or fully rolled back if any statement throws. Returns the
    /// number of rows actually inserted per table (only meaningful when the call returns without
    /// throwing, since a mid-way failure rolls back everything).</summary>
    Task<Dictionary<string, int>> ExecuteDeploymentTransactionAsync(
        string schemaName,
        string preSeedDdlSql,
        IReadOnlyList<TableInsertPlan> insertPlans,
        string postSeedDdlSql,
        CancellationToken cancellationToken = default);
}
