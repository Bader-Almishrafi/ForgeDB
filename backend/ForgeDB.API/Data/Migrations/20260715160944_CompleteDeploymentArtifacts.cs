using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class CompleteDeploymentArtifacts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeploySql",
                table: "deployments",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "FailedRows",
                table: "deployments",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "RelationshipsCreated",
                table: "deployments",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "SeedSql",
                table: "deployments",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "TablesCreated",
                table: "deployments",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql(
                """
                UPDATE deployments
                SET "Status" = 'Completed',
                    "TablesCreated" = jsonb_array_length("CreatedTablesJson")
                WHERE "Status" = 'Succeeded';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE deployments
                SET "Status" = 'Succeeded'
                WHERE "Status" = 'Completed';
                """);

            migrationBuilder.DropColumn(
                name: "DeploySql",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "FailedRows",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "RelationshipsCreated",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "SeedSql",
                table: "deployments");

            migrationBuilder.DropColumn(
                name: "TablesCreated",
                table: "deployments");
        }
    }
}
