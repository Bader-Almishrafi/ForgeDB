using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Services;

/// <summary>
/// Shared identifier-normalization and column-shape heuristics used by both design generation
/// (table/column naming, primary-key guessing) and relationship-suggestion detection. Ported
/// from the logic that used to live only in ProjectService's live-computed suggestions/schema
/// path, which Phase 1 replaces.
/// </summary>
internal static class DatasetHeuristics
{
    public static string NormalizeIdentifier(string value, string fallback)
    {
        var normalized = Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9_]+", "_");
        normalized = Regex.Replace(normalized, "_+", "_").Trim('_');

        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = fallback;
        }

        if (char.IsDigit(normalized[0]))
        {
            normalized = $"t_{normalized}";
        }

        return normalized;
    }

    public static string MakeUniqueIdentifier(string rawValue, ISet<string> usedIdentifiers, string fallback)
    {
        var baseIdentifier = NormalizeIdentifier(rawValue, fallback);
        var identifier = baseIdentifier;
        var suffix = 2;

        while (!usedIdentifiers.Add(identifier))
        {
            identifier = $"{baseIdentifier}_{suffix}";
            suffix++;
        }

        return identifier;
    }

    public static string MapToSqlType(string detectedDataType)
    {
        return detectedDataType.Trim().ToLowerInvariant() switch
        {
            "integer" => "INTEGER",
            "decimal" => "NUMERIC",
            "double" => "NUMERIC",
            "float" => "NUMERIC",
            "boolean" => "BOOLEAN",
            "date" => "TIMESTAMP",
            "datetime" => "TIMESTAMP",
            "string" => "TEXT",
            "text" => "TEXT",
            _ => "TEXT"
        };
    }

    public static string ResolveDetectedDataType(Dataset dataset, DatasetColumn column)
    {
        var analysisTypes = ResolveAnalysisTypes(dataset.AnalysisResultJson);
        if (analysisTypes.TryGetValue(column.ColumnName, out var analyzedType) && !string.IsNullOrWhiteSpace(analyzedType))
        {
            return analyzedType.Trim().ToLowerInvariant();
        }

        return string.IsNullOrWhiteSpace(column.DetectedDataType)
            ? "string"
            : column.DetectedDataType.Trim().ToLowerInvariant();
    }

    public static bool IsKeyLikeColumn(string columnName)
    {
        var tokens = SplitIdentifierTokens(columnName);
        if (tokens.Any(IsKeyToken))
        {
            return true;
        }

        var normalized = Regex.Replace(columnName.Trim().ToLowerInvariant(), "[^a-z0-9]+", string.Empty);
        return normalized.Length > 2
            && !normalized.EndsWith("paid", StringComparison.Ordinal)
            && (normalized.EndsWith("id", StringComparison.Ordinal)
                || normalized.EndsWith("key", StringComparison.Ordinal)
                || normalized.EndsWith("code", StringComparison.Ordinal)
                || normalized.EndsWith("ref", StringComparison.Ordinal)
                || normalized.EndsWith("no", StringComparison.Ordinal)
                || normalized.EndsWith("num", StringComparison.Ordinal)
                || normalized.EndsWith("number", StringComparison.Ordinal));
    }

    public static bool ColumnPrefixMatchesTable(string columnName, string tableName)
    {
        var columnTokens = SplitIdentifierTokens(columnName)
            .Where(token => !IsKeyToken(token))
            .ToList();
        var tableTokens = SplitIdentifierTokens(tableName)
            .Select(SingularizeToken)
            .Where(token => !IsTableNoiseToken(token))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!columnTokens.Any() || !tableTokens.Any())
        {
            return false;
        }

        return columnTokens.Select(SingularizeToken).Any(tableTokens.Contains);
    }

    public static bool ColumnNamesMatch(string left, string right)
    {
        return string.Equals(
            NormalizeNameForComparison(left),
            NormalizeNameForComparison(right),
            StringComparison.OrdinalIgnoreCase);
    }

    public static decimal CalculateColumnNameSimilarity(string left, string right)
    {
        var leftTokens = SplitIdentifierTokens(left).Select(NormalizeComparisonToken).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rightTokens = SplitIdentifierTokens(right).Select(NormalizeComparisonToken).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (leftTokens.Count == 0 || rightTokens.Count == 0)
        {
            return 0;
        }

        var intersection = leftTokens.Count(rightTokens.Contains);
        var union = leftTokens.Union(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        return union == 0 ? 0 : Math.Round((decimal)intersection / union, 4);
    }

    public static decimal CalculateOverlap(IReadOnlyList<string> sourceValues, IReadOnlyList<string> targetValues)
    {
        if (sourceValues.Count == 0 || targetValues.Count == 0)
        {
            return 0;
        }

        var targetSet = targetValues.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sourceDistinct = sourceValues.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var overlapCount = sourceDistinct.Count(targetSet.Contains);

        return sourceDistinct.Count == 0 ? 0 : Math.Round((decimal)overlapCount / sourceDistinct.Count, 4);
    }

    public static IReadOnlyList<string> SplitIdentifierTokens(string value)
    {
        var camelSeparated = Regex.Replace(value.Trim(), "([a-z0-9])([A-Z])", "$1_$2");
        return Regex.Split(camelSeparated.ToLowerInvariant(), "[^a-z0-9]+")
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .ToList();
    }

    private static string NormalizeNameForComparison(string value)
    {
        return string.Join("_", SplitIdentifierTokens(value).Select(NormalizeComparisonToken));
    }

    private static string NormalizeComparisonToken(string token)
    {
        var singular = SingularizeToken(token);
        return IsKeyToken(singular) ? "key" : singular;
    }

    private static string SingularizeToken(string token)
    {
        return token.EndsWith("s", StringComparison.OrdinalIgnoreCase) && token.Length > 3
            ? token[..^1]
            : token;
    }

    private static bool IsKeyToken(string token)
    {
        return token is "id" or "key" or "code" or "ref" or "no" or "num" or "number" or "uuid" or "guid";
    }

    private static bool IsTableNoiseToken(string token)
    {
        return token is "raw" or "export" or "final" or "dump" or "file" or "data" or "dataset" or "csv";
    }

    private static Dictionary<string, string> ResolveAnalysisTypes(string? analysisResultJson)
    {
        var types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(analysisResultJson))
        {
            return types;
        }

        try
        {
            using var document = JsonDocument.Parse(analysisResultJson);
            if (!document.RootElement.TryGetProperty("columns", out var columns) || columns.ValueKind != JsonValueKind.Array)
            {
                return types;
            }

            foreach (var column in columns.EnumerateArray())
            {
                var name = column.TryGetProperty("columnName", out var nameProperty) ? nameProperty.GetString() : null;
                var type = column.TryGetProperty("detectedDataType", out var typeProperty) ? typeProperty.GetString() : null;
                if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(type))
                {
                    types[name] = type.Trim().ToLowerInvariant();
                }
            }
        }
        catch (JsonException)
        {
            return types;
        }

        return types;
    }
}
