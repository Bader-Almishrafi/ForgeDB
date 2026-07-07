using ForgeDB.API.Models.DTOs;

namespace ForgeDB.API.Services.Exceptions;

/// <summary>Thrown by the export path when the design has one or more error-severity validation
/// issues; the export must not be produced until they are resolved.</summary>
public class DesignValidationFailedException : Exception
{
    public List<ValidationIssueDto> Issues { get; }

    public DesignValidationFailedException(List<ValidationIssueDto> issues)
        : base("Design has unresolved validation errors and cannot be exported.")
    {
        Issues = issues;
    }
}
