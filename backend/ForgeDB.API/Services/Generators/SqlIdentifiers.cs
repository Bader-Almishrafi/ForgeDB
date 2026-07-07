using System.Text.RegularExpressions;

namespace ForgeDB.API.Services.Generators;

/// <summary>
/// Shared identifier rules used by the SQL generator (quoting) and the validation engine
/// (reserved-word warning, invalid-identifier error), so both agree on one definition.
/// </summary>
public static class SqlIdentifiers
{
    private static readonly Regex SafeLowercasePattern = new("^[a-z_][a-z0-9_]{0,62}$", RegexOptions.Compiled);

    // Common PostgreSQL reserved keywords (non-exhaustive; covers the words most likely to
    // appear as user-chosen table/column names). Sourced from the "reserved" column of
    // https://www.postgresql.org/docs/current/sql-keywords-appendix.html.
    public static readonly IReadOnlySet<string> ReservedWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
        "both", "case", "cast", "check", "collate", "column", "constraint", "create",
        "current_date", "current_role", "current_time", "current_timestamp", "current_user",
        "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false",
        "fetch", "for", "foreign", "from", "grant", "group", "having", "in", "initially",
        "intersect", "into", "lateral", "leading", "limit", "localtime", "localtimestamp",
        "not", "null", "offset", "on", "only", "or", "order", "placing", "primary",
        "references", "returning", "select", "session_user", "some", "symmetric", "table",
        "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic",
        "when", "where", "window", "with"
    };

    public static bool IsSafeLowercaseIdentifier(string identifier)
    {
        return SafeLowercasePattern.IsMatch(identifier);
    }

    public static bool IsReservedWord(string identifier)
    {
        return ReservedWords.Contains(identifier);
    }

    public static bool NeedsQuoting(string identifier)
    {
        return !IsSafeLowercaseIdentifier(identifier) || IsReservedWord(identifier);
    }

    public static string Quote(string identifier)
    {
        return $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }

    public static string QuoteIfNeeded(string identifier)
    {
        return NeedsQuoting(identifier) ? Quote(identifier) : identifier;
    }

    /// <summary>
    /// True when an identifier cannot be made valid even after quoting: empty/whitespace, or
    /// longer than PostgreSQL's 63-byte identifier limit.
    /// </summary>
    public static bool IsUnusableEvenQuoted(string? identifier)
    {
        return string.IsNullOrWhiteSpace(identifier) || identifier.Length > 63;
    }
}
