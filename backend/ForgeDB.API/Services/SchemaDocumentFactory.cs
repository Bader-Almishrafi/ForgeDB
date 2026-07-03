using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ForgeDB.API.Models.DTOs;
using ForgeDB.API.Models.Entities;

namespace ForgeDB.API.Services;

internal static class SchemaDocumentFactory
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static GeneratedSchemaDocument BuildFromDataset(Dataset dataset, string schemaName)
    {
        ArgumentNullException.ThrowIfNull(dataset);

        var analysisTypes = ResolveAnalysisTypes(dataset.AnalysisResultJson);
        var usedColumnNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var columns = dataset.Columns
            .OrderBy(column => column.Id)
            .Select((column, index) =>
            {
                var detectedDataType = ResolveDetectedDataType(column, analysisTypes);

                return new SchemaColumnDto
                {
                    Name = MakeUniqueIdentifier(column.ColumnName, usedColumnNames, $"column_{index + 1}"),
                    SourceColumnName = column.ColumnName,
                    DetectedDataType = detectedDataType,
                    SqlType = MapToSqlType(detectedDataType),
                    IsNullable = column.IsNullable
                };
            })
            .ToList();

        return new GeneratedSchemaDocument
        {
            SchemaName = schemaName,
            TableName = NormalizeIdentifier(dataset.TableName, $"dataset_{dataset.Id}"),
            Columns = columns,
            Relationships = new List<SchemaRelationshipDto>()
        };
    }

    public static GeneratedSchemaDocument Deserialize(string? schemaJson)
    {
        if (string.IsNullOrWhiteSpace(schemaJson))
        {
            throw new InvalidOperationException("Stored schema definition is missing.");
        }

        try
        {
            var document = JsonSerializer.Deserialize<GeneratedSchemaDocument>(schemaJson, JsonOptions);
            if (document is null)
            {
                throw new InvalidOperationException("Stored schema definition is invalid.");
            }

            document.Columns ??= new List<SchemaColumnDto>();
            document.Relationships ??= new List<SchemaRelationshipDto>();

            return document;
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Stored schema definition contains invalid JSON.", exception);
        }
    }

    public static string Serialize(GeneratedSchemaDocument document)
    {
        return JsonSerializer.Serialize(document, JsonOptions);
    }

    public static string SerializeRelationships(IReadOnlyList<SchemaRelationshipDto> relationships)
    {
        return JsonSerializer.Serialize(relationships, JsonOptions);
    }

    public static List<SchemaRelationshipDto> NormalizeRelationships(IReadOnlyList<SchemaRelationshipDto>? relationships)
    {
        if (relationships is null)
        {
            throw new ArgumentException("Relationships are required.");
        }

        var normalizedRelationships = new List<SchemaRelationshipDto>();

        for (var index = 0; index < relationships.Count; index++)
        {
            var relationship = relationships[index];
            if (relationship is null)
            {
                throw new ArgumentException($"Relationship at position {index + 1} is required.");
            }

            var normalizedRelationship = new SchemaRelationshipDto
            {
                Name = NormalizeOptionalString(relationship.Name),
                FromTable = NormalizeRequiredString(relationship.FromTable, index, "fromTable"),
                FromColumn = NormalizeRequiredString(relationship.FromColumn, index, "fromColumn"),
                ToTable = NormalizeRequiredString(relationship.ToTable, index, "toTable"),
                ToColumn = NormalizeRequiredString(relationship.ToColumn, index, "toColumn"),
                RelationshipType = NormalizeOptionalString(relationship.RelationshipType)
            };

            normalizedRelationships.Add(normalizedRelationship);
        }

        return normalizedRelationships;
    }

    public static string GenerateSql(GeneratedSchemaDocument document)
    {
        if (document.Columns.Count == 0)
        {
            throw new InvalidOperationException("Stored schema definition must contain at least one column.");
        }

        var builder = new StringBuilder();
        builder.AppendLine($"CREATE TABLE {QuoteIdentifier(document.TableName)} (");

        for (var index = 0; index < document.Columns.Count; index++)
        {
            var column = document.Columns[index];
            var comma = index == document.Columns.Count - 1 ? string.Empty : ",";
            var nullability = column.IsNullable ? "NULL" : "NOT NULL";

            builder.AppendLine($"    {QuoteIdentifier(column.Name)} {column.SqlType} {nullability}{comma}");
        }

        builder.AppendLine(");");

        if (document.Relationships.Count == 0)
        {
            return builder.ToString().TrimEnd();
        }

        builder.AppendLine();

        var usedConstraintNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var relationship in document.Relationships)
        {
            var constraintName = MakeUniqueIdentifier(
                string.IsNullOrWhiteSpace(relationship.Name)
                    ? $"fk_{relationship.FromTable}_{relationship.FromColumn}_{relationship.ToTable}_{relationship.ToColumn}"
                    : relationship.Name,
                usedConstraintNames,
                "fk_relationship");

            builder.AppendLine(
                $"ALTER TABLE {QuoteIdentifier(relationship.FromTable)} ADD CONSTRAINT {QuoteIdentifier(constraintName)} FOREIGN KEY ({QuoteIdentifier(relationship.FromColumn)}) REFERENCES {QuoteIdentifier(relationship.ToTable)} ({QuoteIdentifier(relationship.ToColumn)});");
        }

        return builder.ToString().TrimEnd();
    }

    public static string ResolveDeploymentDatabaseName(string? databaseName, DatabaseSchema schema)
    {
        if (!string.IsNullOrWhiteSpace(databaseName))
        {
            return NormalizeIdentifier(databaseName, $"schema_{schema.Id}");
        }

        return NormalizeIdentifier(schema.SchemaName, $"schema_{schema.Id}");
    }

    private static Dictionary<string, string> ResolveAnalysisTypes(string? analysisResultJson)
    {
        var analysisTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (string.IsNullOrWhiteSpace(analysisResultJson))
        {
            return analysisTypes;
        }

        try
        {
            using var document = JsonDocument.Parse(analysisResultJson);
            if (!TryGetProperty(document.RootElement, "columns", out var columnsElement)
                || columnsElement.ValueKind != JsonValueKind.Array)
            {
                return analysisTypes;
            }

            foreach (var columnElement in columnsElement.EnumerateArray())
            {
                var columnName = GetPropertyString(columnElement, "columnName");
                var detectedDataType = GetPropertyString(columnElement, "detectedDataType");

                if (!string.IsNullOrWhiteSpace(columnName) && !string.IsNullOrWhiteSpace(detectedDataType))
                {
                    analysisTypes[columnName] = detectedDataType;
                }
            }
        }
        catch (JsonException)
        {
            return analysisTypes;
        }

        return analysisTypes;
    }

    private static string ResolveDetectedDataType(
        DatasetColumn column,
        IReadOnlyDictionary<string, string> analysisTypes)
    {
        if (analysisTypes.TryGetValue(column.ColumnName, out var analyzedType)
            && !string.IsNullOrWhiteSpace(analyzedType))
        {
            return analyzedType.Trim().ToLowerInvariant();
        }

        return string.IsNullOrWhiteSpace(column.DetectedDataType)
            ? "unknown"
            : column.DetectedDataType.Trim().ToLowerInvariant();
    }

    private static string MapToSqlType(string detectedDataType)
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

    private static string NormalizeRequiredString(string value, int relationshipIndex, string fieldName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"Relationship at position {relationshipIndex + 1} must include {fieldName}.");
        }

        return value.Trim();
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string? GetPropertyString(JsonElement element, string propertyName)
    {
        return TryGetProperty(element, propertyName, out var property)
            && property.ValueKind == JsonValueKind.String
                ? property.GetString()
                : null;
    }

    private static bool TryGetProperty(JsonElement element, string propertyName, out JsonElement value)
    {
        if (element.TryGetProperty(propertyName, out value))
        {
            return true;
        }

        var pascalName = char.ToUpperInvariant(propertyName[0]) + propertyName[1..];
        return element.TryGetProperty(pascalName, out value);
    }

    private static string MakeUniqueIdentifier(string rawValue, ISet<string> usedIdentifiers, string fallback)
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

    private static string NormalizeIdentifier(string value, string fallback)
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

    private static string QuoteIdentifier(string identifier)
    {
        return $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }
}

internal sealed class GeneratedSchemaDocument
{
    public string SchemaName { get; set; } = string.Empty;
    public string TableName { get; set; } = string.Empty;
    public List<SchemaColumnDto> Columns { get; set; } = new();
    public List<SchemaRelationshipDto> Relationships { get; set; } = new();
}
