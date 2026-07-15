using System.Globalization;
using System.Text.Json;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Services.Generators;
using ForgeDB.API.Services.Validation;
using Npgsql;
using NpgsqlTypes;

namespace ForgeDB.API.Services;

/// <summary>
/// Pure, DB-free planning logic for deployment: schema naming, FK-safe table ordering for row
/// insertion, and JSON-value-to-CLR-type conversion. Kept separate from DeploymentRepository so
/// it can be unit tested without a relational provider (EF's InMemory provider does not support
/// the transactions/ExecuteSqlRaw the actual execution path requires).
/// </summary>
public static class DeploymentPlanBuilder
{
    public static string BuildSchemaName(int projectId) => $"forgedb_project_{projectId}";

    /// <summary>Orders tables so every FK target (ToTable) is inserted before the table that
    /// references it (FromTable). Falls back to declaration order on a cycle.</summary>
    public static List<DesignTable> OrderTablesForInsertion(
        IReadOnlyList<DesignTable> tables,
        IReadOnlyList<DesignRelationship> relationships)
    {
        var byId = tables.ToDictionary(table => table.Id);
        var dependsOn = relationships
            .Where(relationship => relationship.FromColumn!.DesignTableId != relationship.ToColumn!.DesignTableId)
            .Select(relationship => (From: relationship.FromColumn!.DesignTableId, To: relationship.ToColumn!.DesignTableId))
            .Distinct()
            .GroupBy(edge => edge.From)
            .ToDictionary(group => group.Key, group => group.Select(edge => edge.To).ToList());

        var state = new Dictionary<int, int>();
        var order = new List<DesignTable>();
        var hasCycle = false;

        void Visit(int tableId)
        {
            if (hasCycle || !byId.ContainsKey(tableId)) return;
            if (state.TryGetValue(tableId, out var current))
            {
                if (current == 1) { hasCycle = true; return; }
                if (current == 2) return;
            }

            state[tableId] = 1;
            if (dependsOn.TryGetValue(tableId, out var dependencies))
            {
                foreach (var dependencyId in dependencies)
                {
                    Visit(dependencyId);
                    if (hasCycle) return;
                }
            }
            state[tableId] = 2;
            order.Add(byId[tableId]);
        }

        foreach (var table in tables.OrderBy(table => table.Id))
        {
            Visit(table.Id);
            if (hasCycle) break;
        }

        return hasCycle ? tables.OrderBy(table => table.Id).ToList() : order;
    }

    /// <summary>Strips the SqlSchemaGenerator's own BEGIN/COMMIT wrapper text since the caller
    /// manages the transaction itself via EF Core.</summary>
    public static string StripTransactionWrapper(string generatedSql)
    {
        var lines = generatedSql
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Split('\n')
            .Where(line => !string.Equals(line.Trim(), "BEGIN;", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(line.Trim(), "COMMIT;", StringComparison.OrdinalIgnoreCase));

        return string.Join('\n', lines).Trim();
    }

    /// <summary>Converts a JSON-deserialized row value (typically a boxed JsonElement, since the
    /// source dictionary is Dictionary&lt;string, object?&gt;) into a CLR value matching the
    /// design column's target SQL type, for binding as an Npgsql parameter. Returns DBNull.Value
    /// when the source is empty/missing/unparseable so the database's own NOT NULL / default
    /// rules decide whether that is acceptable, rather than silently guessing.</summary>
    public static object ConvertValue(object? raw, string sqlType)
    {
        string? text = raw switch
        {
            null => null,
            JsonElement { ValueKind: JsonValueKind.Null } => null,
            JsonElement { ValueKind: JsonValueKind.String } element => element.GetString(),
            JsonElement element => element.ToString(),
            _ => raw.ToString()
        };

        if (text is null)
        {
            return DBNull.Value;
        }

        var type = sqlType.ToLowerInvariant();
        if (!SchemaColumnRules.TryNormalizeSqlType(sqlType, out var normalizedType)
            && !TryNormalizeLegacyNumericType(sqlType, out normalizedType))
        {
            throw new FormatException($"Unsupported PostgreSQL type '{sqlType}'.");
        }

        // Empty text is data, not NULL. For typed non-text cells, a blank finalized value is the
        // cleaning snapshot's representation of a missing value.
        if (normalizedType == "TEXT" || normalizedType.StartsWith("VARCHAR(", StringComparison.Ordinal))
        {
            return text;
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            return DBNull.Value;
        }

        if (type.Contains("bool"))
        {
            return bool.TryParse(text, out var boolValue) ? boolValue : InvalidValue(sqlType);
        }

        if (normalizedType == "SMALLINT")
        {
            return short.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var shortValue)
                ? shortValue
                : InvalidValue(sqlType);
        }

        if (normalizedType == "INTEGER")
        {
            return int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var intValue)
                ? intValue
                : InvalidValue(sqlType);
        }

        if (normalizedType == "BIGINT" || type.Contains("int"))
        {
            return long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var longValue)
                ? longValue
                : InvalidValue(sqlType);
        }

        if (normalizedType == "REAL")
        {
            return float.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var floatValue)
                ? floatValue
                : InvalidValue(sqlType);
        }

        if (normalizedType == "DOUBLE PRECISION" || type.Contains("double") || type.Contains("float"))
        {
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var doubleValue)
                ? doubleValue
                : InvalidValue(sqlType);
        }

        if (normalizedType is "NUMERIC" or "DECIMAL" || type.Contains("numeric") || type.Contains("decimal"))
        {
            return decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var decimalValue)
                ? decimalValue
                : InvalidValue(sqlType);
        }

        if (normalizedType == "DATE")
        {
            return DateOnly.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateValue)
                ? dateValue
                : InvalidValue(sqlType);
        }

        if (normalizedType is "TIMESTAMP" or "TIMESTAMPTZ" || type.Contains("timestamp"))
        {
            var styles = normalizedType == "TIMESTAMP"
                ? DateTimeStyles.AllowWhiteSpaces
                : DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal;
            if (!DateTime.TryParse(text, CultureInfo.InvariantCulture, styles, out var timestampValue))
            {
                return InvalidValue(sqlType);
            }

            return normalizedType == "TIMESTAMP"
                ? DateTime.SpecifyKind(timestampValue, DateTimeKind.Unspecified)
                : timestampValue.ToUniversalTime();
        }

        if (normalizedType == "UUID")
        {
            return Guid.TryParse(text, out var guidValue) ? guidValue : InvalidValue(sqlType);
        }

        return text;
    }

    private static object InvalidValue(string sqlType) =>
        throw new FormatException($"A finalized value cannot be converted to PostgreSQL type '{sqlType}'.");

    private static bool TryNormalizeLegacyNumericType(string sqlType, out string normalizedType)
    {
        var compact = sqlType.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
        if ((compact.StartsWith("NUMERIC(", StringComparison.Ordinal) || compact.StartsWith("DECIMAL(", StringComparison.Ordinal))
            && compact.EndsWith(')'))
        {
            normalizedType = compact.StartsWith("NUMERIC", StringComparison.Ordinal) ? "NUMERIC" : "DECIMAL";
            return true;
        }

        normalizedType = string.Empty;
        return false;
    }

    /// <summary>Creates an explicitly typed PostgreSQL null parameter. Npgsql cannot infer a
    /// store type from an untyped DBNull.Value, so nullable imported API/Excel cells must carry
    /// the generated design column's validated SQL type into deployment.</summary>
    public static NpgsqlParameter CreateDbNullParameter(string sqlType, int index)
    {
        return CreateParameter(sqlType, $"p{index}", DBNull.Value);
    }

    /// <summary>Creates a named, explicitly typed PostgreSQL parameter for both null and non-null
    /// values. Explicit typing prevents Npgsql from inferring DBNull as text, while caller-supplied
    /// coordinate names prevent EF-generated parameter names from colliding with typed nulls.</summary>
    public static NpgsqlParameter CreateParameter(string sqlType, string parameterName, object? value)
    {
        var npgsqlType = ResolveNpgsqlDbType(sqlType);
        return new NpgsqlParameter(parameterName, npgsqlType)
        {
            Value = value is null or DBNull ? DBNull.Value : value
        };
    }

    public static string BuildParameterName(int tableIndex, int rowIndex, int columnIndex)
    {
        if (tableIndex < 0 || rowIndex < 0 || columnIndex < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(tableIndex), "Parameter coordinates cannot be negative.");
        }

        return $"p_t{tableIndex}_r{rowIndex}_c{columnIndex}";
    }

    public static NpgsqlDbType ResolveNpgsqlDbType(string sqlType)
    {
        if (!SchemaColumnRules.TryNormalizeSqlType(sqlType, out var normalized)
            && !TryNormalizeLegacyNumericType(sqlType, out normalized))
        {
            throw new ArgumentException($"Unsupported PostgreSQL type '{sqlType}'.", nameof(sqlType));
        }

        return normalized switch
        {
            "SMALLINT" => NpgsqlDbType.Smallint,
            "INTEGER" => NpgsqlDbType.Integer,
            "BIGINT" => NpgsqlDbType.Bigint,
            "NUMERIC" or "DECIMAL" => NpgsqlDbType.Numeric,
            "REAL" => NpgsqlDbType.Real,
            "DOUBLE PRECISION" => NpgsqlDbType.Double,
            "BOOLEAN" => NpgsqlDbType.Boolean,
            "TEXT" => NpgsqlDbType.Text,
            "DATE" => NpgsqlDbType.Date,
            "TIMESTAMP" => NpgsqlDbType.Timestamp,
            "TIMESTAMPTZ" => NpgsqlDbType.TimestampTz,
            "UUID" => NpgsqlDbType.Uuid,
            _ when normalized.StartsWith("VARCHAR(", StringComparison.Ordinal) => NpgsqlDbType.Varchar,
            _ => throw new ArgumentException($"Unsupported PostgreSQL type '{sqlType}'.", nameof(sqlType))
        };
    }

    public static string QuoteSchemaQualified(string schemaName, string identifier) =>
        $"{SqlIdentifiers.Quote(schemaName)}.{SqlIdentifiers.QuoteIfNeeded(identifier)}";
}
