namespace ForgeDB.API.Services.Validation;

public static class ValidationSeverity
{
    public const string Error = "error";
    public const string Warning = "warning";
}

public class ValidationIssue
{
    public string Code { get; set; } = string.Empty;
    public string Severity { get; set; } = ValidationSeverity.Warning;
    public string Message { get; set; } = string.Empty;
    public int? TableId { get; set; }
    public int? ColumnId { get; set; }
    public int? RelationshipId { get; set; }
}
