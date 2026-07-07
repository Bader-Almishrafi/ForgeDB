using ForgeDB.API.Services.Generators;

namespace ForgeDB.API.Services.Validation;

public interface IDesignValidationService
{
    List<ValidationIssue> Validate(DesignModelSnapshot snapshot);
}
