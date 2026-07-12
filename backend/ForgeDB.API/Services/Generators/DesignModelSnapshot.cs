namespace ForgeDB.API.Services.Generators;

/// <summary>
/// Pure, DbContext-free representation of a DesignModel used by every generator and by the
/// validation engine, so preview, export, and validation always see identical data.
/// </summary>
public sealed class DesignModelSnapshot
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public int Revision { get; set; }
    public DateTime GeneratedAt { get; set; }
    public List<DesignTableSnapshot> Tables { get; set; } = new();
    public List<DesignRelationshipSnapshot> Relationships { get; set; } = new();
}

public sealed class DesignTableSnapshot
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public string? SourceName { get; set; }
    public List<DesignColumnSnapshot> Columns { get; set; } = new();
}

public sealed class DesignColumnSnapshot
{
    public int Id { get; set; }
    public int TableId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUnique { get; set; }
    public string? DefaultValue { get; set; }
    public bool IsAutoIncrement { get; set; }
    public int Ordinal { get; set; }
    public string? SourceName { get; set; }
}

public sealed class DesignRelationshipSnapshot
{
    public int Id { get; set; }
    public int FromTableId { get; set; }
    public string FromTableName { get; set; } = string.Empty;
    public int FromColumnId { get; set; }
    public string FromColumnName { get; set; } = string.Empty;
    public int ToTableId { get; set; }
    public string ToTableName { get; set; } = string.Empty;
    public int ToColumnId { get; set; }
    public string ToColumnName { get; set; } = string.Empty;
    public string Cardinality { get; set; } = string.Empty;
    public string OnDelete { get; set; } = string.Empty;
}
