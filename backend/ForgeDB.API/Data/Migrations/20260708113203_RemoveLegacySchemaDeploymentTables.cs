using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveLegacySchemaDeploymentTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "database_deployments");

            migrationBuilder.DropTable(
                name: "database_schemas");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "database_schemas",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DatasetId = table.Column<int>(type: "integer", nullable: false),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DbmlContent = table.Column<string>(type: "text", nullable: true),
                    RelationshipsJson = table.Column<string>(type: "jsonb", nullable: true),
                    SchemaJson = table.Column<string>(type: "jsonb", nullable: true),
                    SchemaName = table.Column<string>(type: "text", nullable: false),
                    SqlContent = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_database_schemas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_database_schemas_datasets_DatasetId",
                        column: x => x.DatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_database_schemas_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "database_deployments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    SchemaId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DatabaseName = table.Column<string>(type: "text", nullable: false),
                    DeployedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    GeneratedSql = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_database_deployments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_database_deployments_database_schemas_SchemaId",
                        column: x => x.SchemaId,
                        principalTable: "database_schemas",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_database_deployments_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_database_deployments_ProjectId",
                table: "database_deployments",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_database_deployments_SchemaId",
                table: "database_deployments",
                column: "SchemaId");

            migrationBuilder.CreateIndex(
                name: "IX_database_schemas_DatasetId",
                table: "database_schemas",
                column: "DatasetId");

            migrationBuilder.CreateIndex(
                name: "IX_database_schemas_ProjectId",
                table: "database_schemas",
                column: "ProjectId");
        }
    }
}
