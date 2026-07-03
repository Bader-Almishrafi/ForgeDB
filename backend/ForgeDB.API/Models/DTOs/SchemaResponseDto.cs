namespace ForgeDB.API.Models.DTOs;

public class SchemaResponseDto
{
    public int Id { get; set; }
    public int SchemaId { get; set; }
    public int ProjectId { get; set; }
    public int DatasetId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
    public string GeneratedTableName { get; set; } = string.Empty;
    public IReadOnlyList<SchemaColumnDto> GeneratedColumns { get; set; } = new List<SchemaColumnDto>();
    public string SqlPreview { get; set; } = string.Empty;
    public IReadOnlyList<SchemaRelationshipDto> Relationships { get; set; } = new List<SchemaRelationshipDto>();
    public string? DbmlContent { get; set; }
    public string? SchemaJson { get; set; }
    public string? SqlContent { get; set; }
    public string? RelationshipsJson { get; set; }
    public int Version { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public class SchemaColumnDto
{
    public string Name { get; set; } = string.Empty;
    public string SourceColumnName { get; set; } = string.Empty;
    public string DetectedDataType { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
}

public class SchemaRelationshipDto
{
    public string? Name { get; set; }
    public string FromTable { get; set; } = string.Empty;
    public string FromColumn { get; set; } = string.Empty;
    public string ToTable { get; set; } = string.Empty;
    public string ToColumn { get; set; } = string.Empty;
    public string? RelationshipType { get; set; }
}
