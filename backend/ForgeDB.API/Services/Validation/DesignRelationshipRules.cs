using ForgeDB.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ForgeDB.API.Services.Validation;

/// <summary>Shared relationship invariants used before every create, update, or suggestion
/// acceptance. The unique index remains the final race-condition guard in PostgreSQL.</summary>
public static class DesignRelationshipRules
{
    public const string UniqueIndexName = "UX_design_relationship_endpoint_cardinality";

    public static bool IsValidTarget(DesignColumn column) => column.IsPrimaryKey || column.IsUnique;

    public static bool HaveCompatibleTypes(DesignColumn fromColumn, DesignColumn toColumn)
    {
        return SchemaColumnRules.TryNormalizeSqlType(fromColumn.SqlType, out var fromType)
            && SchemaColumnRules.TryNormalizeSqlType(toColumn.SqlType, out var toType)
            && string.Equals(fromType, toType, StringComparison.Ordinal);
    }

    public static bool IsDuplicate(
        IEnumerable<DesignRelationship> relationships,
        int fromColumnId,
        int toColumnId,
        string cardinality,
        int? excludingRelationshipId = null)
    {
        return relationships.Any(relationship =>
            relationship.Id != excludingRelationshipId
            && relationship.FromColumnId == fromColumnId
            && relationship.ToColumnId == toColumnId
            && string.Equals(relationship.Cardinality, cardinality, StringComparison.Ordinal));
    }

    public static bool IsUniqueConstraintViolation(DbUpdateException exception)
    {
        return exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: UniqueIndexName
        };
    }
}
