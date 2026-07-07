# Phase 1 Implementation Report

## 1. Summary

The project now has a normalized, backend-owned Design Model that is the single source of truth
for project-level schema preview and export. Five new EF Core entities
(`DesignModel`/`DesignTable`/`DesignColumn`/`DesignRelationship`/`RelationshipSuggestion`) replace
the old live-computed, `Project.DashboardConfig`-JSON-backed relationship suggestions and the
inline-string project schema builder. A granular Design API supports table/column/relationship
CRUD with revision-based optimistic concurrency (`If-Match` / 409 / 428). Three generator classes
(SQL, DBML, JSON) are the *only* code path that turns a design into text, used identically by the
preview endpoint and the export packager. A validation engine computes error/warning issues on
demand and gates export on errors. A heuristic relationship-detection service (the same scoring
algorithm as before) now persists suggestions with an accept/reject lifecycle instead of ephemeral
JSON. A one-time startup service migrates any legacy `DashboardConfig` decisions into the new
table. The three project-level Angular pages that depended on the old schema/suggestion endpoints
now call the new API, with zero `.html` template changes.

## 2. Branch + commit list

Branch: `feature/design-model-foundation` (created from `feature/ui-polish-data-workspace`, after
committing that branch's pending UI-polish work locally — done at your request before starting
this task).

**No commits have been made yet.** Per your instruction mid-task ("make all things local dont
commit now"), all Phase 1 work exists only as uncommitted changes in the working tree. Nothing has
been pushed or committed. Let me know if/how you'd like this split into commits.

## 3. Schema changes

Entities (`backend/ForgeDB.API/Models/Entities/`): `DesignModel`, `DesignTable`, `DesignColumn`,
`DesignRelationship`, `RelationshipSuggestion` — all `int` ids, following the codebase's existing
convention (no Guids anywhere else in the model).

| Entity | Key FKs / delete behavior | Indexes |
|---|---|---|
| DesignModel | ProjectId → Project, **Cascade** (1:1 via unique index) | Unique on ProjectId |
| DesignTable | DesignModelId → DesignModel, **Cascade**; SourceDatasetId → Dataset, **SetNull** | DesignModelId, SourceDatasetId |
| DesignColumn | DesignTableId → DesignTable, **Cascade** | DesignTableId |
| DesignRelationship | DesignModelId → DesignModel, **Cascade**; FromColumnId/ToColumnId → DesignColumn, **Restrict**; SuggestionId → RelationshipSuggestion, **SetNull** | DesignModelId, FromColumnId, ToColumnId, SuggestionId |
| RelationshipSuggestion | ProjectId → Project, **Cascade**; SourceDatasetId/TargetDatasetId → Dataset, **Restrict** | Unique on (ProjectId, SourceDatasetId, SourceColumnName, TargetDatasetId, TargetColumnName); TargetDatasetId |

`Revision` on `DesignModel` is `.IsConcurrencyToken()`. `LayoutJson` and `EvidenceJson` are mapped
`jsonb`. Migration name: **`DesignModelFoundation`**
(`20260706173125_DesignModelFoundation.cs`), applied successfully to the local dev Postgres.

**Cascade-vs-explicit-delete decision (DesignRelationship's two column FKs):** the prompt
anticipated a cascade-cycle problem if `FromColumnId`/`ToColumnId` were `Cascade` — deleting a
`DesignModel` would reach `DesignRelationship` two ways (directly, and via
`DesignTable → DesignColumn → DesignRelationship`), which Postgres itself tolerates but which
would let a normal column/table delete leave orphaned relationships blocked by a **Restrict** FK
mid-transaction. I set both to **Restrict** and made `DesignService` explicitly remove any
`DesignRelationship` referencing a column before removing that column (or its table), all inside
one `SaveChangesAsync` call — i.e., one transaction. This is proven by
`DesignServiceDeleteColumnTests.DeleteColumnAsync_RemovesRelationshipsReferencingIt`.

## 4. Backfill / backward compatibility

Legacy JSON found: `Project.DashboardConfig` held a `{ RelationshipDecisions: [...] }` blob written
by the old `ProjectService.SaveRelationshipDecisionAsync` (accept/reject decisions only — the
suggestions themselves were always recomputed live, never stored).

Migration: `LegacySuggestionBackfillService` (`IHostedService`), registered in `Program.cs`,
runs once at application startup in its own DI scope. It reads every project's `DashboardConfig`,
parses the legacy shape, and inserts a `RelationshipSuggestion` row for each decision that doesn't
already exist. **Idempotency guard:** an explicit existence check per row (by the same key the
unique index enforces) plus the unique index itself as a hard backstop; a second run inserts
nothing. `Project.DashboardConfig` is **not dropped** — read-only source for this migration.

Verified live: on first run against the dev database it logged
`Legacy relationship-suggestion backfill migrated 7 row(s)...`; a second run (server restart)
inserted zero further rows.

One bug caught and fixed during this: the initial query filtered
`DashboardConfig != null && DashboardConfig != string.Empty`, and Postgres tried to parse the
empty-string literal as JSON for the jsonb column, throwing `22P02: invalid input syntax for type
json` and crashing host startup. Fixed by filtering only on nullness and letting the existing
per-row `try/catch (JsonException)` handle blank/malformed content.

## 5. Endpoint table

| Method | Route | If-Match | Implemented |
|---|---|:---:|:---:|
| GET | /api/projects/{projectId}/design | – | ✅ |
| GET | /api/designs/{designId}/preview?format= | – | ✅ |
| GET | /api/designs/{designId}/validation | – | ✅ |
| POST | /api/projects/{projectId}/design/generate | – (see §11) | ✅ |
| POST | /api/designs/{designId}/tables | ✅ | ✅ |
| PATCH | /api/design-tables/{tableId} | ✅ | ✅ |
| DELETE | /api/design-tables/{tableId} | ✅ | ✅ |
| POST | /api/design-tables/{tableId}/columns | ✅ | ✅ |
| PATCH | /api/design-columns/{columnId} | ✅ | ✅ |
| DELETE | /api/design-columns/{columnId} | ✅ | ✅ |
| POST | /api/designs/{designId}/relationships | ✅ | ✅ |
| PATCH | /api/design-relationships/{relationshipId} | ✅ | ✅ |
| DELETE | /api/design-relationships/{relationshipId} | ✅ | ✅ |
| PUT | /api/designs/{designId}/layout | ✅ | ✅ |
| GET | /api/projects/{projectId}/relationship-suggestions?status= | – | ✅ |
| POST | /api/projects/{projectId}/relationship-suggestions/detect | – | ✅ |
| POST | /api/relationship-suggestions/{id}/accept | – | ✅ |
| POST | /api/relationship-suggestions/{id}/reject | – | ✅ |
| GET | /api/projects/{projectId}/exports/package (existing route, rewired) | – | ✅ |

Every mutating endpoint: missing `If-Match` → 428; unparsable → 400; stale/racing revision → 409
`{ currentRevision, message }` (the DB-level concurrency token on `Revision` catches genuine races
between two concurrent writers, not just the explicit pre-check).

## 6. Deprecated/removed legacy schema-derivation paths (REQUIRED)

- `ProjectService.BuildRelationshipSuggestions`, `TryBuildRelationshipSuggestion`,
  `ScoreRelationshipCandidate`, `SaveRelationshipDecisionAsync`, `ReadWorkspaceConfig`,
  `BuildSuggestionId`, `ProjectWorkspaceConfig`, `ProjectRelationshipStoredDecision` — deleted.
  The scoring algorithm itself was **preserved**, moved (with credit) into
  `RelationshipDetectionService` in `backend/ForgeDB.API/Services/RelationshipDetectionService.cs`,
  now persisting instead of returning ephemeral DTOs.
- `ProjectService.BuildProjectSchema`, `GenerateProjectSql`, `GenerateProjectDbml`,
  `BuildPrimaryKeyCandidates` — deleted (inline SQL/DBML string builders, the exact "older path"
  called out in the prompt). Replaced by `SqlSchemaGenerator`/`DbmlGenerator`/`JsonSchemaGenerator`.
- `ProjectService.GetProjectSchemaAsync`, `GenerateProjectSchemaAsync`,
  `GetRelationshipSuggestionsAsync`, `AcceptRelationshipAsync`, `RejectRelationshipAsync` and their
  `IProjectService` signatures — deleted.
- `ProjectsController` actions: `GetProjectSchema`, `GenerateProjectSchema`,
  `GetRelationshipSuggestions`, `AcceptRelationship`, `RejectRelationship` (routes
  `GET/POST .../schema`, `.../schema/generate`, `.../relationships/suggestions|accept|reject`) —
  removed. `GetExportPackage` (`.../exports/package`) **kept** (same route/DTO), internals rewired.
- DTOs `ProjectRelationshipSuggestionDto`, `ProjectRelationshipDecisionDto`, `ProjectSchemaDto`,
  `ProjectSchemaTableDto`, `ProjectSchemaColumnDto` (`Models/DTOs/ProjectWorkspaceDto.cs`) — deleted
  (confirmed unused elsewhere via repo-wide search before removal).
- Frontend: `ForgeApiService.getProjectSchema`, `generateProjectSchema`,
  `getProjectRelationshipSuggestions`, `acceptProjectRelationship`, `rejectProjectRelationship` —
  deleted (confirmed unused after rewiring the 3 components below).

**Deliberately NOT touched (deviation, see §11):** the older *per-dataset* flow —
`SchemaService`, `SchemaDocumentFactory`, `DatabaseSchema`/`DatabaseDeployment` entities,
`SchemasController`, `DeploymentService`, and the Angular `WorkspaceComponent` /
`SchemaReviewComponent` / `RelationshipsComponent` (schema-level) / `DeploymentComponent` /
`SchemaExportService`'s string generators. This is a separate, still-routed feature area the
manual checklist never exercises and Phase 1's DesignModel doesn't cover (it's single-dataset, not
project-wide). Left in place to avoid an unrelated, untested rewrite.

## 7. Generator notes

- Common interface `IDesignSchemaGenerator` (`Format` + `Generate(DesignModelSnapshot)`), resolved
  by format string through `DesignSchemaGeneratorResolver`, used by both
  `DesignService.PreviewAsync` and `DesignService.PrepareExportArtifactsAsync` — one call site, one
  code path, confirmed byte-identical in the manual test (step 10).
- **Dependency sort:** DFS-based topological sort of tables by FK dependency (referenced table
  before referencing table), so foreign keys are inlined directly into `CREATE TABLE`.
- **Cycle fallback:** on cycle detection, tables are emitted in id order with no inline FKs, and
  every foreign key is instead emitted as `ALTER TABLE ... ADD CONSTRAINT ...` after all
  `CREATE TABLE`s — proven by `SqlSchemaGeneratorTests.Generate_CyclicRelationships_...`.
- Indexes on every FK column always emitted, regardless of the above path.
- **Quoting rule:** an identifier is double-quoted unless it matches `^[a-z_][a-z0-9_]{0,62}$`
  **and** is not a (documented, non-exhaustive) PostgreSQL reserved word. The reserved-word check
  was added beyond the prompt's literal wording ("quote whenever not a safe lowercase identifier")
  because a reserved word like `select` or `order` *is* a safe-lowercase-pattern match but would
  still break unquoted SQL — the same word list is shared with the validation engine's
  `reserved-word-identifier` warning so the two agree.
- DBML: `>` for many-to-one, `-` for one-to-one; verified by hand to be syntactically valid
  dbdiagram.io input (Project/Table/Ref blocks, bracketed column settings, quoted-when-needed
  identifiers).
- JSON: `formatVersion: 1`, `tables`, `relationships`, `metadata: { projectId, revision,
  generatedAt }`.

## 8. Validation rules implemented

Errors: `duplicate-table-name`, `duplicate-column-name`, `invalid-identifier` (empty or >63 chars,
even quoted), `relationship-endpoint-missing`, `fk-target-not-key`, `fk-type-mismatch`.
Warnings: `table-without-primary-key`, `reserved-word-identifier`, `nullable-fk-column`,
`isolated-table`, `zero-column-table`.

**Skipped rule:** profile/type risk (stored values incompatible with the chosen SqlType). The
validation engine only ever sees `DesignModelSnapshot` (by design — the same snapshot the
generators consume, so preview/export/validation can never disagree). Re-reading `Dataset` row
values would mean plumbing the repository layer into a validation-only path, which the prompt
explicitly allows skipping when it isn't cheap; I judged it wasn't, for Phase 1.

All 11 rules have both a positive (triggers) and negative (clean model, `Validate_CleanModel_ProducesNoIssues`) test in `DesignValidationServiceTests`.

## 9. Build/test results

```
dotnet build                 → Build succeeded. 0 Warning(s), 0 Error(s)
dotnet ef migrations add DesignModelFoundation --project ForgeDB.API --startup-project ForgeDB.API
                              → Done. (single project — no separate Data project in this repo)
dotnet ef database update    → Done. (Postgres via docker compose up -d, port 5433)
dotnet test                  → Passed! Failed: 0, Passed: 20, Skipped: 0, Total: 20
cd frontend/angular-app && npm run build
                              → Application bundle generation complete. 0 errors.
                                Initial total 586.06 kB | 131.46 kB transfer
```

## 10. Manual test matrix

| # | Step | Result | Evidence |
|---|---|:---:|---|
| 1 | Create project, upload both CSVs | PASS | Datasets id=20 (people_export, 3 rows/3 cols), id=21 (sales_dump, 3 rows/4 cols) |
| 2 | Analyze/profile both | PASS | Both returned `"status":"Analyzed"` with full column profiles |
| 3 | POST detect | PASS | Suggestion id=8, sales_dump.client_no → people_export.client_no, score 0.99, evidence JSON with 6 reasons |
| 4 | POST design/generate (merge) | PASS | DesignModel id=1, 2 tables, 3+4=7 columns, revision=1 |
| 5 | Accept suggestion | PASS | suggestion.status=accepted, relationship id=1 created with suggestionId=8, designRevision=2 |
| 6 | GET design | PASS | Both tables, 1 relationship, layout=null, validationIssues=[], revision=2 |
| 7 | PATCH people_export → "people" with correct If-Match | PASS | 200, revision=3, table origin flipped to "user" |
| 8 | GET preview sql/dbml/json | PASS | All three say "people"; SQL has inline FK + `CREATE INDEX ix_sales_dump_client_no`; DBML is valid `Project/Table/Ref` syntax |
| 9 | DELETE relationship, POST new one | PASS | Delete → revision 4, isolated-table warnings reappear; create (onDelete=cascade) → revision 5, previews immediately reflect `ON DELETE CASCADE` |
| 10 | Export package | PASS | status="Database Package Ready"; sql/dbml/jsonSchema identical to the live previews; relationshipReportJson includes suggestion 8 (accepted, with evidence, relationship=null since its original relationship was replaced in step 9 — correct, historical) |
| 11 | Stale If-Match | PASS | 409, `{"currentRevision":5,...}`; re-GET confirmed table name unchanged |
| 12 | Reject + re-detect stability | PASS (adapted) | This dataset pair produces exactly one suggestion, already accepted, so there was nothing left to reject. Verified the equivalent guarantee instead: re-running detect left the accepted row untouched (same id, same decidedAt, no duplicate), and calling reject on it returned 409 "already been decided" — proving decided suggestions are never re-flagged or duplicated |
| 13 | No-PK warning, then invalid identifier → 422, then revert | PASS | PATCH people.client_no.isPrimaryKey=false → warning `table-without-primary-key`, export still 200; renamed a column to a 70-char name → error `invalid-identifier`, export → 422 with both issues listed; reverted both, validationIssues=[] again, revision=9 |

Also verified (beyond the checklist): missing `If-Match` on a mutation → 428 Precondition Required.

## 11. Deviations from this prompt

1. **Two schema-derivation paths existed, only one was in scope.** See §6 — the per-dataset legacy
   flow (`SchemaService`/`SchemaDocumentFactory`/`DatabaseSchema`/`SchemasController`/old pages) was
   left untouched as a smallest-scope resolution; it's a distinct feature area with its own routes,
   not covered by this prompt's checklist or entity spec.
2. **Generate is not gated by If-Match.** The prompt's endpoint table lists "Generate" as its own
   category, separate from "Mutate (all require If-Match)" — I took that grouping literally.
   Generate still atomically bumps the revision.
3. **Every mutation returns the full `DesignResponseDto`**, not just a bare revision number. The
   prompt only requires the new revision appear in the response body; returning the complete
   design (which includes `revision`) is strictly more useful to a frontend that would otherwise
   have to re-fetch after every edit, and keeps one response shape for read + every mutation.
4. **"Replace" mode strips at column granularity, not just table granularity**, so a table that
   mixes generated and user-edited columns keeps its user columns even if the table itself is
   still `Origin=generated`. Documented as a known limitation below — such a table's stripped
   generated columns are not automatically regenerated in the same pass.
5. **Accepting a suggestion never remaps to different columns.** The Angular relationships page's
   pre-existing "edit before accept" UI still lets a user edit From/To table/column text fields,
   but those edits are no longer applied (the accept endpoint always links the suggestion's
   original columns, per spec) — only an edited relationship type is honored, via a follow-up
   PATCH. This is a visible UX regression on that one control; documented in the component and
   below.
6. **`GeneratedSchemasCount`/`ExportReadinessStatus`/`NextRecommendedActions` wording** in
   `ProjectOverviewDto` were adapted from "schema" to "design" terminology and now source from the
   DesignModel/RelationshipSuggestion tables instead of the legacy per-dataset `DatabaseSchema`
   count, since the old count no longer reflects the real workflow state.

## 12. Known limitations / recommended follow-ups

- "Replace" generation mode is implemented but not exercised by any test or the manual checklist;
  see deviation #4 for its column-mix edge case.
- Accepting an edited suggestion (deviation #5) silently drops From/To column edits — a future
  phase should either remove those now-inert input fields or teach the accept endpoint to remap
  columns.
- The profile/type-risk validation warning is not implemented (§8).
- No design version history / undo — matches the prompt's explicit scope limits, noting it here
  since it's the most likely next ask.
- The reserved-word list (`SqlIdentifiers.ReservedWords`) is a curated common subset of Postgres's
  official reserved-keyword list, not the complete list.

## 13. Confirmation

`git status` reviewed: no `.env` files, no `appsettings.json` (only the pre-existing, already-
tracked `appsettings.Example.json` with placeholder localhost-only dev credentials), no `bin/`,
`obj/`, or `node_modules/` paths, no uploaded CSVs or database dumps staged. Nothing has been
committed or pushed this session.
