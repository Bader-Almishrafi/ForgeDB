using System.Text.Json;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;
using ForgeDB.API.Services.Exceptions;
using ForgeDB.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ForgeDB.API.Services;

/// <summary>
/// Heuristic relationship-suggestion detection, ported from the logic that used to live only in
/// ProjectService (computed live, decisions stored as JSON on Project.DashboardConfig). The
/// scoring algorithm itself is unchanged; only persistence changed — results are now upserted
/// into the RelationshipSuggestion table keyed by (project, source dataset/column, target
/// dataset/column), so a rejected suggestion can never be silently resurrected by a later detect.
/// </summary>
public class RelationshipDetectionService : IRelationshipDetectionService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IDatasetRepository _datasetRepository;
    private readonly IRelationshipSuggestionRepository _suggestionRepository;
    private readonly IDesignRepository _designRepository;

    public RelationshipDetectionService(
        IDatasetRepository datasetRepository,
        IRelationshipSuggestionRepository suggestionRepository,
        IDesignRepository designRepository)
    {
        _datasetRepository = datasetRepository;
        _suggestionRepository = suggestionRepository;
        _designRepository = designRepository;
    }

    public async Task<List<RelationshipSuggestionResponseDto>> GetSuggestionsAsync(int projectId, string? status, CancellationToken cancellationToken = default)
    {
        var suggestions = await _suggestionRepository.GetByProjectIdAsync(projectId, status, cancellationToken);
        return suggestions.Select(MapSuggestion).ToList();
    }

    public async Task<List<RelationshipSuggestionResponseDto>> DetectAsync(int projectId, CancellationToken cancellationToken = default)
    {
        if (!await _datasetRepository.ProjectExistsAsync(projectId, cancellationToken))
        {
            throw new KeyNotFoundException("Project not found.");
        }

        var datasets = await _datasetRepository.GetByProjectIdWithRowsAndColumnsAsync(projectId, cancellationToken);
        var design = await _designRepository.GetFullByProjectIdAsync(projectId, track: false, cancellationToken);
        var profiles = datasets
            .SelectMany(dataset => dataset.Columns.Select(column => BuildColumnProfile(dataset, column)))
            .ToList();

        var candidates = new List<Candidate>();
        foreach (var left in profiles)
        {
            foreach (var right in profiles)
            {
                if (left.Dataset.Id >= right.Dataset.Id)
                {
                    continue;
                }

                var candidate = ChooseCandidate(
                    ScoreDirection(left, right),
                    ScoreDirection(right, left),
                    design);
                if (candidate is not null)
                {
                    candidates.Add(candidate);
                }
            }
        }

        foreach (var candidate in candidates)
        {
            var existing = await _suggestionRepository.FindByKeyAsync(
                projectId,
                candidate.SourceDatasetId,
                candidate.SourceColumnName,
                candidate.TargetDatasetId,
                candidate.TargetColumnName,
                cancellationToken);

            if (existing is null)
            {
                // Tracked, not saved — every candidate in this loop commits together in the single
                // SaveChangesAsync below instead of one round trip/transaction per suggestion.
                _suggestionRepository.Add(new RelationshipSuggestion
                {
                    ProjectId = projectId,
                    SourceDatasetId = candidate.SourceDatasetId,
                    SourceColumnName = candidate.SourceColumnName,
                    TargetDatasetId = candidate.TargetDatasetId,
                    TargetColumnName = candidate.TargetColumnName,
                    Score = candidate.Score,
                    EvidenceJson = candidate.EvidenceJson,
                    Status = RelationshipSuggestionStatus.Suggested,
                    CreatedAt = DateTime.UtcNow
                });
            }
            else if (existing.Status == RelationshipSuggestionStatus.Suggested)
            {
                existing.Score = candidate.Score;
                existing.EvidenceJson = candidate.EvidenceJson;
            }
            // Accepted/rejected rows keep everything as-is — detection never downgrades a decision.
        }

        await _suggestionRepository.SaveChangesAsync(cancellationToken);

        return await GetSuggestionsAsync(projectId, status: null, cancellationToken);
    }

    public async Task<AcceptSuggestionResponseDto> AcceptAsync(
        int suggestionId,
        int ifMatchRevision,
        AcceptSuggestionRequestDto? request,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await _designRepository.ExecuteInTransactionAsync(
                () => AcceptCoreAsync(suggestionId, ifMatchRevision, request, cancellationToken),
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            _designRepository.ClearTracking();
            var accepted = await FindAcceptedResponseAsync(suggestionId, cancellationToken);
            if (accepted is not null)
            {
                return accepted;
            }

            var suggestion = await _suggestionRepository.GetByIdAsync(suggestionId, cancellationToken)
                ?? throw new KeyNotFoundException("Relationship suggestion not found.");
            var current = await _designRepository.GetFullByProjectIdAsync(suggestion.ProjectId, track: false, cancellationToken);
            throw new DesignConcurrencyException(current?.Revision ?? ifMatchRevision);
        }
        catch (DbUpdateException exception) when (Validation.DesignRelationshipRules.IsUniqueConstraintViolation(exception))
        {
            _designRepository.ClearTracking();
            var accepted = await FindAcceptedResponseAsync(suggestionId, cancellationToken);
            if (accepted is not null)
            {
                return accepted;
            }

            throw new RelationshipSuggestionConflictException(
                "An identical relationship was created concurrently. Refresh the relationship queue and try again.");
        }
    }

    private async Task<AcceptSuggestionResponseDto> AcceptCoreAsync(
        int suggestionId,
        int ifMatchRevision,
        AcceptSuggestionRequestDto? request,
        CancellationToken cancellationToken)
    {
        var suggestion = await _suggestionRepository.GetByIdAsync(suggestionId, cancellationToken)
            ?? throw new KeyNotFoundException("Relationship suggestion not found.");

        var design = await _designRepository.GetFullByProjectIdAsync(suggestion.ProjectId, track: true, cancellationToken)
            ?? throw new RelationshipSuggestionConflictException("Accepting a suggestion requires a generated design. Call design/generate first.");

        var acceptedRelationship = design.Relationships.FirstOrDefault(relationship => relationship.SuggestionId == suggestion.Id);
        if (acceptedRelationship is not null)
        {
            if (suggestion.Status != RelationshipSuggestionStatus.Accepted)
            {
                suggestion.Status = RelationshipSuggestionStatus.Accepted;
                suggestion.DecidedAt ??= DateTime.UtcNow;
                await _designRepository.SaveChangesAsync(cancellationToken);
            }

            return BuildAcceptResponse(suggestion, acceptedRelationship, design.Revision);
        }

        if (suggestion.Status == RelationshipSuggestionStatus.Rejected)
        {
            throw new RelationshipSuggestionConflictException("This suggestion has already been rejected.");
        }

        if (design.Revision != ifMatchRevision)
        {
            throw new DesignConcurrencyException(design.Revision);
        }

        var (sourceColumn, targetColumn, cardinality, onDelete) = ResolveAcceptedRelationship(design, suggestion, request);
        ValidateAcceptedRelationship(sourceColumn, targetColumn, cardinality, onDelete);

        var relationship = design.Relationships.FirstOrDefault(existing =>
            existing.FromColumnId == sourceColumn.Id
            && existing.ToColumnId == targetColumn.Id
            && string.Equals(existing.Cardinality, cardinality, StringComparison.Ordinal));

        var now = DateTime.UtcNow;
        suggestion.Status = RelationshipSuggestionStatus.Accepted;
        suggestion.DecidedAt ??= now;

        if (relationship is not null)
        {
            relationship.SuggestionId ??= suggestion.Id;
            await _designRepository.SaveChangesAsync(cancellationToken);
            return BuildAcceptResponse(suggestion, relationship, design.Revision);
        }

        relationship = new DesignRelationship
        {
            DesignModelId = design.Id,
            FromColumnId = sourceColumn.Id,
            FromColumn = sourceColumn,
            ToColumnId = targetColumn.Id,
            ToColumn = targetColumn,
            Cardinality = cardinality,
            OnDelete = onDelete,
            Origin = DesignOrigin.AcceptedSuggestion,
            SuggestionId = suggestion.Id
        };

        design.Relationships.Add(relationship);
        design.Revision += 1;
        design.UpdatedAt = now;
        // A new relationship changes what SQL/constraints/ER preview would render, so any prior
        // validation no longer covers the current draft — same invariant SaveAndBuildResponseAsync
        // enforces for every other mutation path (DesignService.cs).
        design.Status = DesignStatus.Draft;
        design.ValidatedAt = null;

        // Single SaveChanges call: the suggestion's Status/DecidedAt and the new
        // DesignRelationship + DesignModel.Revision bump are tracked by this same DbContext
        // (both repositories are resolved from the same request-scoped instance), so they
            // commit together in one transaction — either both land or neither does.
        await _designRepository.SaveChangesAsync(cancellationToken);
        return BuildAcceptResponse(suggestion, relationship, design.Revision);
    }

    /// <summary>Deliberately has no If-Match/revision check, unlike Accept: reject only flips this
    /// suggestion's own Status/DecidedAt and never touches the DesignModel or its Revision, so
    /// there is no design-revision conflict it could ever cause (prompt FIX 3).</summary>
    public async Task<RelationshipSuggestionResponseDto> RejectAsync(int suggestionId, CancellationToken cancellationToken = default)
    {
        var suggestion = await _suggestionRepository.GetByIdAsync(suggestionId, cancellationToken)
            ?? throw new KeyNotFoundException("Relationship suggestion not found.");

        if (suggestion.Status == RelationshipSuggestionStatus.Rejected)
        {
            return MapSuggestion(suggestion);
        }

        if (suggestion.Status == RelationshipSuggestionStatus.Accepted)
        {
            throw new RelationshipSuggestionConflictException("This suggestion has already been accepted.");
        }

        suggestion.Status = RelationshipSuggestionStatus.Rejected;
        suggestion.DecidedAt = DateTime.UtcNow;

        await _suggestionRepository.SaveChangesAsync(cancellationToken);

        return MapSuggestion(suggestion);
    }

    private async Task<AcceptSuggestionResponseDto?> FindAcceptedResponseAsync(
        int suggestionId,
        CancellationToken cancellationToken)
    {
        var suggestion = await _suggestionRepository.GetByIdAsync(suggestionId, cancellationToken);
        if (suggestion?.Status != RelationshipSuggestionStatus.Accepted)
        {
            return null;
        }

        var design = await _designRepository.GetFullByProjectIdAsync(suggestion.ProjectId, track: false, cancellationToken);
        var relationship = design?.Relationships.FirstOrDefault(existing => existing.SuggestionId == suggestionId);
        return design is null || relationship is null
            ? null
            : BuildAcceptResponse(suggestion, relationship, design.Revision);
    }

    private static (DesignColumn Source, DesignColumn Target, string Cardinality, string OnDelete) ResolveAcceptedRelationship(
        DesignModel design,
        RelationshipSuggestion suggestion,
        AcceptSuggestionRequestDto? request)
    {
        var columns = design.Tables.SelectMany(table => table.Columns).ToList();
        var sourceColumn = request?.FromColumnId is int sourceColumnId
            ? columns.FirstOrDefault(column => column.Id == sourceColumnId)
            : FindDesignColumn(design, suggestion.SourceDatasetId, suggestion.SourceColumnName);
        var targetColumn = request?.ToColumnId is int targetColumnId
            ? columns.FirstOrDefault(column => column.Id == targetColumnId)
            : FindDesignColumn(design, suggestion.TargetDatasetId, suggestion.TargetColumnName);

        if (sourceColumn is null || targetColumn is null)
        {
            throw new RelationshipSuggestionConflictException(
                "The accepted relationship must reference source and target columns in the current project design.");
        }

        var cardinality = string.IsNullOrWhiteSpace(request?.Cardinality)
            ? DesignCardinality.ManyToOne
            : request.Cardinality.Trim().ToLowerInvariant();
        var onDelete = string.IsNullOrWhiteSpace(request?.OnDelete)
            ? DesignOnDelete.NoAction
            : request.OnDelete.Trim().ToLowerInvariant();

        return (sourceColumn, targetColumn, cardinality, onDelete);
    }

    private static void ValidateAcceptedRelationship(
        DesignColumn sourceColumn,
        DesignColumn targetColumn,
        string cardinality,
        string onDelete)
    {
        if (sourceColumn.Id == targetColumn.Id)
        {
            throw new RelationshipSuggestionConflictException("The relationship source and target must be different columns.");
        }

        if (!Validation.DesignRelationshipRules.IsValidTarget(targetColumn))
        {
            var target = $"{targetColumn.DesignTable?.Name ?? "unknown"}.{targetColumn.Name}";
            throw new RelationshipSuggestionConflictException(
                $"Relationship target '{target}' is unavailable because it is neither a Primary Key nor Unique column.");
        }

        if (!Validation.DesignRelationshipRules.HaveCompatibleTypes(sourceColumn, targetColumn))
        {
            throw new RelationshipSuggestionConflictException(
                $"Relationship columns have incompatible PostgreSQL types '{sourceColumn.SqlType}' and '{targetColumn.SqlType}'.");
        }

        if (cardinality is not (DesignCardinality.ManyToOne or DesignCardinality.OneToOne))
        {
            throw new RelationshipSuggestionConflictException("Cardinality must be 'many-to-one' or 'one-to-one'.");
        }

        if (onDelete is not (DesignOnDelete.NoAction or DesignOnDelete.Cascade or DesignOnDelete.SetNull))
        {
            throw new RelationshipSuggestionConflictException("On Delete must be 'no-action', 'cascade', or 'set-null'.");
        }
    }

    private static AcceptSuggestionResponseDto BuildAcceptResponse(
        RelationshipSuggestion suggestion,
        DesignRelationship relationship,
        int designRevision)
    {
        return new AcceptSuggestionResponseDto
        {
            Suggestion = MapSuggestion(suggestion),
            Relationship = MapRelationship(relationship),
            DesignRevision = designRevision
        };
    }

    private static DesignColumn? FindDesignColumn(DesignModel design, int sourceDatasetId, string columnName)
    {
        return design.Tables
            .Where(table => table.SourceDatasetId == sourceDatasetId)
            .SelectMany(table => table.Columns)
            .FirstOrDefault(column => string.Equals(column.SourceColumnName, columnName, StringComparison.OrdinalIgnoreCase));
    }

    // ---- heuristic scoring (ported from the pre-Phase-1 ProjectService) ----

    private sealed record DatasetColumnProfile(
        Dataset Dataset,
        DatasetColumn Column,
        string TableName,
        IReadOnlyList<string> Values,
        bool IsUnique,
        bool HasRepeatedValues);

    private sealed record Candidate(
        int SourceDatasetId,
        string SourceColumnName,
        int TargetDatasetId,
        string TargetColumnName,
        double Score,
        string EvidenceJson);

    private static Candidate? ChooseCandidate(Candidate? forward, Candidate? reverse, DesignModel? design)
    {
        if (forward is null)
        {
            return reverse;
        }

        if (reverse is null)
        {
            return forward;
        }

        var forwardTargetsDesignKey = CandidateTargetsDesignKey(forward, design);
        var reverseTargetsDesignKey = CandidateTargetsDesignKey(reverse, design);
        if (forwardTargetsDesignKey != reverseTargetsDesignKey)
        {
            return forwardTargetsDesignKey ? forward : reverse;
        }

        return reverse.Score > forward.Score ? reverse : forward;
    }

    private static bool CandidateTargetsDesignKey(Candidate candidate, DesignModel? design)
    {
        if (design is null)
        {
            return false;
        }

        var target = FindDesignColumn(design, candidate.TargetDatasetId, candidate.TargetColumnName);
        return target is not null && Validation.DesignRelationshipRules.IsValidTarget(target);
    }

    private static DatasetColumnProfile BuildColumnProfile(Dataset dataset, DatasetColumn column)
    {
        var values = dataset.Rows
            .OrderBy(row => row.RowNumber)
            .Select(row => TryGetRowValue(row.RowData, column.ColumnName))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToList();

        var distinctCount = values.Distinct(StringComparer.OrdinalIgnoreCase).Count();

        return new DatasetColumnProfile(
            dataset,
            column,
            DatasetHeuristics.NormalizeIdentifier(dataset.TableName, $"dataset_{dataset.Id}"),
            values,
            values.Count > 0 && distinctCount == values.Count,
            values.Count > 0 && distinctCount < values.Count);
    }

    private static string? TryGetRowValue(string rowData, string columnName)
    {
        try
        {
            using var document = JsonDocument.Parse(rowData);
            return document.RootElement.TryGetProperty(columnName, out var value)
                ? value.ValueKind == JsonValueKind.Null ? null : value.ToString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static Candidate? ScoreDirection(DatasetColumnProfile source, DatasetColumnProfile target)
    {
        if (!target.IsUnique || source.Dataset.Id == target.Dataset.Id)
        {
            return null;
        }

        var sameName = DatasetHeuristics.ColumnNamesMatch(source.Column.ColumnName, target.Column.ColumnName);
        var nameSimilarity = DatasetHeuristics.CalculateColumnNameSimilarity(source.Column.ColumnName, target.Column.ColumnName);
        var similarName = !sameName && nameSimilarity >= 0.67m;
        var sourceReferencesTargetTable = DatasetHeuristics.ColumnPrefixMatchesTable(source.Column.ColumnName, target.Dataset.TableName);
        var sourceKeyLike = DatasetHeuristics.IsKeyLikeColumn(source.Column.ColumnName);
        var targetKeyLike = DatasetHeuristics.IsKeyLikeColumn(target.Column.ColumnName);
        var overlap = DatasetHeuristics.CalculateOverlap(source.Values, target.Values);

        var hasNameEvidence = sameName || similarName || sourceReferencesTargetTable;
        var hasValueEvidence = overlap >= 0.25m;
        var hasShapeEvidence = source.HasRepeatedValues || source.Dataset.RowCount >= target.Dataset.RowCount;
        var hasKeyEvidence = sourceKeyLike || targetKeyLike;

        if ((!hasNameEvidence && !hasValueEvidence)
            || (!hasShapeEvidence && overlap < 0.8m)
            || (!hasKeyEvidence && overlap < 0.5m))
        {
            return null;
        }

        var reasons = new List<string>();
        var confidence = 0.2m;

        if (sameName)
        {
            confidence += 0.22m;
            reasons.Add("Column names match across datasets.");
        }
        else if (similarName)
        {
            confidence += 0.16m;
            reasons.Add("Column names are similar after normalization.");
        }

        if (sourceReferencesTargetTable)
        {
            confidence += 0.12m;
            reasons.Add("Source column name appears to reference the target table.");
        }

        if (sourceKeyLike || targetKeyLike)
        {
            confidence += sourceKeyLike && targetKeyLike ? 0.16m : 0.1m;
            reasons.Add("Candidate columns use identifier, code, key, number, or reference naming.");
        }

        confidence += 0.2m;
        reasons.Add("Target column values are unique, making it a lookup/master key candidate.");

        if (source.HasRepeatedValues)
        {
            confidence += 0.14m;
            reasons.Add("Source column has repeated values, making it a detail/transaction reference candidate.");
        }

        if (overlap > 0)
        {
            confidence += Math.Min(0.25m, Math.Round(overlap * 0.25m, 4));
            reasons.Add($"Value overlap is {Math.Round(overlap * 100, 0)}% based on stored rows.");
        }

        if (source.Dataset.RowCount >= target.Dataset.RowCount)
        {
            confidence += 0.05m;
            reasons.Add("Dataset shape suggests source records reference a smaller lookup/master dataset.");
        }

        if (confidence < 0.55m)
        {
            return null;
        }

        var evidence = new
        {
            reasons,
            overlap,
            sameName,
            similarName,
            sourceReferencesTargetTable,
            sourceKeyLike,
            targetKeyLike
        };

        return new Candidate(
            source.Dataset.Id,
            source.Column.ColumnName,
            target.Dataset.Id,
            target.Column.ColumnName,
            (double)Math.Min(0.99m, confidence),
            JsonSerializer.Serialize(evidence, JsonOptions));
    }

    // ---- mapping ----

    private static RelationshipSuggestionResponseDto MapSuggestion(RelationshipSuggestion suggestion)
    {
        return new RelationshipSuggestionResponseDto
        {
            Id = suggestion.Id,
            ProjectId = suggestion.ProjectId,
            SourceDatasetId = suggestion.SourceDatasetId,
            SourceTableName = suggestion.SourceDataset?.TableName ?? string.Empty,
            SourceColumnName = suggestion.SourceColumnName,
            TargetDatasetId = suggestion.TargetDatasetId,
            TargetTableName = suggestion.TargetDataset?.TableName ?? string.Empty,
            TargetColumnName = suggestion.TargetColumnName,
            Score = suggestion.Score,
            EvidenceJson = suggestion.EvidenceJson,
            Status = suggestion.Status,
            DecidedAt = suggestion.DecidedAt,
            CreatedAt = suggestion.CreatedAt
        };
    }

    private static DesignRelationshipResponseDto MapRelationship(DesignRelationship relationship)
    {
        return new DesignRelationshipResponseDto
        {
            Id = relationship.Id,
            FromColumnId = relationship.FromColumnId,
            FromTableId = relationship.FromColumn!.DesignTableId,
            FromTableName = relationship.FromColumn.DesignTable?.Name ?? string.Empty,
            FromColumnName = relationship.FromColumn.Name,
            ToColumnId = relationship.ToColumnId,
            ToTableId = relationship.ToColumn!.DesignTableId,
            ToTableName = relationship.ToColumn.DesignTable?.Name ?? string.Empty,
            ToColumnName = relationship.ToColumn.Name,
            Cardinality = relationship.Cardinality,
            OnDelete = relationship.OnDelete,
            Origin = relationship.Origin,
            SuggestionId = relationship.SuggestionId
        };
    }
}
