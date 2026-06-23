namespace ForgeDB.API.Models.Entities;

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
    public ICollection<DatabaseSchema> DatabaseSchemas { get; set; } = new List<DatabaseSchema>();
    public ICollection<DatabaseDeployment> DatabaseDeployments { get; set; } = new List<DatabaseDeployment>();
}
