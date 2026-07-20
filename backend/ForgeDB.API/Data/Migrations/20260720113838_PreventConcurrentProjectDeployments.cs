using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ForgeDB.API.Data.Migrations
{
    /// <inheritdoc />
    public partial class PreventConcurrentProjectDeployments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                WITH ranked AS (
                    SELECT "Id",
                           row_number() OVER (PARTITION BY "ProjectId" ORDER BY "StartedAt" DESC, "Id" DESC) AS row_number
                    FROM deployments
                    WHERE "Status" = 'Running'
                )
                UPDATE deployments AS deployment
                SET "Status" = 'Failed',
                    "CompletedAt" = COALESCE(deployment."CompletedAt", NOW()),
                    "ErrorMessage" = 'Superseded while enabling deployment concurrency protection. The transaction is no longer considered running.'
                FROM ranked
                WHERE deployment."Id" = ranked."Id"
                  AND ranked.row_number > 1;
                """);

            migrationBuilder.CreateIndex(
                name: "UX_deployments_ProjectId_Running",
                table: "deployments",
                column: "ProjectId",
                unique: true,
                filter: "\"Status\" = 'Running'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_deployments_ProjectId_Running",
                table: "deployments");
        }
    }
}
