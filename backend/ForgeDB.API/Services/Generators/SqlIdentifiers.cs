using System.Text.RegularExpressions;

namespace ForgeDB.API.Services.Generators;

/// <summary>
/// Shared identifier rules used by the SQL generator (quoting) and the validation engine
/// (reserved-word warning, invalid-identifier error), so both agree on one definition.
/// </summary>
public static class SqlIdentifiers
{
    private static readonly Regex SafeLowercasePattern = new("^[a-z_][a-z0-9_]{0,62}$", RegexOptions.Compiled);
    private static readonly Regex EditableIdentifierPattern = new("^[A-Za-z_][A-Za-z0-9_]{0,62}$", RegexOptions.Compiled);

    // PostgreSQL reserved keywords: the union of the "reserved" and "reserved (can be function
    // or type name)" columns of https://www.postgresql.org/docs/current/sql-keywords-appendix.html
    // — every word that must be quoted to be used as a table/column identifier.
    public static readonly IReadOnlySet<string> ReservedWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric",
        "authorization", "binary", "both", "case", "cast", "check", "collate", "collation",
        "column", "concurrently", "constraint", "create", "cross", "current_catalog",
        "current_date", "current_role", "current_schema", "current_time", "current_timestamp",
        "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
        "except", "false", "fetch", "for", "foreign", "freeze", "from", "full", "grant",
        "group", "having", "ilike", "in", "initially", "inner", "intersect", "into", "is",
        "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
        "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or",
        "order", "outer", "overlaps", "placing", "primary", "references", "returning",
        "right", "select", "session_user", "similar", "some", "symmetric", "table",
        "tablesample", "then", "to", "trailing", "true", "union", "unique", "user", "using",
        "variadic", "verbose", "when", "where", "window", "with"
    };

    public static bool IsSafeLowercaseIdentifier(string identifier)
    {
        return SafeLowercasePattern.IsMatch(identifier);
    }

    public static bool IsReservedWord(string identifier)
    {
        return ReservedWords.Contains(identifier);
    }

    public static bool IsValidEditableIdentifier(string? identifier)
    {
        return !string.IsNullOrWhiteSpace(identifier)
            && EditableIdentifierPattern.IsMatch(identifier)
            && !IsReservedWord(identifier);
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
