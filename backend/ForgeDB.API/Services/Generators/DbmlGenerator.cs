using System.Text;

namespace ForgeDB.API.Services.Generators;

/// <summary>Emits DBML pasteable into dbdiagram.io: tables with column settings, and Refs with
/// cardinality markers (`>` many-to-one, `-` one-to-one).</summary>
public class DbmlGenerator : IDesignSchemaGenerator
{
    public string Format => "dbml";

    public string Generate(DesignModelSnapshot snapshot)
    {
        var builder = new StringBuilder();

        builder.AppendLine($"Project {Identifier(snapshot.ProjectName)} {{");
        builder.AppendLine("  database_type: \"PostgreSQL\"");
        builder.AppendLine("}");
        builder.AppendLine();

        foreach (var table in snapshot.Tables)
        {
            builder.AppendLine($"Table {Identifier(table.Name)} {{");

            foreach (var column in table.Columns.OrderBy(c => c.Ordinal))
            {
                var settings = BuildColumnSettings(column);
                var settingsSuffix = settings.Count > 0 ? $" [{string.Join(", ", settings)}]" : string.Empty;
                builder.AppendLine($"  {Identifier(column.Name)} {DbmlType(column.SqlType)}{settingsSuffix}");
            }

            if (!string.IsNullOrWhiteSpace(table.Comment))
            {
                builder.AppendLine();
                builder.AppendLine($"  Note: '{EscapeLiteral(table.Comment)}'");
            }

            builder.AppendLine("}");
            builder.AppendLine();
        }

        foreach (var relationship in snapshot.Relationships)
        {
            var marker = relationship.Cardinality == "one-to-one" ? "-" : ">";
            builder.AppendLine(
                $"Ref: {Identifier(relationship.FromTableName)}.{Identifier(relationship.FromColumnName)} {marker} {Identifier(relationship.ToTableName)}.{Identifier(relationship.ToColumnName)}");
        }

        return builder.ToString().TrimEnd() + "\n";
    }

    private static List<string> BuildColumnSettings(DesignColumnSnapshot column)
    {
        var settings = new List<string>();

        if (column.IsPrimaryKey)
        {
            settings.Add("pk");
        }
        else if (column.IsUnique)
        {
            settings.Add("unique");
        }

        if (!column.IsNullable)
        {
            settings.Add("not null");
        }

        if (column.IsAutoIncrement)
        {
            settings.Add("increment");
        }

        if (!string.IsNullOrWhiteSpace(column.DefaultValue))
        {
            settings.Add($"default: `{column.DefaultValue}`");
        }

        return settings;
    }

    private static string DbmlType(string sqlType)
    {
        return string.IsNullOrWhiteSpace(sqlType) ? "text" : sqlType.Trim().Replace(' ', '_').ToLowerInvariant();
    }

    private static string Identifier(string value)
    {
        var trimmed = string.IsNullOrWhiteSpace(value) ? "unnamed" : value.Trim();
        return SqlIdentifiers.IsSafeLowercaseIdentifier(trimmed) && !SqlIdentifiers.IsReservedWord(trimmed)
            ? trimmed
            : $"\"{trimmed.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }

    private static string EscapeLiteral(string value)
    {
        return value.Replace("'", "\\'", StringComparison.Ordinal);
    }
}
