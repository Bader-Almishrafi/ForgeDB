using System.Text;
using ForgeDB.API.Models.Entities;
using ForgeDB.API.Repositories.Interfaces;

namespace ForgeDB.API.Services;

public sealed record DeploymentSqlArtifacts(
    string SchemaSql,
    string SeedSql,
    string DeploySql,
    string PreSeedDdlSql,
    string PostSeedDdlSql);

/// <summary>Builds deterministic, executable SQL artifacts from a validated deployment plan.</summary>
public static class PostgreSqlDeploymentSqlGenerator
{
    public const int InsertBatchSize = 500;

    public static DeploymentSqlArtifacts Generate(
        string schemaName,
        string generatedSchemaSql,
        IReadOnlyList<TableInsertPlan> insertPlans,
        IReadOnlyList<DesignRelationship>? relationships = null)
    {
        var ddl = DeploymentPlanBuilder.StripTransactionWrapper(generatedSchemaSql);
        var (preSeedDdl, postSeedDdl) = relationships is null
            ? SplitDeferredForeignKeys(ddl)
            : DeferAllForeignKeys(ddl, relationships);
        var seedBody = GenerateSeedBody(schemaName, insertPlans);

        return new DeploymentSqlArtifacts(
            BuildSchemaSql(schemaName, ddl),
            BuildSeedSql(schemaName, seedBody),
            BuildDeploySql(schemaName, preSeedDdl, seedBody, postSeedDdl),
            preSeedDdl,
            postSeedDdl);
    }

    public static string GenerateSeedSql(string schemaName, IReadOnlyList<TableInsertPlan> insertPlans) =>
        BuildSeedSql(schemaName, GenerateSeedBody(schemaName, insertPlans));

    private static string BuildSchemaSql(string schemaName, string ddl)
    {
        var schema = PostgreSqlSqlFormatter.Identifier(schemaName);
        var builder = new StringBuilder();
        builder.AppendLine("BEGIN;");
        builder.AppendLine($"CREATE SCHEMA IF NOT EXISTS {schema};");
        builder.AppendLine($"SET LOCAL search_path TO {schema}, public;");
        builder.AppendLine();
        builder.AppendLine(ddl.Trim());
        builder.AppendLine();
        builder.AppendLine("COMMIT;");
        return builder.ToString();
    }

    private static string BuildSeedSql(string schemaName, string seedBody)
    {
        var builder = new StringBuilder();
        builder.AppendLine("BEGIN;");
        builder.AppendLine($"SET LOCAL search_path TO {PostgreSqlSqlFormatter.Identifier(schemaName)}, public;");
        builder.AppendLine();
        builder.AppendLine(seedBody);
        builder.AppendLine();
        builder.AppendLine("COMMIT;");
        return builder.ToString();
    }

    private static string BuildDeploySql(string schemaName, string preSeedDdl, string seedBody, string postSeedDdl)
    {
        var schema = PostgreSqlSqlFormatter.Identifier(schemaName);
        var builder = new StringBuilder();
        builder.AppendLine("BEGIN;");
        builder.AppendLine($"DROP SCHEMA IF EXISTS {schema} CASCADE;");
        builder.AppendLine($"CREATE SCHEMA {schema};");
        builder.AppendLine($"SET LOCAL search_path TO {schema}, public;");
        builder.AppendLine();
        builder.AppendLine("-- Schema");
        builder.AppendLine(preSeedDdl.Trim());
        builder.AppendLine();
        builder.AppendLine("-- Finalized cleaned data");
        builder.AppendLine(seedBody);

        if (!string.IsNullOrWhiteSpace(postSeedDdl))
        {
            builder.AppendLine();
            builder.AppendLine("-- Foreign keys deferred until after seed insertion");
            builder.AppendLine(postSeedDdl.Trim());
        }

        builder.AppendLine();
        builder.AppendLine("COMMIT;");
        return builder.ToString();
    }

    private static string GenerateSeedBody(string schemaName, IReadOnlyList<TableInsertPlan> insertPlans)
    {
        var builder = new StringBuilder();
        var statements = 0;

        foreach (var plan in insertPlans)
        {
            if (plan.Rows.Count == 0)
            {
                continue;
            }

            if (plan.ColumnNames.Count == 0)
            {
                foreach (var _ in plan.Rows)
                {
                    builder.AppendLine($"INSERT INTO {PostgreSqlSqlFormatter.QualifiedIdentifier(schemaName, plan.TableName)} DEFAULT VALUES;");
                    statements++;
                }
                continue;
            }

            if (plan.ColumnNames.Count != plan.ColumnSqlTypes.Count
                || plan.Rows.Any(row => row.Length != plan.ColumnNames.Count))
            {
                throw new InvalidOperationException($"Insert plan for table '{plan.TableName}' is inconsistent.");
            }

            var table = PostgreSqlSqlFormatter.QualifiedIdentifier(schemaName, plan.TableName);
            var columns = string.Join(", ", plan.ColumnNames.Select(PostgreSqlSqlFormatter.Identifier));
            foreach (var batch in plan.Rows.Chunk(InsertBatchSize))
            {
                builder.AppendLine($"INSERT INTO {table} ({columns})");
                builder.AppendLine("VALUES");
                for (var index = 0; index < batch.Length; index++)
                {
                    var values = string.Join(", ", batch[index].Select(PostgreSqlSqlFormatter.Literal));
                    builder.Append("    (").Append(values).Append(')')
                        .AppendLine(index == batch.Length - 1 ? ";" : ",");
                }
                builder.AppendLine();
                statements++;
            }

            foreach (var identityColumn in plan.IdentityColumnNames)
            {
                builder.AppendLine(BuildIdentitySequenceSql(schemaName, plan.TableName, identityColumn));
                builder.AppendLine();
                statements++;
            }
        }

        return statements == 0
            ? "-- No finalized rows to seed."
            : builder.ToString().TrimEnd();
    }

    public static string BuildIdentitySequenceSql(string schemaName, string tableName, string columnName)
    {
        var table = PostgreSqlSqlFormatter.QualifiedIdentifier(schemaName, tableName);
        var column = PostgreSqlSqlFormatter.Identifier(columnName);
        var tableLiteral = PostgreSqlSqlFormatter.Literal(table);
        var columnLiteral = PostgreSqlSqlFormatter.Literal(columnName);
        return $"SELECT setval(pg_get_serial_sequence({tableLiteral}, {columnLiteral}), "
            + $"GREATEST(COALESCE(MAX({column}), 1), 1), "
            + $"COALESCE(MAX({column}) >= 1, FALSE)) FROM {table};";
    }

    private static (string PreSeedDdl, string PostSeedDdl) SplitDeferredForeignKeys(string ddl)
    {
        var preSeed = new List<string>();
        var postSeed = new List<string>();
        foreach (var line in ddl.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            var trimmed = line.TrimStart();
            if (trimmed.StartsWith("ALTER TABLE ", StringComparison.OrdinalIgnoreCase)
                && trimmed.Contains(" ADD CONSTRAINT ", StringComparison.OrdinalIgnoreCase)
                && trimmed.Contains(" FOREIGN KEY ", StringComparison.OrdinalIgnoreCase))
            {
                postSeed.Add(line);
            }
            else
            {
                preSeed.Add(line);
            }
        }

        return (string.Join('\n', preSeed).Trim(), string.Join('\n', postSeed).Trim());
    }

    private static (string PreSeedDdl, string PostSeedDdl) DeferAllForeignKeys(
        string ddl,
        IReadOnlyList<DesignRelationship> relationships)
    {
        var preSeed = new List<string>();
        var removedInlineForeignKey = false;

        foreach (var line in ddl.Replace("\r\n", "\n", StringComparison.Ordinal).Split('\n'))
        {
            var trimmed = line.TrimStart();
            if (trimmed.StartsWith("ALTER TABLE ", StringComparison.OrdinalIgnoreCase)
                && trimmed.Contains(" FOREIGN KEY ", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (trimmed.StartsWith("FOREIGN KEY ", StringComparison.OrdinalIgnoreCase))
            {
                removedInlineForeignKey = true;
                continue;
            }

            if (removedInlineForeignKey && trimmed == ");")
            {
                for (var index = preSeed.Count - 1; index >= 0; index--)
                {
                    if (string.IsNullOrWhiteSpace(preSeed[index])) continue;
                    preSeed[index] = preSeed[index].TrimEnd().TrimEnd(',');
                    break;
                }

                removedInlineForeignKey = false;
            }

            preSeed.Add(line);
        }

        var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var postSeed = relationships.OrderBy(relationship => relationship.Id)
            .Select(relationship => BuildDeferredForeignKey(relationship, usedNames));
        return (string.Join('\n', preSeed).Trim(), string.Join('\n', postSeed).Trim());
    }

    private static string BuildDeferredForeignKey(DesignRelationship relationship, ISet<string> usedNames)
    {
        var fromColumn = relationship.FromColumn
            ?? throw new InvalidOperationException("A deployment relationship is missing its source column.");
        var toColumn = relationship.ToColumn
            ?? throw new InvalidOperationException("A deployment relationship is missing its target column.");
        var fromTable = fromColumn.DesignTable
            ?? throw new InvalidOperationException("A deployment relationship is missing its source table.");
        var toTable = toColumn.DesignTable
            ?? throw new InvalidOperationException("A deployment relationship is missing its target table.");
        var constraintName = MakeUniqueConstraintName($"fk_{fromTable.Name}_{fromColumn.Name}", usedNames);

        var onDelete = relationship.OnDelete switch
        {
            DesignOnDelete.Cascade => "CASCADE",
            DesignOnDelete.SetNull => "SET NULL",
            _ => "NO ACTION"
        };

        return $"ALTER TABLE {PostgreSqlSqlFormatter.Identifier(fromTable.Name)} "
            + $"ADD CONSTRAINT {PostgreSqlSqlFormatter.Identifier(constraintName)} "
            + $"FOREIGN KEY ({PostgreSqlSqlFormatter.Identifier(fromColumn.Name)}) "
            + $"REFERENCES {PostgreSqlSqlFormatter.Identifier(toTable.Name)} "
            + $"({PostgreSqlSqlFormatter.Identifier(toColumn.Name)}) ON DELETE {onDelete};";
    }

    private static string MakeUniqueConstraintName(string baseName, ISet<string> usedNames)
    {
        const int maxIdentifierLength = 63;
        var normalized = baseName.ToLowerInvariant();
        var suffix = string.Empty;
        var sequence = 1;

        while (true)
        {
            var prefixLength = Math.Min(normalized.Length, maxIdentifierLength - suffix.Length);
            var candidate = normalized[..prefixLength] + suffix;
            if (usedNames.Add(candidate)) return candidate;
            suffix = $"_{++sequence}";
        }
    }
}
