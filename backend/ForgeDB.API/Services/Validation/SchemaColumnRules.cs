using System.Globalization;
using System.Text.RegularExpressions;

namespace ForgeDB.API.Services.Validation;

/// <summary>
/// The single allow-list used by Schema draft persistence, validation, and PostgreSQL DDL.
/// User input is normalized before persistence so generators never receive arbitrary SQL types
/// or default expressions.
/// </summary>
public static partial class SchemaColumnRules
{
    public const int MaxVarcharLength = 10_485_760;

    public static readonly IReadOnlyList<string> EditorTypes =
    [
        "SMALLINT", "INTEGER", "BIGINT", "NUMERIC", "DECIMAL", "REAL",
        "DOUBLE PRECISION", "BOOLEAN", "VARCHAR(255)", "TEXT", "DATE",
        "TIMESTAMP", "TIMESTAMPTZ", "UUID"
    ];

    public static bool TryNormalizeSqlType(string? value, out string normalized)
    {
        normalized = Regex.Replace(value?.Trim() ?? string.Empty, @"\s+", " ").ToUpperInvariant();
        if (normalized == "TIMESTAMP WITH TIME ZONE") normalized = "TIMESTAMPTZ";
        if (normalized == "CHARACTER VARYING") normalized = "VARCHAR";

        if (normalized is "SMALLINT" or "INTEGER" or "BIGINT" or "NUMERIC" or "DECIMAL"
            or "REAL" or "DOUBLE PRECISION" or "BOOLEAN" or "TEXT" or "DATE"
            or "TIMESTAMP" or "TIMESTAMPTZ" or "UUID")
        {
            return true;
        }

        var varchar = VarcharTypeRegex().Match(normalized);
        if (!varchar.Success || !int.TryParse(varchar.Groups[1].Value, out var length)
            || length < 1 || length > MaxVarcharLength)
        {
            return false;
        }

        normalized = $"VARCHAR({length})";
        return true;
    }

    public static bool IsIdentityCompatible(string? sqlType)
    {
        return TryNormalizeSqlType(sqlType, out var normalized)
            && normalized is "SMALLINT" or "INTEGER" or "BIGINT";
    }

    public static bool TryNormalizeDefault(string? value, string? sqlType, out string? normalized, out string? error)
    {
        normalized = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        error = null;
        if (normalized is null) return true;

        if (normalized.Length > 512 || normalized.Contains(';') || normalized.Contains("--", StringComparison.Ordinal)
            || normalized.Contains("/*", StringComparison.Ordinal) || normalized.Contains("*/", StringComparison.Ordinal)
            || normalized.Contains('\r') || normalized.Contains('\n'))
        {
            error = "Default values cannot contain statements, comments, or line breaks.";
            return false;
        }

        if (!TryNormalizeSqlType(sqlType, out var type))
        {
            error = "Select a supported PostgreSQL data type before setting a default.";
            return false;
        }

        if (type is "SMALLINT" or "INTEGER" or "BIGINT")
        {
            if (!IntegerLiteralRegex().IsMatch(normalized)
                || !long.TryParse(normalized, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var integer)
                || (type == "SMALLINT" && (integer < short.MinValue || integer > short.MaxValue))
                || (type == "INTEGER" && (integer < int.MinValue || integer > int.MaxValue)))
            {
                error = $"Use an integer literal within the {type} range.";
                return false;
            }
            return true;
        }

        if (type is "NUMERIC" or "DECIMAL" or "REAL" or "DOUBLE PRECISION")
        {
            if (!NumericLiteralRegex().IsMatch(normalized))
            {
                error = "Use a numeric literal, for example 0 or -12.5.";
                return false;
            }
            return true;
        }

        if (type == "BOOLEAN")
        {
            if (!normalized.Equals("true", StringComparison.OrdinalIgnoreCase)
                && !normalized.Equals("false", StringComparison.OrdinalIgnoreCase))
            {
                error = "Boolean defaults must be true or false.";
                return false;
            }
            normalized = normalized.ToLowerInvariant();
            return true;
        }

        if (type == "TEXT" || type.StartsWith("VARCHAR(", StringComparison.Ordinal))
        {
            if (!SqlStringLiteralRegex().IsMatch(normalized))
            {
                error = "Text defaults must be a single-quoted value; escape apostrophes by doubling them.";
                return false;
            }
            return true;
        }

        if (type == "DATE")
        {
            if (!TryGetQuotedValue(normalized, out var dateValue)
                || !DateOnly.TryParseExact(dateValue, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            {
                error = "Date defaults must be quoted ISO dates, for example '2026-07-12'.";
                return false;
            }
            return true;
        }

        if (type is "TIMESTAMP" or "TIMESTAMPTZ")
        {
            if (normalized.Equals("CURRENT_TIMESTAMP", StringComparison.OrdinalIgnoreCase))
            {
                normalized = "CURRENT_TIMESTAMP";
                return true;
            }
            if (!TryGetQuotedValue(normalized, out var timestampValue)
                || !DateTimeOffset.TryParse(timestampValue, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out _))
            {
                error = "Timestamp defaults must be CURRENT_TIMESTAMP or a quoted ISO timestamp.";
                return false;
            }
            return true;
        }

        if (type == "UUID")
        {
            if (!TryGetQuotedValue(normalized, out var uuidValue) || !Guid.TryParse(uuidValue, out _))
            {
                error = "UUID defaults must be quoted UUID literals. Arbitrary UUID functions are not enabled.";
                return false;
            }
            return true;
        }

        error = $"Defaults are not supported for {type}.";
        return false;
    }

    private static bool TryGetQuotedValue(string literal, out string value)
    {
        value = string.Empty;
        if (!SqlStringLiteralRegex().IsMatch(literal)) return false;
        value = literal[1..^1].Replace("''", "'", StringComparison.Ordinal);
        return true;
    }

    [GeneratedRegex(@"^VARCHAR\(\s*(\d+)\s*\)$", RegexOptions.CultureInvariant)]
    private static partial Regex VarcharTypeRegex();

    [GeneratedRegex(@"^[+-]?\d+$", RegexOptions.CultureInvariant)]
    private static partial Regex IntegerLiteralRegex();

    [GeneratedRegex(@"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex NumericLiteralRegex();

    [GeneratedRegex(@"^'(?:[^']|'')*'$", RegexOptions.CultureInvariant)]
    private static partial Regex SqlStringLiteralRegex();
}
