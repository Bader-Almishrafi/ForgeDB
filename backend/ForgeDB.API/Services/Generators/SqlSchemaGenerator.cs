using System.Text;

namespace ForgeDB.API.Services.Generators;

/// <summary>PostgreSQL DDL generator: topologically orders tables by FK dependency, inlining
/// foreign keys into CREATE TABLE when possible; falls back to CREATE TABLE followed by
/// ALTER TABLE ADD CONSTRAINT when the relationship graph has a cycle.</summary>
public class SqlSchemaGenerator : IDesignSchemaGenerator
{
    public string Format => "sql";

    public string Generate(DesignModelSnapshot snapshot)
    {
        var builder = new StringBuilder();
        builder.AppendLine("BEGIN;");
        builder.AppendLine();

        var (orderedTables, cycleFallback) = OrderTablesByDependency(snapshot.Tables, snapshot.Relationships);

        var relationshipsByFromTable = snapshot.Relationships
            .GroupBy(relationship => relationship.FromTableId)
            .ToDictionary(group => group.Key, group => group.ToList());

        foreach (var table in orderedTables)
        {
            var inlineForeignKeys = cycleFallback ? null : relationshipsByFromTable.GetValueOrDefault(table.Id);
            AppendCreateTable(builder, table, inlineForeignKeys);
            builder.AppendLine();
        }

        if (cycleFallback && snapshot.Relationships.Count > 0)
        {
            var usedConstraintNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var relationship in snapshot.Relationships)
            {
                builder.AppendLine(BuildAlterTableForeignKey(relationship, usedConstraintNames));
            }

            builder.AppendLine();
        }

        if (snapshot.Relationships.Count > 0)
        {
            var usedIndexNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var relationship in snapshot.Relationships)
            {
                builder.AppendLine(BuildForeignKeyIndex(relationship, usedIndexNames));
            }

            builder.AppendLine();
        }

        var commentedTables = snapshot.Tables.Where(table => !string.IsNullOrWhiteSpace(table.Comment)).ToList();
        if (commentedTables.Count > 0)
        {
            foreach (var table in commentedTables)
            {
                builder.AppendLine(
                    $"COMMENT ON TABLE {Quote(table.Name)} IS '{EscapeLiteral(table.Comment!)}';");
            }

            builder.AppendLine();
        }

        builder.AppendLine("COMMIT;");

        return builder.ToString().TrimEnd() + "\n";
    }

    private static void AppendCreateTable(
        StringBuilder builder,
        DesignTableSnapshot table,
        List<DesignRelationshipSnapshot>? inlineForeignKeys)
    {
        var orderedColumns = table.Columns.OrderBy(column => column.Ordinal).ToList();
        var lines = new List<string>();

        foreach (var column in orderedColumns)
        {
            var nullability = column.IsNullable ? "NULL" : "NOT NULL";
            var uniqueness = column.IsUnique && !column.IsPrimaryKey ? " UNIQUE" : string.Empty;
            lines.Add($"    {Quote(column.Name)} {column.SqlType} {nullability}{uniqueness}");
        }

        var primaryKeyColumns = orderedColumns.Where(column => column.IsPrimaryKey).ToList();
        if (primaryKeyColumns.Count > 0)
        {
            var pkColumnList = string.Join(", ", primaryKeyColumns.Select(column => Quote(column.Name)));
            lines.Add($"    PRIMARY KEY ({pkColumnList})");
        }

        if (inlineForeignKeys is not null)
        {
            foreach (var relationship in inlineForeignKeys)
            {
                lines.Add($"    {BuildInlineForeignKeyClause(relationship)}");
            }
        }

        builder.AppendLine($"CREATE TABLE {Quote(table.Name)} (");
        builder.AppendLine(string.Join(",\n", lines));
        builder.AppendLine(");");
    }

    private static string BuildInlineForeignKeyClause(DesignRelationshipSnapshot relationship)
    {
        return $"FOREIGN KEY ({Quote(relationship.FromColumnName)}) REFERENCES {Quote(relationship.ToTableName)} ({Quote(relationship.ToColumnName)}) ON DELETE {MapOnDelete(relationship.OnDelete)}";
    }

    private static string BuildAlterTableForeignKey(DesignRelationshipSnapshot relationship, ISet<string> usedConstraintNames)
    {
        var constraintName = MakeUnique(
            $"fk_{relationship.FromTableName}_{relationship.FromColumnName}",
            usedConstraintNames);

        return $"ALTER TABLE {Quote(relationship.FromTableName)} ADD CONSTRAINT {Quote(constraintName)} FOREIGN KEY ({Quote(relationship.FromColumnName)}) REFERENCES {Quote(relationship.ToTableName)} ({Quote(relationship.ToColumnName)}) ON DELETE {MapOnDelete(relationship.OnDelete)};";
    }

    private static string BuildForeignKeyIndex(DesignRelationshipSnapshot relationship, ISet<string> usedIndexNames)
    {
        var indexName = MakeUnique(
            $"ix_{relationship.FromTableName}_{relationship.FromColumnName}",
            usedIndexNames);

        return $"CREATE INDEX {Quote(indexName)} ON {Quote(relationship.FromTableName)} ({Quote(relationship.FromColumnName)});";
    }

    private static string MapOnDelete(string onDelete)
    {
        return onDelete switch
        {
            "cascade" => "CASCADE",
            "set-null" => "SET NULL",
            _ => "NO ACTION"
        };
    }

    private static string MakeUnique(string baseName, ISet<string> used)
    {
        var normalized = baseName.ToLowerInvariant();
        var candidate = normalized;
        var suffix = 2;

        while (!used.Add(candidate))
        {
            candidate = $"{normalized}_{suffix}";
            suffix++;
        }

        return candidate;
    }

    /// <summary>Orders tables so every FK target is created before its referencing table.
    /// Returns (original order, true) if the relationship graph has a cycle, signalling the
    /// caller to fall back to ALTER TABLE ADD CONSTRAINT for every foreign key.</summary>
    private static (List<DesignTableSnapshot> Ordered, bool CycleFallback) OrderTablesByDependency(
        List<DesignTableSnapshot> tables,
        List<DesignRelationshipSnapshot> relationships)
    {
        var byId = tables.ToDictionary(table => table.Id);
        var dependsOn = relationships
            .Where(relationship => relationship.FromTableId != relationship.ToTableId)
            .Select(relationship => (relationship.FromTableId, relationship.ToTableId))
            .Distinct()
            .GroupBy(edge => edge.FromTableId)
            .ToDictionary(group => group.Key, group => group.Select(edge => edge.ToTableId).ToList());

        var state = new Dictionary<int, int>();
        var order = new List<DesignTableSnapshot>();
        var hasCycle = false;

        void Visit(int tableId)
        {
            if (hasCycle || !byId.ContainsKey(tableId))
            {
                return;
            }

            if (state.TryGetValue(tableId, out var currentState))
            {
                if (currentState == 1)
                {
                    hasCycle = true;
                    return;
                }

                if (currentState == 2)
                {
                    return;
                }
            }

            state[tableId] = 1;

            if (dependsOn.TryGetValue(tableId, out var dependencies))
            {
                foreach (var dependencyId in dependencies)
                {
                    Visit(dependencyId);
                    if (hasCycle)
                    {
                        return;
                    }
                }
            }

            state[tableId] = 2;
            order.Add(byId[tableId]);
        }

        foreach (var table in tables.OrderBy(table => table.Id))
        {
            Visit(table.Id);
            if (hasCycle)
            {
                break;
            }
        }

        return hasCycle
            ? (tables.OrderBy(table => table.Id).ToList(), true)
            : (order, false);
    }

    private static string Quote(string identifier)
    {
        return SqlIdentifiers.QuoteIfNeeded(identifier);
    }

    private static string EscapeLiteral(string value)
    {
        return value.Replace("'", "''", StringComparison.Ordinal);
    }
}
