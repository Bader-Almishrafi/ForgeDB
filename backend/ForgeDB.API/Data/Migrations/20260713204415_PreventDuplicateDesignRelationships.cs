using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class PreventDuplicateDesignRelationships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Exact duplicate rows are already invalid by the application invariant. Preserve the
            // oldest canonical relationship and remove only redundant copies so the unique index
            // can be introduced without deleting any distinct/valid relationship.
            migrationBuilder.Sql(
                """
                WITH duplicate_relationships AS (
                    SELECT "Id",
                           ROW_NUMBER() OVER (
                               PARTITION BY "DesignModelId", "FromColumnId", "ToColumnId", "Cardinality"
                               ORDER BY "Id"
                           ) AS duplicate_rank
                    FROM design_relationships
                )
                DELETE FROM design_relationships AS relationship
                USING duplicate_relationships AS duplicate
                WHERE relationship."Id" = duplicate."Id"
                  AND duplicate.duplicate_rank > 1;
                """);

            migrationBuilder.CreateIndex(
                name: "UX_design_relationship_endpoint_cardinality",
                table: "design_relationships",
                columns: new[] { "DesignModelId", "FromColumnId", "ToColumnId", "Cardinality" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_design_relationship_endpoint_cardinality",
                table: "design_relationships");
        }
    }
}
