using System.Text.Json;
using System.Text.Json.Serialization;

namespace ForgeDB.API.Services.Generators;

/// <summary>Emits a documented, versioned JSON representation of the design model.</summary>
public class JsonSchemaGenerator : IDesignSchemaGenerator
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public string Format => "json";

    public string Generate(DesignModelSnapshot snapshot)
    {
        var document = new JsonSchemaDocument
        {
            FormatVersion = 1,
            Tables = snapshot.Tables.Select(table => new JsonSchemaTable
            {
                Id = table.Id,
                Name = table.Name,
                Comment = table.Comment,
                Columns = table.Columns
                    .OrderBy(column => column.Ordinal)
                    .Select(column => new JsonSchemaColumn
                    {
                        Id = column.Id,
                        Name = column.Name,
                        SqlType = column.SqlType,
                        IsNullable = column.IsNullable,
                        IsPrimaryKey = column.IsPrimaryKey,
                        IsUnique = column.IsUnique,
                        DefaultValue = column.DefaultValue,
                        IsAutoIncrement = column.IsAutoIncrement,
                        Ordinal = column.Ordinal
                    })
                    .ToList()
            }).ToList(),
            Relationships = snapshot.Relationships.Select(relationship => new JsonSchemaRelationship
            {
                Id = relationship.Id,
                FromTable = relationship.FromTableName,
                FromColumn = relationship.FromColumnName,
                ToTable = relationship.ToTableName,
                ToColumn = relationship.ToColumnName,
                Cardinality = relationship.Cardinality,
                OnDelete = relationship.OnDelete
            }).ToList(),
            Metadata = new JsonSchemaMetadata
            {
                ProjectId = snapshot.ProjectId,
                Revision = snapshot.Revision,
                GeneratedAt = snapshot.GeneratedAt
            }
        };

        return JsonSerializer.Serialize(document, JsonOptions);
    }

    private sealed class JsonSchemaDocument
    {
        public int FormatVersion { get; set; }
        public List<JsonSchemaTable> Tables { get; set; } = new();
        public List<JsonSchemaRelationship> Relationships { get; set; } = new();
        public JsonSchemaMetadata Metadata { get; set; } = new();
    }

    private sealed class JsonSchemaTable
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Comment { get; set; }
        public List<JsonSchemaColumn> Columns { get; set; } = new();
    }

    private sealed class JsonSchemaColumn
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string SqlType { get; set; } = string.Empty;
        public bool IsNullable { get; set; }
        public bool IsPrimaryKey { get; set; }
        public bool IsUnique { get; set; }
        public string? DefaultValue { get; set; }
        public bool IsAutoIncrement { get; set; }
        public int Ordinal { get; set; }
    }

    private sealed class JsonSchemaRelationship
    {
        public int Id { get; set; }
        public string FromTable { get; set; } = string.Empty;
        public string FromColumn { get; set; } = string.Empty;
        public string ToTable { get; set; } = string.Empty;
        public string ToColumn { get; set; } = string.Empty;
        public string Cardinality { get; set; } = string.Empty;
        public string OnDelete { get; set; } = string.Empty;
    }

    private sealed class JsonSchemaMetadata
    {
        public int ProjectId { get; set; }
        public int Revision { get; set; }
        public DateTime GeneratedAt { get; set; }
    }
}
