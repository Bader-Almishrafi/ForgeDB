using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class DesignModelFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "design_models",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    LayoutJson = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_models", x => x.Id);
                    table.ForeignKey(
                        name: "FK_design_models_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "relationship_suggestions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    SourceDatasetId = table.Column<int>(type: "integer", nullable: false),
                    SourceColumnName = table.Column<string>(type: "text", nullable: false),
                    TargetDatasetId = table.Column<int>(type: "integer", nullable: false),
                    TargetColumnName = table.Column<string>(type: "text", nullable: false),
                    Score = table.Column<double>(type: "double precision", nullable: false),
                    EvidenceJson = table.Column<string>(type: "jsonb", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_relationship_suggestions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_relationship_suggestions_datasets_SourceDatasetId",
                        column: x => x.SourceDatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_relationship_suggestions_datasets_TargetDatasetId",
                        column: x => x.TargetDatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_relationship_suggestions_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "design_tables",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DesignModelId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Comment = table.Column<string>(type: "text", nullable: true),
                    SourceDatasetId = table.Column<int>(type: "integer", nullable: true),
                    Origin = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_tables", x => x.Id);
                    table.ForeignKey(
                        name: "FK_design_tables_datasets_SourceDatasetId",
                        column: x => x.SourceDatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_design_tables_design_models_DesignModelId",
                        column: x => x.DesignModelId,
                        principalTable: "design_models",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "design_columns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DesignTableId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SqlType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsNullable = table.Column<bool>(type: "boolean", nullable: false),
                    IsPrimaryKey = table.Column<bool>(type: "boolean", nullable: false),
                    IsUnique = table.Column<bool>(type: "boolean", nullable: false),
                    Ordinal = table.Column<int>(type: "integer", nullable: false),
                    SourceColumnName = table.Column<string>(type: "text", nullable: true),
                    Origin = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_columns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_design_columns_design_tables_DesignTableId",
                        column: x => x.DesignTableId,
                        principalTable: "design_tables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "design_relationships",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DesignModelId = table.Column<int>(type: "integer", nullable: false),
                    FromColumnId = table.Column<int>(type: "integer", nullable: false),
                    ToColumnId = table.Column<int>(type: "integer", nullable: false),
                    Cardinality = table.Column<string>(type: "text", nullable: false),
                    OnDelete = table.Column<string>(type: "text", nullable: false),
                    Origin = table.Column<string>(type: "text", nullable: false),
                    SuggestionId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_relationships", x => x.Id);
                    table.ForeignKey(
                        name: "FK_design_relationships_design_columns_FromColumnId",
                        column: x => x.FromColumnId,
                        principalTable: "design_columns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_design_relationships_design_columns_ToColumnId",
                        column: x => x.ToColumnId,
                        principalTable: "design_columns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_design_relationships_design_models_DesignModelId",
                        column: x => x.DesignModelId,
                        principalTable: "design_models",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_design_relationships_relationship_suggestions_SuggestionId",
                        column: x => x.SuggestionId,
                        principalTable: "relationship_suggestions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_design_columns_DesignTableId",
                table: "design_columns",
                column: "DesignTableId");

            migrationBuilder.CreateIndex(
                name: "IX_design_models_ProjectId",
                table: "design_models",
                column: "ProjectId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_design_relationships_DesignModelId",
                table: "design_relationships",
                column: "DesignModelId");

            migrationBuilder.CreateIndex(
                name: "IX_design_relationships_FromColumnId",
                table: "design_relationships",
                column: "FromColumnId");

            migrationBuilder.CreateIndex(
                name: "IX_design_relationships_SuggestionId",
                table: "design_relationships",
                column: "SuggestionId");

            migrationBuilder.CreateIndex(
                name: "IX_design_relationships_ToColumnId",
                table: "design_relationships",
                column: "ToColumnId");

            migrationBuilder.CreateIndex(
                name: "IX_design_tables_DesignModelId",
                table: "design_tables",
                column: "DesignModelId");

            migrationBuilder.CreateIndex(
                name: "IX_design_tables_SourceDatasetId",
                table: "design_tables",
                column: "SourceDatasetId");

            migrationBuilder.CreateIndex(
                name: "IX_relationship_suggestions_ProjectId_SourceDatasetId_SourceCo~",
                table: "relationship_suggestions",
                columns: new[] { "ProjectId", "SourceDatasetId", "SourceColumnName", "TargetDatasetId", "TargetColumnName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_relationship_suggestions_SourceDatasetId",
                table: "relationship_suggestions",
                column: "SourceDatasetId");

            migrationBuilder.CreateIndex(
                name: "IX_relationship_suggestions_TargetDatasetId",
                table: "relationship_suggestions",
                column: "TargetDatasetId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "design_relationships");

            migrationBuilder.DropTable(
                name: "design_columns");

            migrationBuilder.DropTable(
                name: "relationship_suggestions");

            migrationBuilder.DropTable(
                name: "design_tables");

            migrationBuilder.DropTable(
                name: "design_models");
        }
    }
}
