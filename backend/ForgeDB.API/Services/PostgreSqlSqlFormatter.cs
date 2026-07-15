using System.Globalization;
using ForgeDB.API.Services.Generators;

namespace ForgeDB.API.Services;

/// <summary>
/// Central PostgreSQL formatting for downloadable deployment scripts. Runtime inserts remain
/// parameterized; this formatter is only used when a literal SQL artifact must be executable on
/// its own.
/// </summary>
public static class PostgreSqlSqlFormatter
{
    public static string Identifier(string value) => SqlIdentifiers.Quote(value);

    public static string QualifiedIdentifier(string schemaName, string identifier) =>
        $"{Identifier(schemaName)}.{Identifier(identifier)}";

    public static string Literal(object? value)
    {
        return value switch
        {
            null or DBNull => "NULL",
            bool boolean => boolean ? "TRUE" : "FALSE",
            byte number => number.ToString(CultureInfo.InvariantCulture),
            sbyte number => number.ToString(CultureInfo.InvariantCulture),
            short number => number.ToString(CultureInfo.InvariantCulture),
            ushort number => number.ToString(CultureInfo.InvariantCulture),
            int number => number.ToString(CultureInfo.InvariantCulture),
            uint number => number.ToString(CultureInfo.InvariantCulture),
            long number => number.ToString(CultureInfo.InvariantCulture),
            ulong number => number.ToString(CultureInfo.InvariantCulture),
            float number when float.IsFinite(number) => number.ToString("R", CultureInfo.InvariantCulture),
            double number when double.IsFinite(number) => number.ToString("R", CultureInfo.InvariantCulture),
            decimal number => number.ToString(CultureInfo.InvariantCulture),
            DateOnly date => $"'{date:yyyy-MM-dd}'::date",
            DateTime timestamp when timestamp.Kind == DateTimeKind.Utc =>
                $"'{timestamp.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture)}'::timestamptz",
            DateTime timestamp =>
                $"'{timestamp.ToString("yyyy-MM-dd HH:mm:ss.fffffff", CultureInfo.InvariantCulture)}'::timestamp",
            Guid uuid => $"'{uuid:D}'::uuid",
            string text => EscapeText(text),
            _ => throw new ArgumentException($"Unsupported PostgreSQL literal CLR type '{value.GetType().Name}'.", nameof(value))
        };
    }

    private static string EscapeText(string value)
    {
        if (value.IndexOf('\0') >= 0)
        {
            throw new ArgumentException("PostgreSQL text values cannot contain a zero byte.", nameof(value));
        }

        // Escape-string syntax makes backslash handling deterministic regardless of the target
        // server's standard_conforming_strings setting. Unicode content is retained verbatim.
        var escaped = value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("'", "''", StringComparison.Ordinal)
            .Replace("\r", "\\r", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal)
            .Replace("\t", "\\t", StringComparison.Ordinal)
            .Replace("\b", "\\b", StringComparison.Ordinal)
            .Replace("\f", "\\f", StringComparison.Ordinal);
        return $"E'{escaped}'";
    }
}
