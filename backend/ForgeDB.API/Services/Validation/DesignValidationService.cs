using ForgeDB.API.Services.Generators;

namespace ForgeDB.API.Services.Validation;

/// <summary>
/// Computes validation issues from a DesignModelSnapshot on demand — never persisted. Operates
/// on the same snapshot DTO the generators consume, so previews, exports, and validation always
/// agree on the same data.
///
/// Skipped rule: "profile/type risk" (stored values incompatible with the chosen SqlType) is not
/// implemented. It would require re-reading Dataset row values via the repository layer, which
/// this engine deliberately does not have access to (it only sees the generator snapshot) — the
/// prompt allows skipping this rule when it isn't cheap, and re-plumbing dataset rows into a
/// validation-only path was judged out of scope for Phase 1.
/// </summary>
public class DesignValidationService : IDesignValidationService
{
    public List<ValidationIssue> Validate(DesignModelSnapshot snapshot)
    {
        var issues = new List<ValidationIssue>();

        ValidateTables(snapshot, issues);
        ValidateRelationships(snapshot, issues);

        return issues;
    }

    private static void ValidateTables(DesignModelSnapshot snapshot, List<ValidationIssue> issues)
    {
        var tableNameGroups = snapshot.Tables
            .GroupBy(table => table.Name, StringComparer.OrdinalIgnoreCase);

        foreach (var group in tableNameGroups.Where(group => group.Count() > 1))
        {
            foreach (var table in group)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "duplicate-table-name",
                    Severity = ValidationSeverity.Error,
                    Message = $"Table name '{table.Name}' is used by more than one table.",
                    TableId = table.Id
                });
            }
        }

        var referencedTableIds = snapshot.Relationships
            .SelectMany(relationship => new[] { relationship.FromTableId, relationship.ToTableId })
            .ToHashSet();

        foreach (var table in snapshot.Tables)
        {
            if (SqlIdentifiers.IsUnusableEvenQuoted(table.Name))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "invalid-identifier",
                    Severity = ValidationSeverity.Error,
                    Message = $"Table name '{table.Name}' is empty or too long to be a valid identifier, even when quoted.",
                    TableId = table.Id
                });
            }
            else if (SqlIdentifiers.IsReservedWord(table.Name))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "reserved-word-identifier",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table name '{table.Name}' is a PostgreSQL reserved word and will be quoted in generated SQL.",
                    TableId = table.Id
                });
            }

            if (table.Columns.Count == 0)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "zero-column-table",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table '{table.Name}' has no columns.",
                    TableId = table.Id
                });
            }

            if (!table.Columns.Any(column => column.IsPrimaryKey))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "table-without-primary-key",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table '{table.Name}' does not have a primary key.",
                    TableId = table.Id
                });
            }

            if (!referencedTableIds.Contains(table.Id))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "isolated-table",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table '{table.Name}' has no relationships to or from any other table.",
                    TableId = table.Id
                });
            }

            var columnNameGroups = table.Columns.GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase);
            foreach (var group in columnNameGroups.Where(group => group.Count() > 1))
            {
                foreach (var column in group)
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "duplicate-column-name",
                        Severity = ValidationSeverity.Error,
                        Message = $"Column name '{column.Name}' is used more than once in table '{table.Name}'.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
            }

            foreach (var column in table.Columns)
            {
                if (SqlIdentifiers.IsUnusableEvenQuoted(column.Name))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "invalid-identifier",
                        Severity = ValidationSeverity.Error,
                        Message = $"Column name '{column.Name}' in table '{table.Name}' is empty or too long to be a valid identifier, even when quoted.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
                else if (SqlIdentifiers.IsReservedWord(column.Name))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "reserved-word-identifier",
                        Severity = ValidationSeverity.Warning,
                        Message = $"Column name '{column.Name}' in table '{table.Name}' is a PostgreSQL reserved word and will be quoted in generated SQL.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
            }
        }
    }

    private static void ValidateRelationships(DesignModelSnapshot snapshot, List<ValidationIssue> issues)
    {
        var columnsById = snapshot.Tables
            .SelectMany(table => table.Columns)
            .ToDictionary(column => column.Id);

        foreach (var relationship in snapshot.Relationships)
        {
            var hasFromColumn = columnsById.TryGetValue(relationship.FromColumnId, out var fromColumn);
            var hasToColumn = columnsById.TryGetValue(relationship.ToColumnId, out var toColumn);

            if (!hasFromColumn || !hasToColumn)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "relationship-endpoint-missing",
                    Severity = ValidationSeverity.Error,
                    Message = "Relationship references a column that no longer exists.",
                    RelationshipId = relationship.Id
                });
                continue;
            }

            if (!toColumn!.IsPrimaryKey && !toColumn.IsUnique)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "fk-target-not-key",
                    Severity = ValidationSeverity.Error,
                    Message = $"Relationship target '{relationship.ToTableName}.{relationship.ToColumnName}' is neither a primary key nor unique.",
                    RelationshipId = relationship.Id,
                    TableId = relationship.ToTableId,
                    ColumnId = relationship.ToColumnId
                });
            }

            if (!string.Equals(fromColumn!.SqlType.Trim(), toColumn.SqlType.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "fk-type-mismatch",
                    Severity = ValidationSeverity.Error,
                    Message = $"Relationship columns have mismatched types: '{relationship.FromTableName}.{relationship.FromColumnName}' ({fromColumn.SqlType}) vs '{relationship.ToTableName}.{relationship.ToColumnName}' ({toColumn.SqlType}).",
                    RelationshipId = relationship.Id
                });
            }

            if (fromColumn.IsNullable)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "nullable-fk-column",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Foreign key column '{relationship.FromTableName}.{relationship.FromColumnName}' is nullable.",
                    RelationshipId = relationship.Id,
                    TableId = relationship.FromTableId,
                    ColumnId = relationship.FromColumnId
                });
            }
        }
    }
}
