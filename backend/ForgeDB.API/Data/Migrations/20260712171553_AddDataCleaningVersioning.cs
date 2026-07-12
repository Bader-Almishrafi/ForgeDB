using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDataCleaningVersioning : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ActiveVersionId",
                table: "datasets",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "cleaning_batches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CorrelationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    IsUndo = table.Column<bool>(type: "boolean", nullable: false),
                    IsRestore = table.Column<bool>(type: "boolean", nullable: false),
                    OperationCount = table.Column<int>(type: "integer", nullable: false),
                    RowsAffected = table.Column<int>(type: "integer", nullable: false),
                    CellsAffected = table.Column<int>(type: "integer", nullable: false),
                    FailureDetailsJson = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cleaning_batches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_cleaning_batches_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_cleaning_batches_users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "dataset_versions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DatasetId = table.Column<int>(type: "integer", nullable: false),
                    ParentVersionId = table.Column<int>(type: "integer", nullable: true),
                    CleaningBatchId = table.Column<int>(type: "integer", nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    IsRawOriginal = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    RowsJson = table.Column<string>(type: "jsonb", nullable: false),
                    ColumnsJson = table.Column<string>(type: "jsonb", nullable: false),
                    RowCount = table.Column<int>(type: "integer", nullable: false),
                    ColumnCount = table.Column<int>(type: "integer", nullable: false),
                    MissingValuesCount = table.Column<int>(type: "integer", nullable: false),
                    DuplicateRowsCount = table.Column<int>(type: "integer", nullable: false),
                    OperationSummary = table.Column<string>(type: "text", nullable: false),
                    AnalysisResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    AnalyzedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_dataset_versions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_dataset_versions_cleaning_batches_CleaningBatchId",
                        column: x => x.CleaningBatchId,
                        principalTable: "cleaning_batches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_dataset_versions_dataset_versions_ParentVersionId",
                        column: x => x.ParentVersionId,
                        principalTable: "dataset_versions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_dataset_versions_datasets_DatasetId",
                        column: x => x.DatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_dataset_versions_users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "project_cleaning_states",
                columns: table => new
                {
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    LastCleaningBatchId = table.Column<int>(type: "integer", nullable: true),
                    LastReanalyzedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    QualityConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    QualityConfirmedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ConfirmedVersionsJson = table.Column<string>(type: "jsonb", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_cleaning_states", x => x.ProjectId);
                    table.ForeignKey(
                        name: "FK_project_cleaning_states_cleaning_batches_LastCleaningBatchId",
                        column: x => x.LastCleaningBatchId,
                        principalTable: "cleaning_batches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_project_cleaning_states_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_project_cleaning_states_users_QualityConfirmedByUserId",
                        column: x => x.QualityConfirmedByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "cleaning_operations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CleaningBatchId = table.Column<int>(type: "integer", nullable: false),
                    DatasetId = table.Column<int>(type: "integer", nullable: false),
                    SourceVersionId = table.Column<int>(type: "integer", nullable: false),
                    ResultVersionId = table.Column<int>(type: "integer", nullable: true),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    OperationType = table.Column<string>(type: "text", nullable: false),
                    ColumnName = table.Column<string>(type: "text", nullable: true),
                    ParametersJson = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    IsDestructive = table.Column<bool>(type: "boolean", nullable: false),
                    RowsAffected = table.Column<int>(type: "integer", nullable: false),
                    CellsAffected = table.Column<int>(type: "integer", nullable: false),
                    FailureMessage = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cleaning_operations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_cleaning_operations_cleaning_batches_CleaningBatchId",
                        column: x => x.CleaningBatchId,
                        principalTable: "cleaning_batches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_cleaning_operations_dataset_versions_ResultVersionId",
                        column: x => x.ResultVersionId,
                        principalTable: "dataset_versions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cleaning_operations_dataset_versions_SourceVersionId",
                        column: x => x.SourceVersionId,
                        principalTable: "dataset_versions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cleaning_operations_datasets_DatasetId",
                        column: x => x.DatasetId,
                        principalTable: "datasets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_datasets_ActiveVersionId",
                table: "datasets",
                column: "ActiveVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_batches_CorrelationId",
                table: "cleaning_batches",
                column: "CorrelationId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_batches_CreatedByUserId",
                table: "cleaning_batches",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_batches_ProjectId_CreatedAt",
                table: "cleaning_batches",
                columns: new[] { "ProjectId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_operations_CleaningBatchId",
                table: "cleaning_operations",
                column: "CleaningBatchId");

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_operations_DatasetId",
                table: "cleaning_operations",
                column: "DatasetId");

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_operations_ResultVersionId",
                table: "cleaning_operations",
                column: "ResultVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_cleaning_operations_SourceVersionId",
                table: "cleaning_operations",
                column: "SourceVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_CleaningBatchId",
                table: "dataset_versions",
                column: "CleaningBatchId");

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_CreatedByUserId",
                table: "dataset_versions",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_DatasetId_IsActive",
                table: "dataset_versions",
                columns: new[] { "DatasetId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_DatasetId_VersionNumber",
                table: "dataset_versions",
                columns: new[] { "DatasetId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_ParentVersionId",
                table: "dataset_versions",
                column: "ParentVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_project_cleaning_states_LastCleaningBatchId",
                table: "project_cleaning_states",
                column: "LastCleaningBatchId");

            migrationBuilder.CreateIndex(
                name: "IX_project_cleaning_states_QualityConfirmedByUserId",
                table: "project_cleaning_states",
                column: "QualityConfirmedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_datasets_dataset_versions_ActiveVersionId",
                table: "datasets",
                column: "ActiveVersionId",
                principalTable: "dataset_versions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_datasets_dataset_versions_ActiveVersionId",
                table: "datasets");

            migrationBuilder.DropTable(
                name: "cleaning_operations");

            migrationBuilder.DropTable(
                name: "project_cleaning_states");

            migrationBuilder.DropTable(
                name: "dataset_versions");

            migrationBuilder.DropTable(
                name: "cleaning_batches");

            migrationBuilder.DropIndex(
                name: "IX_datasets_ActiveVersionId",
                table: "datasets");

            migrationBuilder.DropColumn(
                name: "ActiveVersionId",
                table: "datasets");
        }
    }
}
