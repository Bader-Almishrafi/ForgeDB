namespace ForgeDB.API.Models.Entities;

// EF Core entity representing the projects PostgreSQL row and its relationships. DTOs map this
// persistence model into explicit API contracts instead of serializing the navigation graph.
public class Project
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? DashboardConfig { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public User? User { get; set; }
    public ICollection<Dataset> Datasets { get; set; } = new List<Dataset>();
    public DesignModel? Design { get; set; }
    public ICollection<RelationshipSuggestion> RelationshipSuggestions { get; set; } = new List<RelationshipSuggestion>();
    public ICollection<CleaningBatch> CleaningBatches { get; set; } = new List<CleaningBatch>();
    public ProjectCleaningState? CleaningState { get; set; }
}
