namespace ForgeDB.API.Models.Entities;

public static class DesignCardinality
{
    public const string ManyToOne = "many-to-one";
    public const string OneToOne = "one-to-one";
}

public static class DesignOnDelete
{
    public const string NoAction = "no-action";
    public const string Cascade = "cascade";
    public const string SetNull = "set-null";
}

public class DesignRelationship
{
    public int Id { get; set; }
    public int DesignModelId { get; set; }
    public int FromColumnId { get; set; }
    public int ToColumnId { get; set; }
    public string Cardinality { get; set; } = DesignCardinality.ManyToOne;
    public string OnDelete { get; set; } = DesignOnDelete.NoAction;
    public string Origin { get; set; } = DesignOrigin.User;
    public int? SuggestionId { get; set; }
    public DesignModel? DesignModel { get; set; }
    public DesignColumn? FromColumn { get; set; }
    public DesignColumn? ToColumn { get; set; }
    public RelationshipSuggestion? Suggestion { get; set; }
}
