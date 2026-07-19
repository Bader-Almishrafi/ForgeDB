# ForgeDB Simple Workflow Rebuild Plan

Audit date: 2026-07-19

Audited branch: `rebuild/simple-workflow`

Audited starting commit: `1bdfc88` (`backup current implementation before workflow rebuild`)

## Scope and decision summary

This is an implementation plan only. No application behavior is changed by this document.

`Projects` is the collection/entry screen, not one of the five project steps. After a project is created or opened, ForgeDB should have exactly five canonical steps:

1. `Data`
2. `Analyze`
3. `Clean`
4. `Schema` (including relationships and ER visualization)
5. `Export & Deploy`

The canonical route, not `localStorage`, will identify the project and selected dataset. The backend will identify the active `DatasetVersion` and report step readiness. Existing capabilities should be consolidated rather than rewritten: CSV/Excel/API import, Python-backed analysis and cleaning, immutable dataset versions, schema generation, relationship review, exports, and PostgreSQL deployment all already exist.

## 1. Current workflow problems

### 1.1 Routes and duplicated pages

The route table in `frontend/angular-app/src/app/app.routes.ts` exposes more concepts than the user workflow needs:

- `HomeComponent` and `ProjectsComponent` both load, search, sort, edit, delete, and open the same project list. Their TypeScript is substantially duplicated.
- `ProjectOverviewComponent` and `DataSourcesComponent` both load a project, load its datasets, select a dataset, write workflow state, and show a preview. The overview also calculates its own client-side workflow stages.
- `DataSourcesComponent`, `ProjectCreateComponent`, and the backend import endpoints all support data-source onboarding, but the UI exposes import both during project creation and again in Data Sources. This makes “create project” and “add data” inseparable and duplicates CSV/Excel/API UI logic.
- Three routed analysis surfaces overlap:
  - `AnalysisComponent` provides preview/explorer calculations and can run analysis.
  - `AnalyzeDataComponent` is the full project/dataset analysis workspace.
  - `DashboardComponent` renders analysis summaries/charts and can run analysis again.
- Both `/datasets/:datasetId/preview` and `/datasets/:datasetId/explorer` load `AnalysisComponent`; both `/datasets/:datasetId/dashboard` and `/datasets/:datasetId/profile` load `DashboardComponent`.
- Schema design, relationships, and ER visualization are presented as separate concepts even though all mutate or render the same `DesignModel` revision. `ProjectSchemaDesignerComponent` already contains an ER preview; `ProjectRelationshipsComponent` separately edits relationships; `ProjectErDiagramComponent` still exists and is tested even though `/projects/:projectId/er-diagram` redirects to Relationships.
- `ProjectRelationshipsComponent` tests still expect a “Continue to ER” element that the current template no longer contains. The legacy route would return the user to the same Relationships page rather than advance the workflow.
- Export and Deployment are separate final pages with separate loading/error/readiness experiences even though they use the same validated design and should be one final step.
- The global shell exposes Home, Projects, Data Sources, Analysis, Data Cleaning, Dashboard, Schema, Relationships, Deployment, and Exports. It therefore presents implementation areas rather than the five-step workflow.
- `/app/*` aliases and dataset-only routes preserve older navigation models. Dataset-only URLs cannot reconstruct project context from their parameters alone.
- Breadcrumbs, back links, project stage cards, sidebar links, page buttons, and legacy redirects each independently encode workflow order. They already disagree (for example, the overview marks Deployment unavailable although a deployment page and backend exist).

### 1.2 Workflow state and `localStorage`

`frontend/angular-app/src/app/services/workflow-state.service.ts` stores these values as cross-page authority:

- `forgedb.currentProjectId`
- `forgedb.currentProjectName`
- `forgedb.currentDatasetId`
- `forgedb.currentDatasetName`
- `forgedb.currentDatasetStatus`

This creates several failure modes:

- A deep link can use one project ID while the shell renders the name or dataset from a previously visited project.
- A selected dataset ID can survive project changes. Each page has to validate it against a newly loaded dataset list and choose a fallback.
- Dataset status in browser storage can be stale after analysis, cleaning, restore, replacement, or another browser session changes the server state.
- Standalone dataset routes recover project context from stored state or a `returnProject` query parameter; a cleared browser, shared link, or stale value changes navigation behavior.
- Pages repeatedly call `setProjectId`, `setProject`, `setDataset`, or `clearDataset`, so route initialization and selection rules are spread across nearly every workflow page.
- Logout clearing the state is correct but does not solve stale state during ordinary cross-project navigation.

Authentication token/user storage in `auth.service.ts`, theme preference in `theme.service.ts`, and sidebar preference in `app-shell.component.ts` are separate concerns and may remain in `localStorage`. Only project/dataset/workflow authority should be removed from browser persistence.

### 1.3 Project CRUD

Create, list, read, update, and delete exist end to end:

- Backend: `ProjectsController`, `ProjectService`, and `ProjectRepository`.
- Frontend: `ProjectsComponent`, `ProjectCreateComponent`, `ProjectCardComponent`, and inline editing on `ProjectOverviewComponent`.

Problems to fix during consolidation:

- Project list/edit/delete is duplicated between Home and Projects.
- Project update is duplicated between project cards and Project Overview.
- Project creation is a three-step project-plus-import wizard, so a valid empty project cannot be created through a simple single-purpose flow.
- The list endpoint is `GET /api/projects/user/{userId}` even though the JWT is authoritative and the controller rejects any other user ID.
- `ProjectCreateDto` exposes `UserId`, then the controller overwrites it from the JWT. The client should never send an ownership field.
- There are ownership controller tests but no focused backend `ProjectService` CRUD test suite and no frontend tests for `ProjectsComponent`, `HomeComponent`, or `ProjectCardComponent` CRUD behavior.

### 1.4 Dataset import and management

CSV, `.xlsx`, and JSON API import are implemented. API import also includes URL validation/SSRF defenses, connectivity testing, preview, array-path selection, and size limits. Excel supports worksheet discovery and selection.

Current issues:

- CSV/Excel/API selection and import code is duplicated between `ProjectCreateComponent` and `DataSourcesComponent`.
- File upload can import CSV/Excel, but dataset replacement accepts only CSV in the frontend even though the backend replacement service can parse CSV or Excel.
- API import cannot replace an existing dataset.
- Import persists `DatasetRow`/`DatasetColumn`, but it does not create raw `DatasetVersion` v1. Raw versions are created lazily when a Cleaning endpoint is first opened.
- The first Cleaning page load fires summary, suggestions, and history concurrently; each can attempt the lazy raw-version backfill. The repository contains conflict recovery specifically for this UI pattern.
- `GetProjectDatasetsAsync` reads root `Dataset` counters/status rather than explicitly returning active-version metadata. Other repository methods overlay the active snapshot into a detached `Dataset`, so “current dataset” semantics vary by query.
- Replacement deletes all versions, cleaning operations, and relationship suggestions. It resets history instead of creating a new auditable source version.

### 1.5 Dataset analysis

`DatasetImportService.AnalyzeDatasetAsync` loads the current dataset content, calls Python `/analyze`, and falls back to the .NET `DatasetAnalysisBuilder` on service/timeout/contract failures. The analysis result is saved on both `Dataset` and its active version when one exists.

Current issues:

- The analysis request sent to Python contains `datasetId` but no `datasetVersionId`, so the response cannot prove which active version it analyzed.
- `SaveAnalysisResultAsync` reloads the dataset after computation and writes whatever version is active then. A concurrent clean/restore could cause analysis of version N to be attached to version N+1.
- `GET /analysis` rebuilds results from current rows instead of requiring a saved analysis artifact; the UI can therefore display computed-looking results even when status/readiness says analysis has not run.
- Project analysis is implemented by the Angular component making sequential per-dataset requests. Progress and partial failure are client-owned and disappear on navigation.
- The full `AnalyzeDataComponent` lazy chunk is about 662 kB in the baseline production build, while separate preview/dashboard pages add more duplicated analysis UI.
- Python analysis has no tests. All existing Python tests cover cleaning only.
- The Python service still mounts unused legacy `/api/analysis/*` routes for profile, relationships, schema generation, chart recommendations, and full analysis. The .NET application calls only `/analyze`, `/cleaning/preview`, and `/cleaning/apply`; .NET is already the source of truth for relationships and schema generation.

### 1.6 Cleaning, `DatasetVersion`, and active-version behavior

The cleaning implementation already has useful foundations: immutable JSON snapshots, preview before apply, cleaning batches/operations, destructive confirmation, history, undo-as-a-new-version, restore-as-a-new-version, re-analysis, and quality confirmation.

The active-version model needs to be made unambiguous:

- `Dataset.ActiveVersionId` and `DatasetVersion.IsActive` represent the same fact. The database index on `(DatasetId, IsActive)` is not unique, so multiple versions can be flagged active.
- Some code uses `ActiveVersionId`; deployment also checks `version.IsActive`. A mismatch can make preview/analysis and deployment disagree.
- Active versions do not exist until Cleaning is visited, even though Data and Analyze need the same version identity.
- Analysis and root dataset counters are duplicated on `Dataset` and `DatasetVersion`.
- Cleaning invalidates quality confirmation but leaves the existing design in place; it becomes stale only when schema validation checks source versions. The UI needs explicit stale/readiness state immediately.
- `ConfirmedVersionsJson` and `DesignModel.SourceVersionsJson` capture version lineage, while `DesignTable.SourceDatasetVersionId` captures it relationally. These must be treated consistently.
- “Restore version” does not reactivate the historical row; it correctly copies it into a new immutable version. UI and API language should say “restore as new active version.”
- Clean data with zero suggestions can confirm quality while still on raw v1. Schema generation accepts it, but `DeploymentService` rejects every `IsRawOriginal` version. That produces a valid no-op-clean workflow that can export but cannot deploy.

### 1.7 Schema and relationships

Schema generation correctly uses confirmed active versions and records source version IDs. It supports draft edits, optimistic concurrency through `If-Match`, validation, SQL/DBML/JSON generators, and persisted relationships.

Current issues:

- There are two schema-generation APIs (`design/generate` and the newer guarded `schema/generate`) with different intent. The simple workflow should expose one canonical path.
- Schema and Relationships are sequential pages even though a relationship mutation increments and invalidates the same `DesignModel` revision.
- Relationship detection reads active dataset rows, but `RelationshipSuggestion` does not store source/target version IDs. Suggestions can remain after a cleaned version renames/removes a column.
- Accepted/rejected suggestions intentionally persist across detection. Without version lineage, an old decision can be displayed beside a newer dataset version.
- Schema regeneration clears all design relationships. The user needs an explicit impact warning and stale suggestion handling in the same Schema workspace.
- The hidden/redirected ER page and `design-view-model.ts` remain maintenance surface.

### 1.8 Export and deployment

Exports generate SQL, DBML, JSON Schema, relationship evidence, and a data-quality report. Deployment validates ownership/revision/readiness, generates schema/seed/deploy SQL, executes PostgreSQL in a transaction, records history, and supports artifact downloads.

Current issues:

- Separate pages duplicate design loading, readiness explanations, SQL preview/copy/download, and error handling.
- Export validates the current snapshot but does not require the persisted design status to be `Valid`; deployment does. One final page can therefore show “package ready” beside a blocked deploy without a single preflight explanation.
- `ProjectOverviewComponent` still labels Deployment “Status unavailable” even though deployment is implemented.
- The root project workspace used to build the quality report loads raw `DatasetRows`/`DatasetColumns` and root counters rather than an explicit active-version projection.
- Deployment rejects approved analyzed raw/no-op versions, as described above.

## 2. Target five-step workflow

### 2.1 Canonical routes

Use one project-scoped route tree and one project workflow shell:

| Area | Canonical route | Route-owned state |
| --- | --- | --- |
| Projects | `/projects` | Search/sort may use query parameters; no active project is persisted. |
| Create project | `/projects/new` | Project details only. Success goes to the new project’s Data step. |
| 1. Data | `/projects/:projectId/data` | Optional `?datasetId=` identifies the selected dataset. |
| 2. Analyze | `/projects/:projectId/analyze` | Optional `?datasetId=`; absent means project scope. |
| 3. Clean | `/projects/:projectId/clean` | Optional `?datasetId=`, `issueType`, and `column`. |
| 4. Schema | `/projects/:projectId/schema` | Optional `?tab=tables|relationships|diagram|sql`. |
| 5. Export & Deploy | `/projects/:projectId/export-deploy` | Optional `?tab=exports|deploy|history`. |

Add a route-scoped project workflow shell/resolver that:

- validates project ownership;
- loads the project and backend-computed workflow/readiness summary;
- renders exactly five step links;
- derives breadcrumbs and back/next actions from route data;
- never reads project or dataset IDs from `localStorage`;
- validates `datasetId` against the current project and removes or replaces an invalid query value deterministically.

### 2.2 Step behavior

#### Step 1: Data

- Show project name/description editing in the page header.
- List all project datasets and their source, active version, row/column counts, analysis state, and stale state.
- Select a dataset with `?datasetId=` and show preview/version metadata.
- Provide one reusable import surface for CSV, Excel, and API.
- Support replace-as-new-source-version and delete with explicit consequences.
- “Continue to Analyze” keeps the selected dataset query parameter.

#### Step 2: Analyze

- Merge project overview metrics, columns/issues, comparisons, recommendations, and useful dashboard charts into `AnalyzeDataComponent`.
- Project scope is the default; dataset scope is selected through `?datasetId=`.
- Preview-only concerns remain in Data; remove the separate explorer page.
- Run analysis against an explicit active version ID and show saved result version/timestamp.
- Allow partial project analysis but obtain readiness from the backend, not local status strings.
- “Continue to Clean” is enabled when every active version has a saved analysis.

#### Step 3: Clean

- Retain suggestions, strategy editing, preview, apply, history, undo, restore-as-new-version, and re-analysis.
- Always show the active version and its lineage.
- If there are no issues, allow an explicit “No cleaning changes required” confirmation after analysis.
- Any new active version invalidates quality confirmation, schema readiness, relationship suggestions for older versions, and final-step readiness.
- “Continue to Schema” requires every active version to be analyzed and the exact active-version set to be quality-confirmed.

#### Step 4: Schema

- Keep a single `DesignModel` workspace with tabs for Tables/Columns, Relationships, ER Diagram, SQL, and Validation.
- Generate from the exact quality-confirmed active versions.
- Detect/review/manual-edit relationships inside this step and under the same revision/conflict handling.
- Render the ER diagram from the current in-memory/persisted design; remove the standalone ER route/page.
- Any table, column, or relationship mutation returns the new revision and returns the design to Draft until revalidated.
- “Continue to Export & Deploy” requires a non-stale persisted `Valid` design.

#### Step 5: Export & Deploy

- One page loads a single backend preflight containing design revision/status, source-version readiness, artifact availability, and deployment readiness reasons.
- Exports remain downloadable independently when the design snapshot has no validation errors.
- Deployment requires the same current validated revision and exact confirmed source versions.
- Show SQL/DBML/JSON/reports, deploy confirmation, latest result, history, row counts, errors, and schema/seed/deploy downloads in tabs.
- Approved analyzed raw/no-op versions are deployable; “cleaned” means quality-confirmed for workflow purposes, not necessarily modified.

### 2.3 State ownership

- URL: project ID, selected dataset ID, page/tab/filter scope.
- Backend: project ownership, active version, analysis state, quality confirmation, schema revision/status/staleness, relationship lineage, export/deploy readiness.
- Route-scoped Angular context: loaded labels and summaries only; safe to reconstruct on refresh.
- `localStorage`: authentication session plus theme/sidebar preferences only.

Delete `WorkflowStateService` after consumers are migrated. During one compatibility release, it may become a no-persistence adapter that derives IDs from the router while old components are redirected. On startup/logout, remove the five legacy `forgedb.current*` keys once; do not introduce new workflow keys.

## 3. Pages to keep, merge, redirect, or remove

| Current page/route | Decision | Target |
| --- | --- | --- |
| Landing, Login, Register/Signup, Change Password | Keep | Authentication/public routes are outside the project workflow. Keep `/signup` as a redirect to `/register`. |
| `HomeComponent` (`/home`) | Merge then remove | Move any unique greeting/recent-project copy into Projects if wanted; redirect `/home` and `/app/dashboard` to `/projects`. |
| `ProjectsComponent` (`/projects`) | Keep | Single project list/search/sort/create/edit/delete entry point. |
| `ProjectCreateComponent` (`/projects/new`) | Keep and simplify | Project details only; redirect to `/projects/:id/data` after create. Remove duplicated source import wizard. |
| `ProjectOverviewComponent` (`/projects/:id/overview`) | Merge then remove | Move project editing and useful summary/readiness into the workflow shell/Data header; redirect to `/projects/:id/data`. |
| `DataSourcesComponent` (`datasets`, `upload`) | Keep/rename presentation to Data | Canonical `/projects/:id/data`; merge all import and preview management here. Redirect both old project routes. |
| `AnalysisComponent` (`preview`, `explorer`) | Merge then remove | Preview goes to Data; analysis action/column summary goes to Analyze. Legacy dataset route redirect resolves the project and query dataset. |
| `AnalyzeDataComponent` (project `analysis`, dataset `analyze`) | Keep as Analyze | Canonical `/projects/:id/analyze`; absorb useful dashboard/profile UI. |
| `DashboardComponent` (`dashboard`, `profile`) | Merge then remove | Move unique charts/cards into Analyze. Redirect legacy dataset routes. |
| `DataCleaningComponent` (`data-cleaning`) | Keep as Clean | Canonical `/projects/:id/clean`; redirect old route. |
| `ProjectSchemaDesignerComponent` (`schema-designer`) | Keep as Schema container | Canonical `/projects/:id/schema`; host relationships/diagram/SQL/validation tabs. |
| `ProjectRelationshipsComponent` (`relationships`) | Merge | Refactor to a Schema child/panel; redirect old route to `/schema?tab=relationships`. |
| `ProjectErDiagramComponent` (`er-diagram`) | Merge then remove | Reuse only necessary diagram rendering inside Schema; redirect old route to `/schema?tab=diagram`. |
| `ProjectExportsComponent` (`exports`) | Merge | Move into the Export & Deploy container; redirect to `/export-deploy?tab=exports`. |
| `ProjectDeploymentComponent` (`deployment`) | Merge | Move into the Export & Deploy container; redirect to `/export-deploy?tab=deploy`. |
| `PlaceholderComponent` | Remove if route/reference audit remains empty | It is not part of the canonical route table. |

Legacy route redirects should remain for one release and be covered by route tests. Dataset-only legacy routes need a small redirect component/resolver plus `GET /api/datasets/{datasetId}` so they can discover `projectId`; they must not consult stored workflow state.

## 4. Backend changes required

### 4.1 Project and workflow contracts

1. Add `GET /api/projects` as the canonical current-user list. Keep `GET /api/projects/user/{userId}` as a deprecated compatibility endpoint for one release.
2. Remove `UserId` from the canonical project-create request. Always derive ownership from JWT claims.
3. Add `GET /api/projects/{projectId}/workflow` returning:
   - project identity/details;
   - datasets with active-version metadata;
   - per-step state (`available`, `blocked`, `inProgress`, `complete`, `stale`);
   - machine-readable blocker codes and user-safe messages;
   - recommended canonical route;
   - current design revision/status and latest deployment summary.
4. Centralize readiness calculation in `ProjectService` (or a focused `ProjectWorkflowService`) and reuse it for the workflow DTO, export/deploy preflight, and guards. Remove client-side stage heuristics from Project Overview.
5. Add focused CRUD/service/controller contract tests, including empty project creation and cascade-safe delete.

### 4.2 Dataset import, lookup, and version projection

1. Add `GET /api/datasets/{datasetId}` returning ownership-safe dataset metadata including `projectId`; use it for legacy redirects and refresh-safe selected-dataset context.
2. Extend dataset DTOs with `activeVersionId`, `activeVersionNumber`, `versionKind`, `analyzedAt`, `requiresAnalysis`, and a stable status enum/code. Stop making Angular parse display strings such as `Cleaned - Analysis Required`.
3. Create raw/imported version v1 in the same transaction as every CSV, Excel, or API import and set `Dataset.ActiveVersionId` immediately.
4. Change replacement to create a new immutable imported/source version and switch the pointer, rather than deleting version history. Invalidate analysis, confirmation, pending relationship suggestions, and design readiness. If destructive history reset must remain as an administrative operation, give it a separate explicit endpoint.
5. Make all list, preview, analysis, relationship, report, schema, export, and deployment reads use an active-version projection. Root `DatasetRow`/`DatasetColumn` may remain as immutable original-import compatibility storage in this rebuild, but must no longer be conditionally treated as “current.”
6. Put CSV/Excel/API parsing behind one `TabularImportData` persistence path so import type affects parsing/source metadata, not version semantics.

### 4.3 Analysis

1. Add `datasetVersionId` to .NET-to-Python analysis requests and Python responses.
2. Require the requested version to equal the dataset’s active version before analysis begins.
3. Save results with a compare-and-set condition on `(datasetId, activeVersionId)`. Return `409 active_version_changed` if it changed while Python/.NET analysis was running; never attach a result to a different version.
4. Treat `DatasetVersion.AnalysisResultJson` and `AnalyzedAt` as authoritative. Root dataset analysis fields can remain synchronized only as compatibility/summary columns until a later contract migration.
5. Make `GET /analysis` return `404/409 analysis_not_available` when the active version has no saved analysis; do not synthesize a saved-looking result on read.
6. Add a project analysis endpoint, preferably `POST /api/projects/{projectId}/analysis`, accepting optional dataset IDs and returning per-version results/failures. The first implementation may execute synchronously with bounded concurrency; for large workloads, move it to a job later without changing the UI contract.
7. Keep the .NET fallback but record `engine` (`python` or `dotnet`) and contract version in the saved result for diagnostics.

### 4.4 Cleaning and active-version consistency

1. Make `Dataset.ActiveVersionId` the sole target source of truth. Keep `DatasetVersion.IsActive` only during the expand/rollback window and update it transactionally; remove it in the later contract migration.
2. Add expected source version IDs to preview/apply/restore commands. Reject stale previews with `409 active_version_changed`.
3. Continue creating new immutable versions for apply, undo, restore, and source replacement. Use explicit `VersionKind` values such as `Imported`, `Cleaned`, and `Restored`; do not infer deployability from `IsRawOriginal`.
4. Update the active pointer, invalidate quality confirmation, and mark any design based on older versions stale/Draft in one transaction.
5. Return active version/readiness in every cleaning response so the UI can refresh route context without local storage.
6. Permit quality confirmation when every active version is analyzed and either all actionable issues were resolved or the user explicitly accepted a no-change result. Preserve the exact confirmed version map.
7. Update deployment to accept any analyzed, quality-confirmed active version, including an unchanged imported version. Continue requiring exact version/table/column mapping.

### 4.5 Schema and relationships

1. Retire external use of `POST /design/generate`; keep `POST /schema/generate` as the canonical, quality-gated operation. Redirect/compatibility behavior should be documented before eventual removal.
2. Keep `If-Match` optimistic concurrency for every design mutation. The merged Angular step must pass the latest returned revision across tables and relationships.
3. Add `SourceDatasetVersionId` and `TargetDatasetVersionId` to relationship suggestions. Detect only against the current quality-confirmed/active set used by Schema.
4. Mark or filter old-version suggestions as stale. Never silently apply one to a newer design; accepted relationships remain part of the design revision but schema regeneration must clearly invalidate/rebuild them.
5. Return schema staleness and blocker codes in workflow/preflight DTOs rather than discovering staleness only when the user presses Validate or Deploy.
6. Keep SQL/DBML/JSON generation in .NET as the single schema source of truth.

### 4.6 Export and deployment

1. Add a final-step preflight endpoint, or include equivalent data in `/workflow`, with independent `canExport` and `canDeploy` flags plus blocker codes.
2. Build quality reports from active-version projections and include dataset/version IDs in the report.
3. Require export artifacts to identify their design revision and source-version map. The UI must label downloads with that revision.
4. Keep `POST /deployments` and deployment history/download endpoints. Do not combine artifact download and deployment into one mutating endpoint.
5. Ensure a deployment record captures the confirmed source-version map in addition to design revision so historical deployments remain auditable after later cleaning.

## 5. Python changes required

1. Keep `python-analysis-service/app/main.py` as the sole application definition and root `main.py` only as the import shim used by Uvicorn.
2. Version the internal contract (`contractVersion`) and add `datasetVersionId` to `AnalyzeRequest`/`AnalyzeResponse`. Cleaning already carries `versionId` and returns `sourceVersionId`; enforce equality in tests.
3. Keep Python stateless: the backend owns authorization, active-version selection, persistence, concurrency, readiness, and audit history.
4. Keep only the endpoints used by .NET:
   - `GET /health`
   - `POST /analyze`
   - `POST /cleaning/preview`
   - `POST /cleaning/apply` (or a later shared `/cleaning/execute` alias while old clients remain supported)
5. Deprecate and then remove the unused legacy `/api/analysis/*` router and Python schema/DBML/relationship generation services. Relationship detection and schema generation already have richer persisted .NET implementations.
6. Add analysis tests for missing-value rules, duplicate counting, type detection, numeric statistics, date/boolean behavior, chart recommendations, version echo, invalid payloads, and API contract serialization.
7. Add FastAPI endpoint tests for health/analyze/cleaning, not only `CleaningService` unit tests.
8. Pin or lock reproducible dependency versions in CI rather than relying only on broad minimum ranges.

## 6. Database migration requirements

Use expand/contract migrations; do not drop rollback-critical columns in the first workflow release.

### 6.1 Expand/backfill migration (required before the new workflow)

Create a migration tentatively named `EstablishActiveDatasetVersionInvariant` that:

1. Adds `VersionKind` to `dataset_versions` with a safe default and backfills existing rows (`Imported` for original/import baselines, `Restored` for restore batches, otherwise `Cleaned`).
2. Creates a raw/imported version for every existing dataset with no versions. Build ordered `RowsJson` and `ColumnsJson` from `dataset_rows`/`dataset_columns`, copy counters/analysis timestamps, and use the project owner as `CreatedByUserId`.
3. Repairs each `Dataset.ActiveVersionId` in this order: valid existing pointer, one flagged `IsActive` version, highest version number. Abort the migration if a dataset cannot be repaired.
4. Normalizes compatibility `IsActive` flags so exactly the pointed-to version is true.
5. Adds a filtered unique index that allows at most one `IsActive = true` row per dataset during the compatibility window.
6. Adds indexes for active-version workflow reads and relationship source/target version lineage.
7. Adds nullable `SourceDatasetVersionId`/`TargetDatasetVersionId` to relationship suggestions, backfills them from dataset active pointers, and marks suggestions stale when either side cannot be resolved.
8. Adds a source-version snapshot column (JSONB is acceptable for this iteration) to deployments and backfills existing deployments with `{}`/unknown lineage.

Before applying, run audit queries for missing pointers, pointers to another dataset, multiple active flags, version-number duplicates, invalid JSON snapshots, and confirmation/design maps referencing missing versions. The migration must be transactional and must fail rather than discard unrecoverable data.

### 6.2 Application compatibility release

- New code reads `ActiveVersionId` only and writes both the pointer and `IsActive` flag.
- Existing `ConfirmedVersionsJson` and `DesignModel.SourceVersionsJson` remain in this rebuild to bound risk. Add strict validation and tests; `DesignTable.SourceDatasetVersionId` remains the relational schema lineage.
- Do not add a database “current project/current dataset/current step” column. Navigation selection belongs in the URL.
- Do not drop `dataset_rows`, `dataset_columns`, or root analysis/counter columns yet. Treat them as original/compatibility data while verifying all current reads use active-version projections.

### 6.3 Contract migration (after one stable release)

Create a later migration tentatively named `RemoveLegacyDatasetActiveFlag` to drop `DatasetVersion.IsActive` and its compatibility index after telemetry/data audits show pointer consistency. At the same time, consider dropping duplicated root current-analysis fields only if no API/report path reads them. This delayed contract step preserves straightforward rollback of the first workflow release.

## 7. Exact files likely to change

The implementation should keep commits vertical and may add small focused DTO/context files. The following is the expected change surface.

### 7.1 Angular routes, shell, and state

- `frontend/angular-app/src/app/app.routes.ts` — canonical nested project workflow routes and legacy redirects.
- `frontend/angular-app/src/app/app.routes.spec.ts` — assert canonical route set, redirect targets, guards/resolvers, and no duplicate routed component aliases.
- `frontend/angular-app/src/app/layout/app-shell.component.ts`
- `frontend/angular-app/src/app/layout/app-shell.component.html` — remove implementation-area navigation and local workflow assumptions; render Projects plus the five project steps.
- `frontend/angular-app/src/app/services/workflow-state.service.ts` — convert to a temporary adapter, then delete.
- `frontend/angular-app/src/app/services/auth.service.ts` — one-time removal of legacy workflow keys on session initialization/logout; auth storage remains.
- `frontend/angular-app/src/app/services/forge-api.service.ts`
- `frontend/angular-app/src/app/services/design-api.service.ts`
- `frontend/angular-app/src/app/services/api.models.ts` — new canonical contracts and active-version/readiness fields.
- Add `frontend/angular-app/src/app/services/project-workflow-context.service.ts` — route-scoped, in-memory labels/summary only.
- Add `frontend/angular-app/src/app/services/project-workflow.resolver.ts` (or guard/resolver split) — owned project/workflow load.
- Add `frontend/angular-app/src/app/pages/project-workflow/project-workflow-shell.component.ts` and `.html` — five-step project navigation and outlet.
- Add a small legacy dataset redirect component/resolver under `frontend/angular-app/src/app/pages/legacy-dataset-redirect/`.

### 7.2 Angular pages

- `frontend/angular-app/src/app/pages/projects/projects.component.ts` and `.html`
- `frontend/angular-app/src/app/shared/project-card/project-card.component.ts` and `.html`
- `frontend/angular-app/src/app/pages/project-create/project-create.component.ts`, `.html`, and related specs/utils — simplify create-only behavior.
- `frontend/angular-app/src/app/pages/data-sources/data-sources.component.ts`, `.html`, and `.spec.ts` — canonical Data step and single import surface.
- `frontend/angular-app/src/app/pages/analyze-data/analyze-data.component.ts`, `.html`, `.css`, `analysis-chart.component.*`, plus new/updated specs — canonical Analyze step.
- `frontend/angular-app/src/app/pages/data-cleaning/data-cleaning.component.ts`, `.html`, `.css`, and `.spec.ts` — canonical Clean route/version semantics.
- `frontend/angular-app/src/app/pages/project-schema-designer/project-schema-designer.component.ts`, `.html`, `.css`, and `.spec.ts` — Schema container/tabs.
- `frontend/angular-app/src/app/pages/project-schema-designer/relationships-panel/relationships-panel.component.ts` and `.html` — migrate relationship review/mutations into Schema.
- `frontend/angular-app/src/app/pages/project-relationships/project-relationships.component.ts`, `.html`, and `.spec.ts` — source to refactor, then remove as a routed page.
- `frontend/angular-app/src/app/services/design-view-model.ts` and `design-state.service.ts`/`.spec.ts` — consolidate design/diagram state and revision handling.
- Add `frontend/angular-app/src/app/pages/project-export-deploy/project-export-deploy.component.ts`, `.html`, and `.spec.ts` — merged final step.
- `frontend/angular-app/src/app/pages/project-exports/project-exports.component.*` and `project-deployment/project-deployment.component.*` — refactor into panels, then remove standalone routes.
- Remove after content/redirect migration:
  - `pages/home/home.component.ts` and `.html`
  - `pages/project-overview/project-overview.component.ts` and `.html`
  - `pages/analysis/analysis.component.ts` and `.html`
  - `pages/dashboard/dashboard.component.ts` and `.html`
  - `pages/project-er-diagram/project-er-diagram.component.ts`, `.html`, and `.spec.ts`
  - `pages/placeholder/placeholder.component.ts`

### 7.3 Backend API, services, and persistence

- `backend/ForgeDB.API/Controllers/ProjectsController.cs`
- `backend/ForgeDB.API/Controllers/DatasetsController.cs`
- `backend/ForgeDB.API/Controllers/CleaningController.cs`
- `backend/ForgeDB.API/Controllers/DesignController.cs`
- `backend/ForgeDB.API/Controllers/RelationshipSuggestionsController.cs`
- `backend/ForgeDB.API/Controllers/DeploymentController.cs`
- `backend/ForgeDB.API/Models/DTOs/ProjectCreateDto.cs`
- `backend/ForgeDB.API/Models/DTOs/ProjectWorkspaceDto.cs`
- `backend/ForgeDB.API/Models/DTOs/DatasetResponseDto.cs`
- `backend/ForgeDB.API/Models/DTOs/DatasetPreviewDto.cs`
- `backend/ForgeDB.API/Models/DTOs/DatasetAnalysisRequestDto.cs`
- `backend/ForgeDB.API/Models/DTOs/DatasetAnalysisResponseDto.cs`
- `backend/ForgeDB.API/Models/DTOs/PythonAnalysisRequestDto.cs`
- `backend/ForgeDB.API/Models/DTOs/PythonAnalysisResponseDto.cs`
- `backend/ForgeDB.API/Models/DTOs/CleaningDtos.cs`
- `backend/ForgeDB.API/Models/DTOs/DesignDtos.cs`
- `backend/ForgeDB.API/Models/DTOs/RelationshipSuggestionDtos.cs`
- `backend/ForgeDB.API/Models/DTOs/DeploymentDtos.cs`
- Add `backend/ForgeDB.API/Models/DTOs/ProjectWorkflowDto.cs` (and optionally `ReleasePreflightDto.cs`).
- `backend/ForgeDB.API/Models/Entities/Dataset.cs`
- `backend/ForgeDB.API/Models/Entities/DatasetVersion.cs`
- `backend/ForgeDB.API/Models/Entities/RelationshipSuggestion.cs`
- `backend/ForgeDB.API/Models/Entities/Deployment.cs`
- `backend/ForgeDB.API/Data/ForgeDbContext.cs`
- Add the expand migration and generated designer under `backend/ForgeDB.API/Data/Migrations/`; update `ForgeDbContextModelSnapshot.cs`.
- `backend/ForgeDB.API/Repositories/DatasetRepository.cs` and `Interfaces/IDatasetRepository.cs`
- `backend/ForgeDB.API/Repositories/CleaningRepository.cs` and `Interfaces/ICleaningRepository.cs`
- `backend/ForgeDB.API/Repositories/ProjectRepository.cs` and `Interfaces/IProjectRepository.cs`
- `backend/ForgeDB.API/Repositories/RelationshipSuggestionRepository.cs` and its interface.
- `backend/ForgeDB.API/Repositories/DeploymentRepository.cs` and its interface.
- `backend/ForgeDB.API/Services/ProjectService.cs` and `Interfaces/IProjectService.cs`
- `backend/ForgeDB.API/Services/DatasetImportService.cs` and `Interfaces/IDatasetImportService.cs`
- `backend/ForgeDB.API/Services/DatasetAnalysisBuilder.cs`
- `backend/ForgeDB.API/Services/CleaningService.cs` and `Interfaces/ICleaningService.cs`
- `backend/ForgeDB.API/Services/DesignService.cs` and `Interfaces/IDesignService.cs`
- `backend/ForgeDB.API/Services/RelationshipDetectionService.cs` and its interface.
- `backend/ForgeDB.API/Services/DeploymentService.cs` and its interface.
- `backend/ForgeDB.API/Clients/PythonAnalysisClient.cs` and `IPythonAnalysisClient.cs`.
- `backend/ForgeDB.API/Program.cs` only if a new workflow/preflight service is registered instead of extending `ProjectService`.

### 7.4 Python

- `python-analysis-service/app/main.py`
- `python-analysis-service/main.py`
- `python-analysis-service/models/analysis_request.py`
- `python-analysis-service/models/analysis_response.py`
- `python-analysis-service/models/cleaning.py`
- `python-analysis-service/services/analysis_service.py`
- `python-analysis-service/services/cleaning_service.py`
- `python-analysis-service/tests/test_cleaning_service.py`
- Add `python-analysis-service/tests/test_analysis_service.py` and `test_api.py`.
- `python-analysis-service/requirements.txt` and `README.md`.
- Deprecate/remove after confirming no callers: `routers/analysis_router.py`, `services/data_profiler_service.py`, `services/relationship_detector_service.py`, `services/dbml_generator_service.py`, `services/chart_recommendation_service.py`, `services/file_parser_service.py`, `models/schema_response.py`, and `models/chart_recommendation.py`.

### 7.5 Tests

Update existing relevant suites and add focused coverage under:

- `backend/ForgeDB.API.Tests/Controllers/OwnershipAuthorizationTests.cs`
- Add `backend/ForgeDB.API.Tests/Controllers/ProjectWorkflowControllerTests.cs` and route/contract tests for legacy redirects’ lookup endpoint.
- Add `backend/ForgeDB.API.Tests/Services/ProjectServiceCrudTests.cs`.
- `backend/ForgeDB.API.Tests/Services/DatasetManagementTests.cs`
- `backend/ForgeDB.API.Tests/Services/ExcelImportTests.cs`
- `backend/ForgeDB.API.Tests/Services/ApiJsonImportTests.cs`
- Add CSV import/version and analysis concurrency tests.
- `backend/ForgeDB.API.Tests/Services/CleaningServiceTests.cs`
- `backend/ForgeDB.API.Tests/Services/SchemaWorkspaceServiceTests.cs`
- `backend/ForgeDB.API.Tests/Services/RelationshipDetectionServiceAcceptTests.cs`
- `backend/ForgeDB.API.Tests/Services/DeploymentServiceTests.cs`
- Add migration tests patterned after the existing schema/relationship migration tests.
- Add Angular specs for Projects, Project Card, workflow context/shell, Analyze, and Export & Deploy; replace stale standalone ER expectations.

## 8. Implementation order

Use vertical, independently testable increments. Do not start by deleting old pages.

1. **Freeze and characterize contracts.** Add tests for current project CRUD, all three imports, active preview/analysis, no-op cleaning confirmation, relationship version staleness, export, and deploy. Fix the existing time-dependent auth test fixture and stale Relationships DOM tests separately so the branch starts green.
2. **Expand the database.** Add/backfill version kind, active pointers/invariant index, relationship version lineage, and deployment source-version snapshot. Run migration tests and production-shaped audit queries.
3. **Make version state authoritative.** Create v1 at import; return active-version metadata; make preview/list/read use active projections; implement replacement as a new version; add the dataset metadata endpoint.
4. **Make analysis version-safe.** Version the Python contract, compare-and-set analysis persistence, make saved results authoritative, add project analysis orchestration, and add Python analysis/API tests.
5. **Harden Clean-to-Schema transitions.** Add expected version IDs, transactional invalidation/staleness, explicit no-change quality confirmation, and deployment support for confirmed unchanged imports.
6. **Add backend workflow/preflight DTOs.** Centralize five-step readiness/blockers and final-step export/deploy readiness. Validate ownership on every path.
7. **Install canonical Angular routing/state.** Add project workflow shell/resolver/context; make routes/query parameters authoritative; remove workflow `localStorage` writes; keep legacy redirects.
8. **Consolidate Projects and Data.** Remove Home duplication, simplify create, move project edit into Data/header, and keep one CSV/Excel/API import surface.
9. **Consolidate Analyze and Clean.** Merge dashboard/profile/explorer value into Analyze, then move Clean to its canonical route and version-aware contracts.
10. **Consolidate Schema.** Bring Relationships and diagram into Schema tabs with one revision stream; remove standalone forward navigation.
11. **Consolidate Export & Deploy.** Build the merged page on backend preflight and existing download/deployment endpoints.
12. **Compatibility and deletion pass.** Verify every old route redirect, remove unused standalone components/services/legacy Python routes, remove the temporary WorkflowState adapter, and update documentation.
13. **Contract migration later.** After one stable release and data audits, drop `DatasetVersion.IsActive` and any proven-unused duplicated root fields.

Each numbered increment should be a separate reviewable commit or small commit series and must leave build/test baselines no worse than the known failures recorded below.

## 9. Test strategy

### 9.1 Backend unit/integration tests

- Project CRUD: JWT-owned list/create/read/update/delete, normalization, empty list, forbidden access, missing project, cascade behavior.
- Imports: CSV quoting/BOM/errors; Excel worksheet selection; API preview/import/security; every import creates active version v1 atomically.
- Dataset selection: dataset metadata returns project ID; active version belongs to dataset; invalid/stale query target is rejected by API/redirect logic.
- Analysis: Python success, .NET fallback, saved-result-only reads, engine metadata, active-version compare-and-set conflict, project partial failures.
- Cleaning: immutable source snapshots, apply/undo/restore/replacement create new versions, stale preview conflict, exactly one active pointer, confirmation invalidation, no-change confirmation.
- Schema: exact confirmed source-version map, stale active-version detection, draft/valid revision changes, relationship mutations and regeneration behavior.
- Relationships: suggestions tied to version pairs, stale suggestions excluded, decisions not resurrected for the same version pair, concurrency/uniqueness.
- Export/deploy: active-version quality report, independent export/deploy blockers, unchanged confirmed import deploys, stale revision/version blocks, transaction rollback, history/artifact lineage.
- PostgreSQL migration test: backfill no-version datasets, repair flags/pointers, reject unrecoverable mismatches, unique active compatibility index.

Use EF InMemory only for pure service behavior. Keep relational PostgreSQL tests for migrations, composite/filtered constraints, deployment SQL, and transactions.

### 9.2 Angular tests

- Route table has only the canonical project steps plus documented redirects.
- Workflow shell renders five steps and derives IDs from route data/query parameters.
- Reload/deep-link/cross-project navigation cannot display stale stored labels or dataset status.
- Projects covers list/search/sort/create/edit/delete and error states.
- Data covers CSV, Excel, API, replace, delete, selection query synchronization, and active version badges.
- Analyze covers project/dataset scope, partial failure, saved-result rendering, version conflicts, and accessible/responsive charts.
- Clean covers selection, preview/apply, stale conflict refresh, history/restore language, no-change confirmation, and step gating.
- Schema covers one revision across table/relationship edits, diagram rendering, conflict recovery, validation, and stale versions.
- Export & Deploy covers independent readiness, artifacts, confirmation, conflict refresh, history, and downloads.
- Legacy routes resolve to the correct project and query-selected dataset without `localStorage`.

Prefer behavior/role/test-id assertions over copy- or layout-fragile DOM assumptions. Delete tests for removed pages only after their behaviors are covered in the merged page.

### 9.3 Python tests

- Unit-test analysis and cleaning edge cases.
- Contract-test request/response camelCase serialization and version echo.
- FastAPI-test the four supported endpoints and validation errors.
- Add a .NET fake-server integration test proving the Python contract and fallback behavior.

### 9.4 End-to-end acceptance matrix

Run at least these scenarios against PostgreSQL, .NET, Python, and a production Angular build:

1. Create empty project → Data → import CSV → Analyze → no-op Clean confirmation → Schema/Relationships → Export → Deploy.
2. Import one Excel worksheet and one API dataset → project analysis → clean one dataset → re-analyze → confirm → schema relationships → deploy.
3. Refresh and deep-link into every canonical step with and without `datasetId`.
4. Switch between two projects and verify no label/dataset/status leakage.
5. Start analysis/clean/schema in two browser sessions and verify version/revision conflicts are safe.
6. Replace a source as a new version and verify old analysis, confirmation, suggestions, schema, export, and deploy become stale/blocked while history remains.
7. Force Python analysis failure and verify .NET fallback; force Python cleaning failure and verify no version switch.
8. Force deployment SQL/data failure and verify rollback plus persisted failed history.
9. Visit every legacy route and verify its canonical redirect.

## 10. Risks and rollback plan

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Version backfill corrupts or misidentifies current data | Pre-migration audit, transaction, row-count/hash sampling, migration tests, database backup. Abort on unresolved datasets. | Restore backup or roll back the expand migration before serving writes. |
| Pointer/flag disagreement during mixed-version rollout | New code treats pointer as authority but dual-writes flag; filtered unique index; consistency health query. | Old application can still run while `IsActive` remains. Do not run the contract migration. |
| A concurrent clean/restore receives another version’s analysis | Carry version ID end to end and compare-and-set persistence. | Disable project batch analysis and fall back to per-dataset retries; no data rollback required. |
| Merged pages become too large or hard to review | Implement panels/tabs as focused standalone components, keep lazy loading per canonical step, measure bundle chunks. | Route legacy panels directly behind a temporary feature flag while retaining canonical backend contracts. |
| Legacy bookmarks break | One-release redirects and dataset metadata resolver; route tests and E2E matrix. | Re-enable legacy routes because old components are not deleted until the compatibility pass. |
| Relationship decisions attach to newer data incorrectly | Persist source/target version IDs and filter stale suggestions; require current design revision. | Hide suggestions and require re-detection; existing design can still be manually repaired. |
| Clean-but-unchanged datasets remain undeployable | Define deployability by exact confirmed analyzed version, not `IsRawOriginal`; add an acceptance test. | Export artifacts remain available; deploy can be temporarily disabled without losing design/version history. |
| Export and Deploy have different readiness | Backend preflight returns separate flags/blockers and one revision/source map. | Keep export enabled and deploy disabled; no persistence rollback needed. |
| Python contract rollout mismatch | Add contract version and tolerant additive fields first; deploy Python before requiring version echo in .NET. | .NET fallback keeps analysis available; retain old Python fields/endpoints for one release. |
| Existing failures obscure regressions | Fix or quarantine only with documented issue links before rebuild; record exact baseline below. | Compare every increment to this baseline and revert the responsible increment. |

Rollback sequence for the first simple-workflow release:

1. Stop new writes/deployments if a version-integrity alert fires.
2. Switch the Angular feature flag/routing configuration back to legacy pages if the problem is UI-only.
3. Revert backend/Python application versions together if the internal contract is involved; `IsActive` and old endpoints remain during the compatibility release.
4. Roll back the expand migration only if no post-migration versions/writes must be preserved; otherwise restore the pre-migration backup into a recovery database and reconcile by version ID.
5. Keep deployment records and immutable version snapshots; never “fix” rollback by deleting history.
6. Run the consistency audit and full acceptance matrix before re-enabling writes.

## Baseline build and test status

Commands were run from the checked-out branch on 2026-07-19 without changing application source. `npm.cmd` was used because the machine’s PowerShell policy blocks `npm.ps1`.

The working tree already contained an unstaged user modification to `frontend/angular-app/src/app/pages/home/home.component.html`; the baseline commands included that existing state. This plan does not alter or stage that file.

| Command | Status | Result |
| --- | --- | --- |
| `dotnet build ForgeDB.sln` from `backend` | Pass | 0 warnings, 0 errors. Both `ForgeDB.API` and `ForgeDB.API.Tests` built for .NET 8. |
| `dotnet test ForgeDB.sln --no-restore` from `backend` | Fail | 224 passed, 2 failed, 0 skipped, 226 total. |
| `npm.cmd run build` from `frontend/angular-app` | Pass | Angular production build completed; output `dist/forgedb`. Initial bundle 477.19 kB raw / 105.11 kB estimated transfer. |
| `npm.cmd test -- --watch=false` from `frontend/angular-app` | Fail (additional audit run) | 89 passed, 3 failed, 92 total across 12 files. The user explicitly required the Angular build; the unit run was added to establish the existing frontend-test baseline. |
| `.venv\Scripts\python.exe -m pytest` from `python-analysis-service` | Pass | 14 passed in 0.15 seconds. |

### Existing backend failures

Both failures are in `ForgeDB.API.Tests/Services/AuthServiceTests.cs`:

1. `ChangePasswordAsync_UpdatesOnlyHashAndChangesLoginPassword`
2. `ResetPasswordAsync_ConsumesTokenAndChangesLoginPassword`

Both throw `IDX12401` while generating a JWT because the fixture’s fixed expiry (`2026-07-18 13:00`) is before the runtime `NotBefore` (`2026-07-19`). The stack reaches `AuthService.GenerateJwtToken` at line 358. This is a clock-dependent test fixture failure, not a rebuild change.

### Existing frontend failures

All three failures are in `project-relationships.component.spec.ts`:

1. `restores the complete workspace on direct route load with one design and suggestion request` — expected `[data-testid="continue-to-er"]`, but the element is absent.
2. `revalidates Draft relationship changes without trapping the ER workflow` — expected a continue-to-ER element after validation, but none exists.
3. `keeps every workflow section contained at the 390px responsive layout` — expected a `continue-section`, but it is absent.

These tests describe the retired standalone ER progression and are consistent with the route/page duplication found in this audit. They should be replaced by merged Schema-step navigation/diagram tests, not made green by restoring the obsolete workflow.

### Existing test coverage gaps

- No focused frontend tests for Home, Projects, Project Card, Analyze Data, Analysis/Explorer, or Dashboard.
- No direct `WorkflowStateService` tests for malformed/stale/cross-project storage.
- Route testing checks lazy loading only; it does not verify redirects or workflow order.
- No focused backend project CRUD service tests.
- Python has cleaning tests only; no analysis or FastAPI endpoint tests.
- Current tests cover many design, validation, cleaning, deployment, Excel, API import, ownership, and migration behaviors, but not the full active-version lifecycle from import through deploy.

## Definition of done for the future rebuild

The rebuild is complete only when:

- the UI exposes Projects plus exactly five canonical project steps;
- every refresh/deep link works with storage cleared;
- project/dataset selection and active-version identity cannot disagree;
- CSV, Excel, and API imports share one Data experience and create active v1 atomically;
- analysis is saved only to the version actually analyzed;
- Clean supports immutable history, no-change confirmation, and reliable invalidation;
- Schema includes relationships/diagram under one revision;
- Export & Deploy share one preflight and preserve independent actions;
- all legacy routes redirect correctly for the compatibility period;
- .NET, Angular, and Python builds/tests plus the acceptance matrix pass with no unexplained failures;
- the contract migration is deferred until rollback telemetry confirms it is safe.
