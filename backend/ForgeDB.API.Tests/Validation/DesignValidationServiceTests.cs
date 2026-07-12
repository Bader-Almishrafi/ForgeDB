using System.Linq;
using ForgeDB.API.Services.Validation;
using Xunit;

namespace ForgeDB.API.Tests.Validation;

public class DesignValidationServiceTests
{
    private readonly DesignValidationService _validationService = new();

    [Fact]
    public void Validate_CleanModel_ProducesNoBlockingErrors()
    {
        var issues = _validationService.Validate(ValidationFixtures.CleanModel());

        Assert.DoesNotContain(issues, issue => issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_DuplicateTableName_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[1].Name = "customers";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "duplicate-table-name" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_DuplicateColumnName_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[1].Columns[2].Name = "customer_id";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "duplicate-column-name" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_EmptyTableName_ProducesInvalidIdentifierError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[0].Name = "   ";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "invalid-identifier" && issue.Severity == ValidationSeverity.Error && issue.TableId == 1);
    }

    [Fact]
    public void Validate_RelationshipEndpointMissing_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Relationships[0].ToColumnId = 999;

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "relationship-endpoint-missing" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_FkTargetNeitherPrimaryKeyNorUnique_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        var targetColumn = model.Tables[0].Columns[0];
        targetColumn.IsPrimaryKey = false;
        targetColumn.IsUnique = false;

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "fk-target-not-key" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_FkColumnTypeMismatch_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[1].Columns[1].SqlType = "TEXT";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "fk-type-mismatch" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_TableWithoutPrimaryKey_ProducesWarning()
    {
        var model = ValidationFixtures.CleanModel();
        var customerIdColumn = model.Tables[0].Columns[0];
        customerIdColumn.IsPrimaryKey = false;
        customerIdColumn.IsUnique = true; // keep it a valid FK target so this test isolates one rule

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "table-without-primary-key" && issue.Severity == ValidationSeverity.Warning && issue.TableId == 1);
    }

    [Fact]
    public void Validate_ReservedWordColumnName_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[0].Columns[1].Name = "select";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "invalid-identifier" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_NullableForeignKeyColumn_ProducesWarning()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[1].Columns[1].IsNullable = true;

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "nullable-fk-column" && issue.Severity == ValidationSeverity.Warning);
    }

    [Fact]
    public void Validate_NoRelationships_ProducesIsolatedTableWarningForEachTable()
    {
        var model = ValidationFixtures.CleanModel();
        model.Relationships.Clear();

        var issues = _validationService.Validate(model);

        Assert.Equal(2, issues.Count(issue => issue.Code == "isolated-table" && issue.Severity == ValidationSeverity.Warning));
    }

    [Fact]
    public void Validate_ZeroColumnTable_ProducesError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[1].Columns.Clear();

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "zero-column-table" && issue.Severity == ValidationSeverity.Error && issue.TableId == 2);
    }

    [Fact]
    public void Validate_NullablePrimaryKey_ProducesBlockingError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[0].Columns[0].IsNullable = true;

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "nullable-primary-key" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_IdentityOnText_ProducesBlockingError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[0].Columns[1].IsAutoIncrement = true;

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "identity-unsupported-type" && issue.Severity == ValidationSeverity.Error);
    }

    [Fact]
    public void Validate_UnsafeDefault_ProducesBlockingError()
    {
        var model = ValidationFixtures.CleanModel();
        model.Tables[0].Columns[1].DefaultValue = "'ok'; DROP TABLE customers;";

        var issues = _validationService.Validate(model);

        Assert.Contains(issues, issue => issue.Code == "invalid-column-default" && issue.Severity == ValidationSeverity.Error);
    }
}
