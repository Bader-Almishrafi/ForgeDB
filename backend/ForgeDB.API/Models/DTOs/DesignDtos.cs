using System.Text.Json;
using System.Text.Json.Serialization;

namespace ForgeDB.API.Models.DTOs;

public class DesignResponseDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int Revision { get; set; }
    public string Status { get; set; } = "Draft";
    public bool IsStale { get; set; }
    public bool CanContinue { get; set; }
    public DateTime? GeneratedAt { get; set; }
    public DateTime? ValidatedAt { get; set; }
    public string? LastModifiedBy { get; set; }
    public string Source { get; set; } = "Confirmed Cleaned Data";
    public Dictionary<int, int> SourceVersions { get; set; } = new();
    public string SqlPreview { get; set; } = string.Empty;
    public JsonElement? Layout { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<DesignTableResponseDto> Tables { get; set; } = new();
    public List<DesignRelationshipResponseDto> Relationships { get; set; } = new();
    public List<ValidationIssueDto> ValidationIssues { get; set; } = new();
}

public class DesignTableResponseDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public int? SourceDatasetId { get; set; }
    public int? SourceDatasetVersionId { get; set; }
    public string? SourceName { get; set; }
    public int RowCount { get; set; }
    public string Origin { get; set; } = string.Empty;
    public List<DesignColumnResponseDto> Columns { get; set; } = new();
}

public class DesignColumnResponseDto
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
    public string? SourceColumnName { get; set; }
    public string Origin { get; set; } = string.Empty;
}

public class DesignRelationshipResponseDto
{
    public int Id { get; set; }
    public int FromColumnId { get; set; }
    public int FromTableId { get; set; }
    public string FromTableName { get; set; } = string.Empty;
    public string FromColumnName { get; set; } = string.Empty;
    public int ToColumnId { get; set; }
    public int ToTableId { get; set; }
    public string ToTableName { get; set; } = string.Empty;
    public string ToColumnName { get; set; } = string.Empty;
    public string Cardinality { get; set; } = string.Empty;
    public string OnDelete { get; set; } = string.Empty;
    public string Origin { get; set; } = string.Empty;
    public int? SuggestionId { get; set; }
}

public class ValidationIssueDto
{
    public string Code { get; set; } = string.Empty;
    public string Severity { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public int? TableId { get; set; }
    public int? ColumnId { get; set; }
    public int? RelationshipId { get; set; }
}

public class ConflictResponseDto
{
    public int CurrentRevision { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class GenerateDesignRequestDto
{
    public string Mode { get; set; } = "merge";
}

public class CreateDesignTableRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string? Comment { get; set; }
}

public class UpdateDesignTableRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string? Comment { get; set; }
}

public class CreateDesignColumnRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUnique { get; set; }
    public int Ordinal { get; set; }
    public string? SourceColumnName { get; set; }
}

public class UpdateDesignColumnRequestDto
{
    public string Name { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUnique { get; set; }
    public int Ordinal { get; set; }
}

public class CreateDesignRelationshipRequestDto
{
    public int FromColumnId { get; set; }
    public int ToColumnId { get; set; }
    public string Cardinality { get; set; } = "many-to-one";
    public string OnDelete { get; set; } = "no-action";
}

public class UpdateDesignRelationshipRequestDto
{
    public string Cardinality { get; set; } = "many-to-one";
    public string OnDelete { get; set; } = "no-action";
}

public class UpdateDesignLayoutRequestDto
{
    public JsonElement? Layout { get; set; }
}

public class ReorderDesignColumnsRequestDto
{
    public List<int> ColumnIds { get; set; } = new();
}

public class SaveDesignDraftRequestDto
{
    public List<DesignTableRenameDto> Tables { get; set; } = new();
    public List<DesignColumnDraftDto> Columns { get; set; } = new();

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnsupportedFields { get; set; }
}

public class DesignTableRenameDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnsupportedFields { get; set; }
}

public class DesignColumnDraftDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUnique { get; set; }
    public string? DefaultValue { get; set; }
    public bool IsAutoIncrement { get; set; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? UnsupportedFields { get; set; }
}

public class SchemaSqlPreviewDto
{
    public int DesignId { get; set; }
    public int Revision { get; set; }
    public string Sql { get; set; } = string.Empty;
}
