using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSchemaDraftWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceDatasetVersionId",
                table: "design_tables",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "GeneratedAt",
                table: "design_models",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LastModifiedByUserId",
                table: "design_models",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceVersionsJson",
                table: "design_models",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "design_models",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Draft");

            migrationBuilder.AddColumn<DateTime>(
                name: "ValidatedAt",
                table: "design_models",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_design_tables_SourceDatasetVersionId",
                table: "design_tables",
                column: "SourceDatasetVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_design_models_LastModifiedByUserId",
                table: "design_models",
                column: "LastModifiedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_design_models_users_LastModifiedByUserId",
                table: "design_models",
                column: "LastModifiedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_design_tables_dataset_versions_SourceDatasetVersionId",
                table: "design_tables",
                column: "SourceDatasetVersionId",
                principalTable: "dataset_versions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_design_models_users_LastModifiedByUserId",
                table: "design_models");

            migrationBuilder.DropForeignKey(
                name: "FK_design_tables_dataset_versions_SourceDatasetVersionId",
                table: "design_tables");

            migrationBuilder.DropIndex(
                name: "IX_design_tables_SourceDatasetVersionId",
                table: "design_tables");

            migrationBuilder.DropIndex(
                name: "IX_design_models_LastModifiedByUserId",
                table: "design_models");

            migrationBuilder.DropColumn(
                name: "SourceDatasetVersionId",
                table: "design_tables");

            migrationBuilder.DropColumn(
                name: "GeneratedAt",
                table: "design_models");

            migrationBuilder.DropColumn(
                name: "LastModifiedByUserId",
                table: "design_models");

            migrationBuilder.DropColumn(
                name: "SourceVersionsJson",
                table: "design_models");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "design_models");

            migrationBuilder.DropColumn(
                name: "ValidatedAt",
                table: "design_models");
        }
    }
}
