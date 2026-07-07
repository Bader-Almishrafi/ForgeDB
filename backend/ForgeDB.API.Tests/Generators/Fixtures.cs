using ForgeDB.API.Services.Generators;

namespace ForgeDB.API.Tests.Generators;

internal static class Fixtures
{
    /// <summary>customers(id PK, "Select" reserved-word column) &lt;- orders(id PK, customer_id FK, amount).</summary>
    public static DesignModelSnapshot TwoTableWithForeignKey()
    {
        var customers = new DesignTableSnapshot
        {
            Id = 1,
            Name = "customers",
            Comment = "Master customer list",
            Columns = new List<DesignColumnSnapshot>
            {
                new() { Id = 1, TableId = 1, Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, IsNullable = false, Ordinal = 0 },
                new() { Id = 2, TableId = 1, Name = "Select", SqlType = "TEXT", IsNullable = false, Ordinal = 1 }
            }
        };

        var orders = new DesignTableSnapshot
        {
            Id = 2,
            Name = "orders",
            Columns = new List<DesignColumnSnapshot>
            {
                new() { Id = 3, TableId = 2, Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, IsNullable = false, Ordinal = 0 },
                new() { Id = 4, TableId = 2, Name = "customer_id", SqlType = "INTEGER", IsNullable = false, Ordinal = 1 },
                new() { Id = 5, TableId = 2, Name = "amount", SqlType = "NUMERIC", IsNullable = false, Ordinal = 2 }
            }
        };

        var relationship = new DesignRelationshipSnapshot
        {
            Id = 1,
            FromTableId = 2,
            FromTableName = "orders",
            FromColumnId = 4,
            FromColumnName = "customer_id",
            ToTableId = 1,
            ToTableName = "customers",
            ToColumnId = 1,
            ToColumnName = "id",
            Cardinality = "many-to-one",
            OnDelete = "cascade"
        };

        return new DesignModelSnapshot
        {
            ProjectId = 1,
            ProjectName = "Demo Project",
            Revision = 1,
            GeneratedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            Tables = new List<DesignTableSnapshot> { customers, orders },
            Relationships = new List<DesignRelationshipSnapshot> { relationship }
        };
    }

    /// <summary>a(id PK, b_id FK -&gt; b.id) and b(id PK, a_id FK -&gt; a.id): a mutual-reference cycle.</summary>
    public static DesignModelSnapshot CyclicTables()
    {
        var tableA = new DesignTableSnapshot
        {
            Id = 1,
            Name = "table_a",
            Columns = new List<DesignColumnSnapshot>
            {
                new() { Id = 1, TableId = 1, Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0 },
                new() { Id = 2, TableId = 1, Name = "b_id", SqlType = "INTEGER", IsNullable = true, Ordinal = 1 }
            }
        };

        var tableB = new DesignTableSnapshot
        {
            Id = 2,
            Name = "table_b",
            Columns = new List<DesignColumnSnapshot>
            {
                new() { Id = 3, TableId = 2, Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, Ordinal = 0 },
                new() { Id = 4, TableId = 2, Name = "a_id", SqlType = "INTEGER", IsNullable = true, Ordinal = 1 }
            }
        };

        var relationships = new List<DesignRelationshipSnapshot>
        {
            new()
            {
                Id = 1, FromTableId = 1, FromTableName = "table_a", FromColumnId = 2, FromColumnName = "b_id",
                ToTableId = 2, ToTableName = "table_b", ToColumnId = 3, ToColumnName = "id",
                Cardinality = "many-to-one", OnDelete = "no-action"
            },
            new()
            {
                Id = 2, FromTableId = 2, FromTableName = "table_b", FromColumnId = 4, FromColumnName = "a_id",
                ToTableId = 1, ToTableName = "table_a", ToColumnId = 1, ToColumnName = "id",
                Cardinality = "many-to-one", OnDelete = "no-action"
            }
        };

        return new DesignModelSnapshot
        {
            ProjectId = 1,
            ProjectName = "Cyclic Project",
            Revision = 1,
            GeneratedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            Tables = new List<DesignTableSnapshot> { tableA, tableB },
            Relationships = relationships
        };
    }
}
