using System.Text.Json;
using ForgeDB.API.Data;
using ForgeDB.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Services;

/// <summary>
/// One-time startup migration: before Phase 1, relationship-suggestion accept/reject decisions
/// were stored as JSON inside Project.DashboardConfig (see the now-removed
/// ProjectService.SaveRelationshipDecisionAsync). This hosted service runs once at app startup,
/// reads every project's DashboardConfig, and upserts each stored decision into the new
/// RelationshipSuggestion table. It is idempotent: each row is guarded by both an existence
/// check and the table's own unique index on
/// (ProjectId, SourceDatasetId, SourceColumnName, TargetDatasetId, TargetColumnName), so running
/// it again (e.g. on every app restart) never creates duplicates. Project.DashboardConfig itself
/// is left untouched — this is a read-only migration of its content, not a column drop.
/// </summary>
public class LegacySuggestionBackfillService : IHostedService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<LegacySuggestionBackfillService> _logger;

    public LegacySuggestionBackfillService(IServiceProvider serviceProvider, ILogger<LegacySuggestionBackfillService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        // DashboardConfig is a jsonb column: comparing it to a string literal (even for
        // inequality) makes Postgres try to parse the literal as JSON, so filter on nullness
        // only here and treat blank/whitespace values as "nothing to migrate" in memory below.
        var projects = await context.Projects
            .Where(project => project.DashboardConfig != null)
            .ToListAsync(cancellationToken);

        if (projects.Count == 0)
        {
            return;
        }

        var validDatasetIds = (await context.Datasets.Select(dataset => dataset.Id).ToListAsync(cancellationToken)).ToHashSet();
        var migratedCount = 0;

        foreach (var project in projects)
        {
            List<LegacyRelationshipDecision> decisions;
            try
            {
                var config = JsonSerializer.Deserialize<LegacyWorkspaceConfig>(project.DashboardConfig!, JsonOptions);
                decisions = config?.RelationshipDecisions ?? new List<LegacyRelationshipDecision>();
            }
            catch (JsonException)
            {
                continue;
            }

            foreach (var decision in decisions)
            {
                if (decision.FromDatasetId <= 0 || decision.ToDatasetId <= 0
                    || string.IsNullOrWhiteSpace(decision.FromColumn) || string.IsNullOrWhiteSpace(decision.ToColumn)
                    || !validDatasetIds.Contains(decision.FromDatasetId) || !validDatasetIds.Contains(decision.ToDatasetId))
                {
                    continue;
                }

                var alreadyMigrated = await context.RelationshipSuggestions.AnyAsync(
                    suggestion => suggestion.ProjectId == project.Id
                        && suggestion.SourceDatasetId == decision.FromDatasetId
                        && suggestion.SourceColumnName == decision.FromColumn
                        && suggestion.TargetDatasetId == decision.ToDatasetId
                        && suggestion.TargetColumnName == decision.ToColumn,
                    cancellationToken);

                if (alreadyMigrated)
                {
                    continue;
                }

                var status = decision.Status is RelationshipSuggestionStatus.Accepted or RelationshipSuggestionStatus.Rejected
                    ? decision.Status
                    : RelationshipSuggestionStatus.Suggested;

                context.RelationshipSuggestions.Add(new RelationshipSuggestion
                {
                    ProjectId = project.Id,
                    SourceDatasetId = decision.FromDatasetId,
                    SourceColumnName = decision.FromColumn,
                    TargetDatasetId = decision.ToDatasetId,
                    TargetColumnName = decision.ToColumn,
                    Score = 0.5,
                    EvidenceJson = "{\"source\":\"legacy-dashboard-config-backfill\"}",
                    Status = status,
                    DecidedAt = status == RelationshipSuggestionStatus.Suggested ? null : decision.UpdatedAt,
                    CreatedAt = decision.UpdatedAt == default ? DateTime.UtcNow : decision.UpdatedAt
                });

                migratedCount++;
            }
        }

        if (migratedCount > 0)
        {
            await context.SaveChangesAsync(cancellationToken);
        }

        _logger.LogInformation(
            "Legacy relationship-suggestion backfill migrated {Count} row(s) from Project.DashboardConfig into RelationshipSuggestion.",
            migratedCount);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private sealed class LegacyWorkspaceConfig
    {
        public List<LegacyRelationshipDecision> RelationshipDecisions { get; set; } = new();
    }

    private sealed class LegacyRelationshipDecision
    {
        public string SuggestionId { get; set; } = string.Empty;
        public int FromDatasetId { get; set; }
        public string FromTable { get; set; } = string.Empty;
        public string FromColumn { get; set; } = string.Empty;
        public int ToDatasetId { get; set; }
        public string ToTable { get; set; } = string.Empty;
        public string ToColumn { get; set; } = string.Empty;
        public string RelationshipType { get; set; } = "many-to-one";
        public string Status { get; set; } = "suggested";
        public DateTime UpdatedAt { get; set; }
    }
}
