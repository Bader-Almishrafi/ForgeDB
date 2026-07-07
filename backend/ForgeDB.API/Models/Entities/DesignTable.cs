namespace ForgeDB.API.Models.Entities;

public static class DesignOrigin
{
    public const string Generated = "generated";
    public const string User = "user";
    public const string AcceptedSuggestion = "accepted-suggestion";
}

public class DesignTable
{
    public int Id { get; set; }
    public int DesignModelId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public int? SourceDatasetId { get; set; }
    public string Origin { get; set; } = DesignOrigin.Generated;
    public DesignModel? DesignModel { get; set; }
    public Dataset? SourceDataset { get; set; }
    public ICollection<DesignColumn> Columns { get; set; } = new List<DesignColumn>();
}
