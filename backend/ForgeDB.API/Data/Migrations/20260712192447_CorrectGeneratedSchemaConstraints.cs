using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class CorrectGeneratedSchemaConstraints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DefaultValue",
                table: "design_columns",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAutoIncrement",
                table: "design_columns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Schema drafts created before this migration inferred PK/UNIQUE from analysis
            // statistics. The focused Schema UI could not edit either flag, so generated-origin
            // flags are safe to clear. Relationships, identifiers, columns, ordinals, and source
            // DatasetVersion references are deliberately left untouched.
            migrationBuilder.Sql(
                """
                WITH affected_designs AS (
                    SELECT DISTINCT dt."DesignModelId"
                    FROM design_columns dc
                    INNER JOIN design_tables dt ON dt."Id" = dc."DesignTableId"
                    WHERE dc."Origin" = 'generated'
                      AND (dc."IsPrimaryKey" = TRUE OR dc."IsUnique" = TRUE)
                )
                UPDATE design_models dm
                SET "Status" = 'Draft',
                    "ValidatedAt" = NULL,
                    "Revision" = dm."Revision" + 1,
                    "UpdatedAt" = NOW()
                FROM affected_designs affected
                WHERE dm."Id" = affected."DesignModelId";

                UPDATE design_columns
                SET "IsPrimaryKey" = FALSE,
                    "IsUnique" = FALSE
                WHERE "Origin" = 'generated'
                  AND ("IsPrimaryKey" = TRUE OR "IsUnique" = TRUE);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The inferred flags are intentionally not restored: statistics are not constraints.
            migrationBuilder.DropColumn(
                name: "DefaultValue",
                table: "design_columns");

            migrationBuilder.DropColumn(
                name: "IsAutoIncrement",
                table: "design_columns");
        }
    }
}
