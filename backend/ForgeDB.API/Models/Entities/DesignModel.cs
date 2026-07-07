namespace ForgeDB.API.Models.Entities;

public class DesignModel
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int Revision { get; set; } = 1;
    public string? LayoutJson { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public Project? Project { get; set; }
    public ICollection<DesignTable> Tables { get; set; } = new List<DesignTable>();
    public ICollection<DesignRelationship> Relationships { get; set; } = new List<DesignRelationship>();
}
