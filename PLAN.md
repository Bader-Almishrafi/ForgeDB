# Phase 1 — Design Model Foundation — Implementation Plan

## Codebase facts that shape this plan

- Single backend project: `backend/ForgeDB.API/ForgeDB.API.csproj` (net8.0, EF Core 8.0.11,
  Npgsql 8.0.11). No separate `.Data` project — migrations will use
  `--project ForgeDB.API --startup-project ForgeDB.API`.
- No existing test project. Will add `backend/ForgeDB.API.Tests` (xUnit) and register it in
  `ForgeDB.sln`.
- Entity convention is `int Id` (identity columns), not Guid. Following convention.
- Postgres runs via `docker-compose.yml` on port 5433, db `forgedb`, user/pass `postgres/postgres`
  (local dev only, already committed in `appsettings.Example.json`).

## Conflict found vs. the prompt, and resolution

The prompt describes one "existing preview/export path" to rewire. The codebase actually has
**two independent, non-overlapping schema-derivation paths**:

1. **Per-dataset legacy flow** (predates the project workspace): `SchemaService` +
   `SchemaDocumentFactory` + `DatabaseSchema`/`DatabaseDeployment` entities, exposed via
   `SchemasController` (`/api/datasets/{id}/schema/generate`, `/api/schemas/{id}/relationships`,
   `/api/schemas/{id}/deploy`) and consumed only by the older, still-routed but not-linked-from-nav
   pages `WorkspaceComponent`, `SchemaReviewComponent`, `RelationshipsComponent` (schema-level),
   `DeploymentComponent`, plus `SchemaExportService`'s `sqlText/dbmlText/schemaJsonText` methods.
2. **Per-project workspace flow** (current/active UI): `ProjectService.BuildRelationshipSuggestions`
   (heuristic, computed live every call, decisions persisted as JSON in `Project.DashboardConfig`)
   and `ProjectService.BuildProjectSchema`/`GenerateProjectSql`/`GenerateProjectDbml`, exposed via
   `ProjectsController` and consumed by `ProjectRelationshipsComponent`, `ProjectSchemaDesignerComponent`,
   `ProjectErDiagramComponent`, `ProjectExportsComponent` — the pages actually reachable from the
   app-shell nav and the ones this whole MVP has been built around.

**Resolution (smallest-scope):** Phase 1's DesignModel is project-scoped (multiple datasets/tables,
cross-dataset relationships), so it replaces path **#2** end-to-end: the heuristic scoring
algorithm in `ScoreRelationshipCandidate`/`TryBuildRelationshipSuggestion` is preserved (same
logic, same thresholds) but moved into a new `RelationshipDetectionService` that persists to the
new `RelationshipSuggestion` table instead of ephemeral DTOs; `BuildProjectSchema`,
`GenerateProjectSql`, `GenerateProjectDbml` are deleted and replaced by the new generator classes
driven by `DesignModel`. Path **#1** (per-dataset legacy flow) is **left untouched** — it is a
distinct, still-routed feature area with its own entities/pages that the manual test checklist in
§10 never exercises, and touching it would be an unrelated refactor with no corresponding
requirement or test coverage in this prompt. This is recorded as a deviation in the final report.

The project-level **export package endpoint keeps its existing route and DTO shape**
(`GET /api/projects/{projectId}/exports/package` → `ProjectExportPackageDto`) per §7, but its
implementation is rewired to load the latest `DesignModel`, validate, and call the shared
generators. The old project-level preview/suggestion endpoints
(`GET/POST .../schema`, `.../relationships/suggestions|accept|reject`) are removed and replaced by
the new `/api/projects/{projectId}/design*` and `/api/*/relationship-suggestions*` surface in §4;
Angular's `ProjectSchemaDesignerComponent`, `ProjectRelationshipsComponent`, and
`ProjectErDiagramComponent` are repointed at the new endpoints. To avoid any CSS/layout/template
churn (forbidden by scope), each component's `.ts` maps the new Design API response into the exact
same local view-model shapes their existing (currently being polished, uncommitted) `.html`
templates already bind to — **no `.html` files are touched**.

## Entities & migration (files to add)

`Models/Entities/`: `DesignModel.cs`, `DesignTable.cs`, `DesignColumn.cs`, `DesignRelationship.cs`,
`RelationshipSuggestion.cs`.

`Data/ForgeDbContext.cs` (modify): add 5 `DbSet`s + `OnModelCreating` configuration (jsonb columns,
FKs/delete behaviors/unique indexes per prompt §2-3, `Revision` as a concurrency token via
`.IsConcurrencyToken()`).

One migration: `DesignModelFoundation`.

Backfill: `Services/LegacySuggestionBackfillService : IHostedService`, run once at startup, reads
every `Project.DashboardConfig`, upserts each stored `RelationshipDecision` into
`RelationshipSuggestion` guarded by the unique key (skip if a row already exists for that key).
`Project.DashboardConfig` column is **not dropped**.

## Design API (files to add)

- `Models/DTOs/DesignDtos.cs` (or split per concern): request/response DTOs for design read,
  tables, columns, relationships, layout, suggestions, validation issues.
- `Services/Interfaces/IDesignService.cs` + `Services/DesignService.cs`: all mutation logic,
  revision/If-Match handling, Origin flipping, generate merge/replace semantics.
- `Services/Interfaces/IRelationshipDetectionService.cs` + `RelationshipDetectionService.cs`:
  heuristic scoring (ported from `ProjectService`) + upsert-by-unique-key persistence + accept/reject.
- `Repositories/Interfaces/IDesignRepository.cs` + `DesignRepository.cs`: EF access incl.
  concurrency-checked saves.
- `Controllers/DesignController.cs`: all routes in §4.
- Concurrency: `Revision` mapped `.IsConcurrencyToken()`; every mutation loads by `(Id, Revision)`,
  EF throws `DbUpdateConcurrencyException` on mismatch → mapped to 409 with `currentRevision`.
  Missing `If-Match` → 428 via an action filter or explicit header check per mutating action.

## Generators (files to add)

`Services/Generators/`: `IDesignSchemaGenerator.cs` (or per-format interfaces),
`SqlSchemaGenerator.cs`, `DbmlGenerator.cs`, `JsonSchemaGenerator.cs`, `DesignModelSnapshot.cs`
(pure DTO fed to generators, no EF types). Registered in DI, resolved by both the preview endpoint
and export packager.

## Validation engine (files to add)

`Services/Validation/IDesignValidationService.cs` + `DesignValidationService.cs` +
`ValidationIssue.cs`. Computed on demand from the same snapshot DTO the generators use.

## Rewiring (files to modify)

- `ProjectService.cs` / `ProjectsController.cs`: remove `BuildRelationshipSuggestions`,
  `BuildProjectSchema`, `GenerateProjectSql`, `GenerateProjectDbml`, `SaveRelationshipDecisionAsync`,
  `GetRelationshipSuggestionsAsync`, `AcceptRelationshipAsync`, `RejectRelationshipAsync`,
  `GetProjectSchemaAsync`, `GenerateProjectSchemaAsync`, and the corresponding controller actions
  (`/schema`, `/schema/generate`, `/relationships/suggestions|accept|reject`). Keep
  `GetProjectExportPackageAsync` (route + DTO), rewritten internally to use `DesignService` +
  generators + validation.
- `Program.cs`: register new services/repositories + hosted backfill service.
- `frontend/.../services/api.models.ts`: add Design API interfaces; keep legacy ones only if still
  referenced by the untouched legacy per-dataset pages.
- `frontend/.../services/forge-api.service.ts` (or a new `design-api.service.ts`): add methods for
  the new endpoints incl. `If-Match` header handling and 409/422 surfacing.
- `ProjectSchemaDesignerComponent`, `ProjectRelationshipsComponent`, `ProjectErDiagramComponent`,
  `ProjectExportsComponent` (`.ts` only): repoint at new endpoints/services.

## Tests

`backend/ForgeDB.API.Tests` (new xUnit project): generator fixture tests (SQL/DBML/JSON incl.
topological sort + cycle fallback + quoting), validation rule tests (one positive/negative per
rule), revision-conflict test proving delete-column removes its relationships.

## Order of work (commits)

1. Entities + DbContext + migration (scaffold only, no behavior yet).
2. Generators + validation engine + unit tests (pure functions, easiest to get right first).
3. Design repository + service + controller (read + generate).
4. Design mutation endpoints (tables/columns/relationships/layout) with concurrency.
5. RelationshipSuggestion entity wiring: detection service, accept/reject, backfill hosted service.
6. Rewire `ProjectService`/`ProjectsController` export endpoint; delete deprecated legacy
   project-level schema/suggestion code.
7. Frontend: DTOs + service + 4 component `.ts` rewires (no `.html` changes).
8. Build/migrate/test run; manual API checklist against the running stack; final report.
