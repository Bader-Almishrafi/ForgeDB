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
            if (!string.IsNullOrWhiteSpace(table.SourceName)
                && !string.Equals(table.Name, table.SourceName, StringComparison.Ordinal))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "generated-name-differs-from-source",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table name '{table.Name}' differs from source name '{table.SourceName}'.",
                    TableId = table.Id
                });
            }
            if (!SqlIdentifiers.IsValidEditableIdentifier(table.Name))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "invalid-identifier",
                    Severity = ValidationSeverity.Error,
                    Message = $"Table name '{table.Name}' must start with a letter or underscore, contain only letters, digits, or underscores, be at most 63 characters, and not be a PostgreSQL reserved keyword.",
                    TableId = table.Id
                });
            }
            if (table.Columns.Count == 0)
            {
                issues.Add(new ValidationIssue
                {
                    Code = "zero-column-table",
                    Severity = ValidationSeverity.Error,
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

            if (!table.Columns.Any(column => column.IsUnique || column.IsPrimaryKey))
            {
                issues.Add(new ValidationIssue
                {
                    Code = "table-without-unique-constraint",
                    Severity = ValidationSeverity.Warning,
                    Message = $"Table '{table.Name}' does not have a primary key or unique constraint.",
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
                if (!string.IsNullOrWhiteSpace(column.SourceName)
                    && !string.Equals(column.Name, column.SourceName, StringComparison.Ordinal))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "generated-name-differs-from-source",
                        Severity = ValidationSeverity.Warning,
                        Message = $"Column name '{table.Name}.{column.Name}' differs from source name '{column.SourceName}'.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
                if (!SqlIdentifiers.IsValidEditableIdentifier(column.Name))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "invalid-identifier",
                        Severity = ValidationSeverity.Error,
                        Message = $"Column name '{column.Name}' in table '{table.Name}' must start with a letter or underscore, contain only letters, digits, or underscores, be at most 63 characters, and not be a PostgreSQL reserved keyword.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
                if (!SchemaColumnRules.TryNormalizeSqlType(column.SqlType, out _))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "unsupported-sql-type",
                        Severity = ValidationSeverity.Error,
                        Message = $"Column '{table.Name}.{column.Name}' uses unsupported PostgreSQL type '{column.SqlType}'.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }

                if (column.IsPrimaryKey && column.IsNullable)
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "nullable-primary-key",
                        Severity = ValidationSeverity.Error,
                        Message = $"Primary-key column '{table.Name}.{column.Name}' is marked nullable.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }

                if (column.IsAutoIncrement && !SchemaColumnRules.IsIdentityCompatible(column.SqlType))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "identity-unsupported-type",
                        Severity = ValidationSeverity.Error,
                        Message = $"Identity column '{table.Name}.{column.Name}' must use SMALLINT, INTEGER, or BIGINT.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }

                if (column.IsAutoIncrement && column.IsNullable)
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "nullable-identity-column",
                        Severity = ValidationSeverity.Error,
                        Message = $"Identity column '{table.Name}.{column.Name}' must be NOT NULL.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }

                if (column.IsAutoIncrement && !string.IsNullOrWhiteSpace(column.DefaultValue))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "identity-default-conflict",
                        Severity = ValidationSeverity.Error,
                        Message = $"Identity column '{table.Name}.{column.Name}' cannot also define a default.",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }
                else if (!SchemaColumnRules.TryNormalizeDefault(column.DefaultValue, column.SqlType, out _, out var defaultError))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "invalid-column-default",
                        Severity = ValidationSeverity.Error,
                        Message = $"Column '{table.Name}.{column.Name}' has an invalid default. {defaultError}",
                        TableId = table.Id,
                        ColumnId = column.Id
                    });
                }

                if (column.SqlType.Trim().Equals("TEXT", StringComparison.OrdinalIgnoreCase))
                {
                    issues.Add(new ValidationIssue
                    {
                        Code = "unbounded-text-type",
                        Severity = ValidationSeverity.Warning,
                        Message = $"Column '{table.Name}.{column.Name}' uses an unbounded TEXT type.",
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

            SchemaColumnRules.TryNormalizeSqlType(fromColumn!.SqlType, out var fromType);
            SchemaColumnRules.TryNormalizeSqlType(toColumn.SqlType, out var toType);
            if (!string.Equals(fromType, toType, StringComparison.Ordinal))
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
