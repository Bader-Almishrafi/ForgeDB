using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Services;

public static class CleaningSuggestionBuilder
{
    private static readonly char[] CurrencySymbols = { '$', '€', '£', '¥', '₹', '%' };

    public static List<CleaningSuggestionDto> BuildSuggestions(int projectId, IReadOnlyList<CleaningDatasetVersionData> datasets)
    {
        var suggestions = new List<CleaningSuggestionDto>();
        foreach (var data in datasets)
        {
            AnalyzeDatasetVersion(suggestions, projectId, data);
        }
        return suggestions.GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase).Select(group => group.First()).ToList();
    }

    private static void AnalyzeDatasetVersion(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data)
    {
        if (string.IsNullOrWhiteSpace(data.Version.AnalysisResultJson)) return;

        using var analysis = JsonDocument.Parse(data.Version.AnalysisResultJson);
        var root = analysis.RootElement;

        if (root.TryGetProperty("columns", out var columns) && columns.ValueKind == JsonValueKind.Array)
        {
            foreach (var column in columns.EnumerateArray())
            {
                var name = column.TryGetProperty("columnName", out var nameElement) ? nameElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(name)) continue;
                var type = column.TryGetProperty("detectedDataType", out var typeElement) ? typeElement.GetString() ?? "string" : "string";
                var missing = column.TryGetProperty("missingValuesCount", out var missingElement) ? missingElement.GetInt32() : 0;

                if (missing > 0) suggestions.Add(BuildMissingSuggestion(projectId, data, name, type, missing));
                AddDerivedColumnSuggestions(suggestions, projectId, data, name, type);
            }
        }

        var duplicates = root.TryGetProperty("duplicateRowsCount", out var duplicateElement) ? duplicateElement.GetInt32() : data.Version.DuplicateRowsCount;
        if (duplicates > 0) suggestions.Add(BuildDuplicateSuggestion(projectId, data, duplicates));
    }

    private static void AddDerivedColumnSuggestions(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data, string column, string type)
    {
        var values = data.Rows.Select(row => row.GetValueOrDefault(column)).Where(value => value is not null).ToList();
        var textValues = values.Select(TryText).Where(value => value is not null).Select(value => value!).ToList();

        CheckExtraSpaces(suggestions, projectId, data, column, textValues);
        CheckInconsistentCase(suggestions, projectId, data, column, textValues);
        CheckOutliers(suggestions, projectId, data, column, type, values);
        CheckCurrencyOrPercentage(suggestions, projectId, data, column, textValues);
    }

    private static void CheckExtraSpaces(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data, string column, List<string> textValues)
    {
        var extraSpaces = textValues.Count(HasExtraSpaces);
        if (extraSpaces == 0) return;

        var strategy = Strategy("trim-collapse", "Trim and collapse spaces", "text_normalize", new() { ["action"] = "trim" }, true);
        suggestions.Add(Suggestion(projectId, data, "Extra Spaces", column, extraSpaces, $"{extraSpaces} value(s) contain leading, trailing, or repeated spaces.", strategy,
            new() { strategy, Strategy("collapse", "Collapse repeated spaces", "text_normalize", new() { ["action"] = "collapse_spaces" }, true) }));
    }

    private static void CheckInconsistentCase(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data, string column, List<string> textValues)
    {
        if (textValues.Count == 0) return;

        var trimmedTexts = new List<string>(textValues.Count);
        foreach (var val in textValues)
        {
            if (!string.IsNullOrWhiteSpace(val)) trimmedTexts.Add(val.Trim());
        }

        var caseVariants = trimmedTexts
            .GroupBy(val => val.ToLowerInvariant())
            .Where(group => group.Distinct(StringComparer.Ordinal).Count() > 1)
            .Sum(group => group.Count());
        if (caseVariants == 0) return;

        var strategies = new List<CleaningStrategyDto>
        {
            Strategy("lower", "Convert to lowercase", "text_normalize", new() { ["action"] = "lowercase" }),
            Strategy("upper", "Convert to uppercase", "text_normalize", new() { ["action"] = "uppercase" }),
            Strategy("title", "Convert to title case", "text_normalize", new() { ["action"] = "title_case" })
        };
        suggestions.Add(Suggestion(projectId, data, "Inconsistent Case", column, caseVariants, $"{caseVariants} value(s) differ only by letter case.", strategies[0], strategies));
    }

    private static void CheckOutliers(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data, string column, string type, List<object?> values)
    {
        if (!IsNumericType(type)) return;

        var numbers = values.Select(TryDecimal).Where(value => value.HasValue).Select(value => value!.Value).Order().ToList();
        if (numbers.Count < 4) return;

        var q1 = Percentile(numbers, 0.25m);
        var q3 = Percentile(numbers, 0.75m);
        var iqr = q3 - q1;
        var lower = q1 - 1.5m * iqr;
        var upper = q3 + 1.5m * iqr;
        var count = numbers.Count(value => value < lower || value > upper);
        if (count == 0) return;

        var strategies = new List<CleaningStrategyDto>
        {
            Strategy("cap", "Cap to IQR bounds", "handle_outliers", new() { ["action"] = "cap", ["iqrMultiplier"] = 1.5m }),
            Strategy("median", "Replace with median", "handle_outliers", new() { ["action"] = "median", ["iqrMultiplier"] = 1.5m }),
            Strategy("delete", "Delete outlier rows", "handle_outliers", new() { ["action"] = "delete", ["iqrMultiplier"] = 1.5m }, false, true),
            Strategy("keep", "Keep unchanged", "handle_outliers", new() { ["action"] = "keep", ["iqrMultiplier"] = 1.5m })
        };
        suggestions.Add(Suggestion(projectId, data, "Outliers", column, count, $"{count} value(s) fall outside the deterministic 1.5×IQR bounds ({lower:g} to {upper:g}).", strategies[0], strategies));
    }

    private static void CheckCurrencyOrPercentage(List<CleaningSuggestionDto> suggestions, int projectId, CleaningDatasetVersionData data, string column, List<string> textValues)
    {
        var currencyValues = textValues.Count(ContainsCurrencyOrPercentage);
        if (currencyValues == 0) return;

        var strategy = Strategy("numeric", "Normalize numeric or currency values", "normalize_numeric", new() { ["removeThousands"] = true, ["decimalSeparator"] = ".", ["currencySymbols"] = new[] { "$", "€", "£", "¥", "₹", "SAR", "USD" }, ["percentage"] = false, ["targetType"] = "decimal" });
        suggestions.Add(Suggestion(projectId, data, "Other Issues", column, currencyValues, $"{currencyValues} value(s) contain a known currency or percentage marker and require explicit locale review.", strategy, new() { strategy }));
    }

    private static CleaningSuggestionDto BuildMissingSuggestion(int projectId, CleaningDatasetVersionData data, string column, string type, int count)
    {
        var numeric = IsNumericType(type);
        var strategies = numeric
            ? new List<CleaningStrategyDto>
            {
                Strategy("zero", "Fill with zero", "fill_missing", new() { ["strategy"] = "zero" }),
                Strategy("median", "Fill with median", "fill_missing", new() { ["strategy"] = "median" }, true),
                Strategy("mean", "Fill with mean", "fill_missing", new() { ["strategy"] = "mean" }),
                Strategy("custom", "Fill with custom value", "fill_missing", new() { ["strategy"] = "custom", ["value"] = null }),
                Strategy("delete", "Delete affected rows", "fill_missing", new() { ["strategy"] = "delete_rows" }, false, true),
                Strategy("leave", "Leave unchanged", "fill_missing", new() { ["strategy"] = "leave" })
            }
            : new List<CleaningStrategyDto>
            {
                Strategy("empty", "Fill with empty string", "fill_missing", new() { ["strategy"] = "empty" }),
                Strategy("mode", "Fill with most frequent value", "fill_missing", new() { ["strategy"] = "mode" }),
                Strategy("custom", "Fill with custom value", "fill_missing", new() { ["strategy"] = "custom", ["value"] = null }),
                Strategy("forward", "Forward fill", "fill_missing", new() { ["strategy"] = "forward_fill" }),
                Strategy("backward", "Backward fill", "fill_missing", new() { ["strategy"] = "backward_fill" }),
                Strategy("delete", "Delete affected rows", "fill_missing", new() { ["strategy"] = "delete_rows" }, false, true),
                Strategy("leave", "Leave unchanged", "fill_missing", new() { ["strategy"] = "leave" })
            };
        return Suggestion(projectId, data, "Missing Values", column, count, $"{column} contains {count} missing value(s).", strategies[0], strategies);
    }

    private static CleaningSuggestionDto BuildDuplicateSuggestion(int projectId, CleaningDatasetVersionData data, int count)
    {
        var strategies = new List<CleaningStrategyDto>
        {
            Strategy("keep-first", "Remove exact duplicates, keep first", "remove_duplicates", new() { ["keep"] = "first", ["columns"] = data.Columns.Select(column => column.Name).ToList() }, false, true),
            Strategy("keep-last", "Remove exact duplicates, keep last", "remove_duplicates", new() { ["keep"] = "last", ["columns"] = data.Columns.Select(column => column.Name).ToList() }, false, true)
        };
        return Suggestion(projectId, data, "Duplicates", null, count, $"{count} exact duplicate row(s) were detected.", strategies[0], strategies);
    }

    private static CleaningSuggestionDto Suggestion(int projectId, CleaningDatasetVersionData data, string type, string? column, int count, string description, CleaningStrategyDto recommended, List<CleaningStrategyDto> strategies) => new()
    {
        Id = $"{data.Dataset.Id}:{data.Version.Id}:{type}:{column ?? "row"}".ToLowerInvariant().Replace(' ', '-'),
        ProjectId = projectId,
        DatasetId = data.Dataset.Id,
        VersionId = data.Version.Id,
        DatasetName = data.Dataset.TableName,
        IssueType = type,
        Column = column,
        Count = count,
        Percentage = data.Version.RowCount > 0 ? Math.Round((decimal)count / data.Version.RowCount * 100, 2) : null,
        RiskLabel = recommended.IsDestructive ? "High — destructive" : data.Version.RowCount > 0 && count * 10 > data.Version.RowCount ? "Review — affects over 10%" : "Low — deterministic",
        Description = description,
        RecommendedStrategy = recommended,
        AvailableStrategies = strategies
    };

    private static CleaningStrategyDto Strategy(string key, string label, string operationType, Dictionary<string, object?> parameters, bool safe = false, bool destructive = false) => new()
    {
        Key = key, Label = label, OperationType = operationType, Parameters = parameters, IsSafeRecommended = safe, IsDestructive = destructive
    };

    private static bool HasExtraSpaces(string value) => value.Length > 0 && (
        char.IsWhiteSpace(value[0]) ||
        char.IsWhiteSpace(value[^1]) ||
        HasRepeatedSpaces(value));

    private static bool HasRepeatedSpaces(string value)
    {
        for (var i = 1; i < value.Length; i++)
        {
            if (char.IsWhiteSpace(value[i]) && char.IsWhiteSpace(value[i - 1])) return true;
        }
        return false;
    }

    private static bool ContainsCurrencyOrPercentage(string value)
    {
        if (value.IndexOfAny(CurrencySymbols) >= 0) return true;
        if (value.Contains("SAR", StringComparison.Ordinal) || value.Contains("USD", StringComparison.Ordinal))
        {
            return Regex.IsMatch(value, @"\b(SAR|USD)\b");
        }
        return false;
    }

    private static bool IsNumericType(string type) => type.Contains("int", StringComparison.OrdinalIgnoreCase)
        || type.Contains("decimal", StringComparison.OrdinalIgnoreCase)
        || type.Contains("number", StringComparison.OrdinalIgnoreCase)
        || type.Contains("float", StringComparison.OrdinalIgnoreCase)
        || type.Contains("double", StringComparison.OrdinalIgnoreCase);

    private static decimal? TryDecimal(object? value)
    {
        if (value is null) return null;
        if (value is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out var dec)) return dec;
            if (element.ValueKind != JsonValueKind.String) return null;
            var elementText = element.GetString();
            return decimal.TryParse(elementText, NumberStyles.Number, CultureInfo.InvariantCulture, out var elementNumber) ? elementNumber : null;
        }
        if (value is decimal d) return d;
        if (value is int i) return i;
        if (value is long l) return l;
        if (value is double db && !double.IsNaN(db) && !double.IsInfinity(db)) return (decimal)db;
        var text = Convert.ToString(value, CultureInfo.InvariantCulture);
        return decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var number) ? number : null;
    }

    private static string? TryText(object? value) => value switch
    {
        string text => text,
        JsonElement { ValueKind: JsonValueKind.String } element => element.GetString(),
        _ => null
    };

    private static decimal Percentile(IReadOnlyList<decimal> values, decimal percentile)
    {
        var position = (values.Count - 1) * percentile;
        var lower = (int)Math.Floor(position); var upper = (int)Math.Ceiling(position);
        return lower == upper ? values[lower] : values[lower] + (values[upper] - values[lower]) * (position - lower);
    }
}
