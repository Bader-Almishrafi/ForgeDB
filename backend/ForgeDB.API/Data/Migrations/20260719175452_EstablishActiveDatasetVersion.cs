using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class EstablishActiveDatasetVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_dataset_versions_DatasetId_IsActive",
                table: "dataset_versions");

            migrationBuilder.Sql(
                """
                INSERT INTO dataset_versions
                    ("DatasetId", "ParentVersionId", "CleaningBatchId", "CreatedByUserId",
                     "VersionNumber", "IsRawOriginal", "IsActive", "RowsJson", "ColumnsJson",
                     "RowCount", "ColumnCount", "MissingValuesCount", "DuplicateRowsCount",
                     "OperationSummary", "AnalysisResultJson", "AnalyzedAt", "CreatedAt")
                SELECT d."Id", NULL, NULL, p."UserId", 1, TRUE, FALSE,
                    COALESCE((
                        SELECT jsonb_agg(r."RowData" ORDER BY r."RowNumber", r."Id")
                        FROM dataset_rows r
                        WHERE r."DatasetId" = d."Id"
                    ), '[]'::jsonb),
                    COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'name', c."ColumnName",
                                'dataType', COALESCE(NULLIF(c."DetectedDataType", ''), 'string'))
                            ORDER BY c."Id")
                        FROM dataset_columns c
                        WHERE c."DatasetId" = d."Id"
                    ), '[]'::jsonb),
                    d."RowCount", d."ColumnCount", d."MissingValuesCount", d."DuplicateRowsCount",
                    'Original imported dataset', d."AnalysisResultJson", d."AnalyzedAt", d."CreatedAt"
                FROM datasets d
                INNER JOIN projects p ON p."Id" = d."ProjectId"
                WHERE NOT EXISTS (
                    SELECT 1 FROM dataset_versions existing WHERE existing."DatasetId" = d."Id"
                );

                WITH ranked_versions AS (
                    SELECT d."Id" AS "DatasetId", v."Id" AS "VersionId",
                        ROW_NUMBER() OVER (
                            PARTITION BY d."Id"
                            ORDER BY
                                CASE
                                    WHEN v."Id" = d."ActiveVersionId" THEN 0
                                    WHEN v."IsActive" THEN 1
                                    ELSE 2
                                END,
                                v."VersionNumber" DESC,
                                v."Id" DESC) AS "Rank"
                    FROM datasets d
                    INNER JOIN dataset_versions v ON v."DatasetId" = d."Id"
                )
                UPDATE datasets d
                SET "ActiveVersionId" = ranked."VersionId"
                FROM ranked_versions ranked
                WHERE ranked."DatasetId" = d."Id" AND ranked."Rank" = 1;

                UPDATE dataset_versions version
                SET "IsActive" = (version."Id" = dataset."ActiveVersionId")
                FROM datasets dataset
                WHERE version."DatasetId" = dataset."Id"
                  AND version."IsActive" IS DISTINCT FROM (version."Id" = dataset."ActiveVersionId");

                UPDATE dataset_versions version
                SET "AnalysisResultJson" = version."AnalysisResultJson" || jsonb_build_object(
                    'datasetId', version."DatasetId",
                    'datasetVersionId', version."Id",
                    'datasetVersionNumber', version."VersionNumber",
                    'analyzedAt', version."AnalyzedAt",
                    'isCleanedVersion', NOT version."IsRawOriginal")
                WHERE version."AnalysisResultJson" IS NOT NULL
                  AND jsonb_typeof(version."AnalysisResultJson") = 'object';

                UPDATE datasets dataset
                SET "AnalysisResultJson" = version."AnalysisResultJson",
                    "AnalyzedAt" = version."AnalyzedAt"
                FROM dataset_versions version
                WHERE dataset."ActiveVersionId" = version."Id";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_DatasetId_Active",
                table: "dataset_versions",
                column: "DatasetId",
                unique: true,
                filter: "\"IsActive\" = TRUE");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_dataset_versions_DatasetId_Active",
                table: "dataset_versions");

            migrationBuilder.CreateIndex(
                name: "IX_dataset_versions_DatasetId_IsActive",
                table: "dataset_versions",
                columns: new[] { "DatasetId", "IsActive" });
        }
    }
}
