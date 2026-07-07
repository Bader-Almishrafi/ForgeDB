using ForgeDB.API.Services.Generators;

namespace ForgeDB.API.Tests.Validation;

internal static class ValidationFixtures
{
    /// <summary>A fully clean model: customers(id PK) &lt;- orders(id PK, customer_id FK not null).
    /// Produces zero validation issues; individual tests mutate a copy to trigger exactly one rule.</summary>
    public static DesignModelSnapshot CleanModel()
    {
        var customers = new DesignTableSnapshot
        {
            Id = 1,
            Name = "customers",
            Columns = new List<DesignColumnSnapshot>
            {
                new() { Id = 1, TableId = 1, Name = "id", SqlType = "INTEGER", IsPrimaryKey = true, IsUnique = true, IsNullable = false, Ordinal = 0 },
                new() { Id = 2, TableId = 1, Name = "full_name", SqlType = "TEXT", IsNullable = false, Ordinal = 1 }
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
            ProjectName = "Clean Project",
            Revision = 1,
            GeneratedAt = DateTime.UtcNow,
            Tables = new List<DesignTableSnapshot> { customers, orders },
            Relationships = new List<DesignRelationshipSnapshot> { relationship }
        };
    }
}
