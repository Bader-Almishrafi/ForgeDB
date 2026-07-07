namespace ForgeDB.API.Models.Entities;

public class DesignColumn
{
    public int Id { get; set; }
    public int DesignTableId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SqlType { get; set; } = string.Empty;
    public bool IsNullable { get; set; }
    public bool IsPrimaryKey { get; set; }
    public bool IsUnique { get; set; }
    public int Ordinal { get; set; }
    public string? SourceColumnName { get; set; }
    public string Origin { get; set; } = DesignOrigin.Generated;
    public DesignTable? DesignTable { get; set; }
}
