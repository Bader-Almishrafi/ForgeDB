# Fix Round 1 Report

Branch: `feature/design-model-foundation` (same branch as Phase 1/2, local only). Every commit in
this round is prefixed `fix1:`. Nothing was pushed, no remotes were added or touched, no other
branch was created or switched to, and `main` was never touched.

```
574f962 fix1: note FIX 1/FIX 2 as superseding two more stale PHASE1_REPORT.md claims
ef4a61a fix1: fix conflict message being wiped by its own queue refresh
eddc5f2 fix1: FIX 5b - batch relationship-suggestion inserts into one transaction
f849e9a fix1: FIX 5a - correct stale "no commits" claim in PHASE1_REPORT.md
8fb41d3 fix1: FIX 4 - add atomic column reorder endpoint, drop sequential PATCHes
d8a1bb0 fix1: FIX 3 - require If-Match and atomic concurrency on suggestion accept
ffde2e2 fix1: FIX 2 - require If-Match on /design/generate once a design exists
13dd398 fix1: eradicate legacy per-dataset schema/deployment bypass (frontend)
aaa4cb1 fix1: eradicate legacy per-dataset schema/deployment bypass (backend)
```

## 1. Environment repair (FIX 0)

**Before:** the review reported build/test failures. Killing all stray `dotnet`/`node`/`chromium`
processes and re-running `dotnet build -c Debug`, `dotnet test`, and `dotnet build -c Release` with
nothing else running immediately passed cleanly (0 warnings, 0 errors, 20/20 tests) — *before* any
`node_modules` work and before any code changes in this round. This is strong evidence the
reviewer's environment failures were a leftover-running-process file lock, not a code defect.

**Confirming evidence, found again mid-round:** near the end of this round, running `dotnet test`
while the `dotnet run` backend server (started for manual browser verification) was still up
produced exactly this failure mode again:
```
MSB3026: Could not copy "...\ForgeDB.API.exe" ... The file is locked by: "ForgeDB.API (11468)"
MSB3027: Could not copy "...\ForgeDB.API.exe" to "bin\Debug\net8.0\ForgeDB.API.exe" ... Exceeded retry count of 10. Failed.
```
Stopping that one process and re-running immediately succeeded (32/32, both configs — see §5).
This directly reproduces and confirms the original diagnosis: a running `dotnet run` process locks
its own build output; it is not a code problem, and no workaround/hack was applied — the fix is
simply "don't run `dotnet test`/`build` while a server from the same project is up."

**`node_modules`:** deleted entirely and reinstalled via `npm ci` twice this round (once at the
start, once again for the final verification pass in §5) — both completed cleanly (`added 526
packages, audited 527 packages`). **`package.json`/`package-lock.json` were not modified** — `git
status`/`git diff` on both showed zero changes after every `npm ci` in this round. The 7
pre-existing `npm audit` vulnerabilities (3 low, 4 high) were left unaddressed, per instruction (no
`npm audit fix --force`). No `--force` flags were used anywhere, and no workaround hacks were
introduced to make anything pass.

Playwright (used for the manual browser verification in §6, since `chromium-cli` isn't available on
this Windows host) was installed with `npm install --no-save playwright` and removed again with
`npm uninstall playwright` once verification finished — `package.json`/`package-lock.json` are
untouched by this either.

## 2. FIX 1 — eradicate the legacy per-dataset schema bypass

### (a) Deleted entirely

**Backend** (17 files):
`Services/SchemaService.cs`, `Services/SchemaDocumentFactory.cs`, `Services/DeploymentService.cs`,
`Services/Interfaces/ISchemaService.cs`, `Services/Interfaces/IDeploymentService.cs`,
`Repositories/SchemaRepository.cs`, `Repositories/Interfaces/ISchemaRepository.cs`,
`Repositories/DeploymentRepository.cs`, `Repositories/Interfaces/IDeploymentRepository.cs`,
`Controllers/SchemasController.cs`, `Models/Entities/DatabaseSchema.cs`,
`Models/Entities/DatabaseDeployment.cs`, `Models/DTOs/SchemaGenerateRequestDto.cs`,
`Models/DTOs/SchemaResponseDto.cs` (+ its nested `SchemaColumnDto`/`SchemaRelationshipDto`),
`Models/DTOs/SchemaRelationshipsUpdateDto.cs`, `Models/DTOs/DeploymentRequestDto.cs`,
`Models/DTOs/DeploymentResponseDto.cs`.

**Frontend** (4 full page directories, .ts + .html each):
`pages/schema-review/`, `pages/relationships/` (the schema-level page — distinct from
`pages/project-relationships/`, which is Phase 1/2 code and was **not** touched),
`pages/deployment/`, `pages/workspace/`.

`services/schema-export.service.ts` was deleted and replaced by a new
`services/file-download.service.ts` containing only the one method
(`downloadText`) that had a legitimate remaining caller — see (c).

### (b) Edited (backend)

- `Data/ForgeDbContext.cs` — removed the `DatabaseSchema`/`DatabaseDeployment` `DbSet`s, their
  `Project`/`Dataset` navigation config, and their standalone `modelBuilder.Entity<...>()` blocks.
- `Models/Entities/Project.cs`, `Models/Entities/Dataset.cs` — removed the
  `DatabaseSchemas`/`DatabaseDeployments` collection navigation properties.
- `Program.cs` — removed the 4 DI registrations for `ISchemaService`/`SchemaService`,
  `IDeploymentService`/`DeploymentService`, `ISchemaRepository`/`SchemaRepository`,
  `IDeploymentRepository`/`DeploymentRepository`.
- `Repositories/ProjectRepository.cs` — removed a dead
  `.Include(project => project.DatabaseSchemas...)` in `GetByIdWithWorkspaceAsync` (already
  unreferenced by `ProjectService`, confirmed via grep before removing).
- New migration `20260708113203_RemoveLegacySchemaDeploymentTables` drops `database_deployments`
  then `database_schemas` (FK order respected); applied to the local dev database.

### (c) Edited (frontend)

- `app.routes.ts` — removed the imports/route entries for `WorkspaceComponent`,
  `SchemaReviewComponent`, `RelationshipsComponent`, `DeploymentComponent`. The harmless legacy
  redirect stubs (`app/schema-review`, `app/relationships`, `app/deployment` → `redirectTo:
  'projects'`) were left in place since they don't reference any component — see the FIX 1d grep in
  §3, which confirms this is the *only* remaining hit for a removed-route pattern.
- `layout/app-shell.component.ts`/`.html` — removed the `WorkflowStep` interface, `StepState` type,
  `workflowSteps` array (9 entries, several routing to now-deleted pages), and the
  `stepState()`/`stepClasses()`/`nextActionLabel()` methods (confirmed via grep they were never
  called from the template before removal); removed the `schemaName()`-based "Schema" info line, a
  "Next action" line, and a header badge that all depended on the deleted state.
- `pages/dashboard/dashboard.component.html` — removed the "Generate Schema" CTA
  (`routerLink="['/datasets', datasetId, 'schema']"`).
- `services/workflow-state.service.ts` — removed `schemaId`/`schemaName` signals, `hasSchema`
  computed, `setSchema()`, `clearSchema()` (and its call from `clearDataset()`).
- `services/forge-api.service.ts` — removed `generateSchema`, `getSchema`, `getDatasetSchema`,
  `updateRelationships`, `deploySchema` and their now-unused type imports.
- `services/api.models.ts` — removed `SchemaGenerateRequest`, `SchemaResponse`, `SchemaColumn`,
  `SchemaRelationship`, `SchemaRelationshipsUpdateRequest`, `DeploymentRequest`,
  `DeploymentResponse` (all became unused; `ProjectSchemaColumn`, a distinct Design-API type, was
  left untouched).
- `pages/project-exports/project-exports.component.ts` — its only use of the old
  `SchemaExportService` was `downloadText()` (a generic blob-download helper, unrelated to schema
  string generation); updated to import/inject the new `FileDownloadService` instead.

### (b′) DeploymentService — investigated, found vestigial, deleted (decision D, with evidence)

Traced reachability before acting, per instruction: `DeploymentComponent` was reachable *only* via
the `schemas/:schemaId/deploy` route, linked *only* from `workspace.component.html`'s "Generate
deployment SQL" quick action and from `app-shell.component.ts`'s dead `workflowSteps[8]` entry
(never rendered — see below). Since `WorkspaceComponent` itself was proven unreachable, the entire
chain into `DeploymentComponent`/`DeploymentService` was dead. **Case found: vestigial (not
real/reachable elsewhere)** — deleted it, its controller endpoint (`POST
/api/schemas/{id}/deploy`, part of the already-deleted `SchemasController`), and its frontend
caller (`DeploymentComponent`).

### (a′) WorkspaceComponent — judgment call, with reachability evidence

The prompt named `workspace.component.html:155` as one bypass location but didn't explicitly say
"delete the whole page." Proved via three independent negative checks that
`/projects/:projectId/workspace` was unreachable from any *current* in-app navigation:
1. `app-shell.component.ts`'s **active** `navItems` array (the one actually rendered in the
   sidebar) has no "Workspace" entry — only Overview/Datasets/Explorer/Profile/Relationships/Schema
   Designer/ER Diagram/Exports.
2. `ProjectsComponent.openWorkspace(project)` — despite its name — navigates to
   `/projects/{id}/overview`, not `/workspace`.
3. `ProjectOverviewComponent`'s template has zero `/workspace` links (only the unrelated
   `.workspace-panel` CSS class, which is cosmetic naming, not a route).

Since the page was orphaned *and* ~90% of its remaining content (the `workflowSteps` grid, the
schema/ER/relationships/deploy quick actions, `schema`/`schemaByDataset` signals,
`loadDatasetSchema()`) was exactly the bypass being eradicated, deleting the whole component was
the cleanest, most defensible action rather than leaving a barely-functional orphaned shell.

### 3. FIX 1d — acceptance grep (pasted verbatim, re-run fresh for this report)

**1. Backend Services/Controllers, excluding generators and tests** — markers `"CREATE TABLE`,
`"REFERENCES`, `"Ref:`, `Table "` (escaped for grep):
```
$ grep -rnE '"CREATE TABLE|"REFERENCES|"Ref:|Table \"' backend/ForgeDB.API/Services backend/ForgeDB.API/Controllers --include="*.cs" | grep -v "Services/Generators/"
(no output — exit code 1 / zero matches)
```

**2. Frontend `.ts`**, same markers plus DBML syntax (`database_type`):
```
$ grep -rnE '"CREATE TABLE|"REFERENCES|"Ref:|Table \"|database_type' frontend/angular-app/src --include="*.ts"
(no output — exit code 1 / zero matches)
```

**3. Removed route paths**, across all frontend `.ts`/`.html`:
```
$ grep -rnE "workspace'|/workspace|schema-review|datasets/:datasetId/schema|schemas/:schemaId" frontend/angular-app/src --include="*.ts" --include="*.html"
frontend/angular-app/src/app/app.routes.ts:27:  { path: 'app/schema-review', redirectTo: 'projects', pathMatch: 'full' },
```
The one hit is the intentionally-kept legacy redirect stub (`/app/schema-review` → `redirectTo:
'projects'`) — it references no component, so it isn't part of the bypass; everything else is
zero hits, as required.

Backend build (`dotnet build -c Debug`) and full test suite were re-confirmed green immediately
after all FIX 1 deletions/edits (before moving to FIX 2) — see §5 for the final numbers.

## 4. Endpoint contract table (updated — generate/accept/reorder rows)

Supersedes the table in `PHASE1_REPORT.md` §5 for these three rows; all other rows are unchanged.

| Method | Route | If-Match | Notes |
|---|---|:---:|---|
| POST | `/api/projects/{projectId}/design/generate` | **conditional** | No DesignModel yet → no precondition, creates it, 200 with revision=1 (matches existing codebase convention of returning the full `DesignResponseDto`, not a bare 201). DesignModel exists → **required** for both `merge` and `replace`: missing → 428; stale → 409 `{currentRevision, message}` |
| POST | `/api/relationship-suggestions/{id}/accept` | **required** | Missing → 428; stale/racing → 409 `{currentRevision, message}` (`DesignConcurrencyException`, same shape as every other design mutation). Status change + new `DesignRelationship` + revision bump commit in one `SaveChanges` call; a genuine concurrent-accept race is caught via `DbUpdateConcurrencyException` → 409. Existing 409s unchanged: no design yet / already-decided (plain `{message}`, no `currentRevision` — not a revision conflict) |
| POST | `/api/relationship-suggestions/{id}/reject` | **none (unchanged, deliberate)** | Touches only the suggestion's own `Status`/`DecidedAt`, never the DesignModel or its revision — documented in a code comment on `RejectAsync` |
| POST | `/api/design-tables/{tableId}/columns/reorder` | ✅ (new endpoint) | Body: complete ordered `columnIds` list. Server validates set equality (count *and* membership — a duplicate-padded list of the right length is still rejected) → 400 otherwise. All ordinals applied in one transaction, single revision bump. Same `WithIfMatch` contract as every other `design-tables`/`design-columns` endpoint |

## 5. Build/test results

| Check | Result |
|---|---|
| `dotnet build -c Debug` (final, nothing running) | 0 Warnings, 0 Errors |
| `dotnet test` Debug (final) | **32/32 passed** |
| `dotnet build -c Release` (final, nothing running) | 0 Warnings, 0 Errors |
| `dotnet test` Release (final) | **32/32 passed** |
| `npm ci` (fresh, final pass) | `added 526 packages, audited 527 packages` — clean; `package.json`/`package-lock.json` unchanged |
| `npm run build` (`ng build`, final) | Clean, `Application bundle generation complete` |
| `npm test` (`ng test --watch=false`, final) | **18/18 passed** (2 test files) |

Test count grew from 20 → 32 backend (12 new: 5 for FIX 2 generate, 3 for FIX 3 accept
concurrency, 4 for FIX 4 reorder) and 14 → 18 frontend (4 new: 3 for FIX 2's
`generate()`/If-Match, 1 for FIX 4's `moveColumn()`).

## 6. Manual re-verification matrix

All steps driven against the real running stack (Postgres via `docker compose`, `dotnet run` API
on :5000, `ng serve` on :4200) using Playwright + real Chromium (temporarily installed, `--no-save`
— see §1), against the same persistent project (id 18) used in Phase 1/2's own manual testing.
Both servers were stopped again before the final build/test pass in §5.

| # | Step | Result | Evidence |
|---|---|:---:|---|
| 2 | Rename propagation: inline rename → SQL/DBML update, revision increments | PASS | Revision incremented on every run (e.g. 42→43); SQL/DBML preview contained the new name within ~1.2s |
| 5 | PK fix flow: toggle PK off → warning; "Add id column" fix clears it; SQL shows `id bigint` PK | PASS (after fixing a **test-script** bug — see below) | Removing `sales_dump.sale_ref`'s PK produced a "4 issues" badge; the sales_dump-scoped "Add id column" fix added an `id bigint` PRIMARY KEY column, cleared that table's `table-without-primary-key` warning, and the SQL preview showed `id bigint ... PRIMARY KEY` |
| 6 | Relationship recreate: delete, create a new one via UI; DBML many-side correct | PASS | Count 3→2→3; new `Ref: sales_dump.sale_date > people.client_no` line — many-side (the FK holder) listed first, matching the `>` convention |
| 8 | Two-tab 409: tab B edits, tab A's stale edit → 409 banner; Reload recovers, no overwrite | PASS (after fixing a **test-script** bug — see below) | Tab A's stale write was rejected; server retained tab B's value; "This design changed elsewhere" banner appeared; after clicking Reload, tab A displayed tab B's value and the banner cleared |
| 10 | Export gate: export matches previews; a deliberate error blocks it (422, no crash) | PASS | With 2 real `fk-type-mismatch` errors present, `GET .../exports/package` returned 422 and the Exports page showed the block message without a JS exception; after removing the errors, the same endpoint returned 200 and the page's SQL content matched `GET .../preview?format=sql` (`CREATE TABLE people (` found in both) |
| 12 | Keyboard-only: rename, change a type, create a relationship; visible focus; save indicators | PASS | Table-name input and the SQL-type `<select>` both showed a non-`none` focus box-shadow; a full relationship (`sales_dump.amount → people.full_name`) was created using only `focus`/`selectOption`/`Tab`/`Enter` — no mouse clicks — then cleaned up |
| F1 | Removed routes resolve to nothing; no nav path reaches them | PASS | All 4 removed URLs (`/projects/18/workspace`, `/datasets/20/schema`, `/schemas/1/relationships`, `/schemas/1/deploy`) redirected to `/` via the wildcard route; the rendered sidebar's `<a href>` list contains zero links matching `/workspace`, `/datasets/:id/schema`, or `/schemas/:id/...` |
| F2 | Generate on an existing design: no If-Match → 428; stale → 409; correct → 200 | PASS | No header → `428 {"message":"If-Match header with the current revision is required."}`; stale (+999) → `409 {"currentRevision":32,...}`; correct → `200` with `revision` incremented by exactly 1 |
| F3 | Accept with stale revision → 409; refresh; explicit retry succeeds (no auto-resend) | PASS (**after fixing a real product bug** — see below) | First accept sent the stale cached revision (35) → 409, suggestion still `"suggested"`, exactly 1 request sent, conflict banner text visible and persistent ("This design changed elsewhere..."); explicit second click sent the resynced revision (36) → success, suggestion `"accepted"` server-side; exactly 2 requests total, no automatic resend |
| F4 | Reorder columns → exactly one request; order (and contiguous ordinals) survive reload | PASS | Moving a column fired exactly one `POST .../columns/reorder` request (zero `PATCH design-columns/{id}` calls); ordinals stayed `[0,1,2,3]`; order survived a full `page.reload()` |

### A real product bug found and fixed during this verification (F3)

`ProjectRelationshipsComponent.handleDecisionError` set `errorMessage` to the conflict text and
then called `this.loadSuggestions()` to refresh the queue. `loadSuggestions()` clears
`errorMessage` to `''` **synchronously**, the instant it's called — before its HTTP response even
arrives. The conflict banner was overwritten in the same tick and would never actually have been
visible to a user hitting a real stale-revision 409. Fixed by reordering (refresh first, *then* set
the message, since nothing else clears it before the async response resolves) in
`project-relationships.component.ts`; re-verified end-to-end afterward (see F3 row above), and
covered the reorder rationale with an inline comment. Committed separately
(`ef4a61a`) since it was found only during this manual pass, after FIX 3's own commit.

### Test-script-only issues encountered (not product bugs — noted for transparency)

- **Step 5**: the PK toggle is the *second* of three checkboxes per column row
  (`[nullable, primaryKey, unique]`); an early version of the script grabbed index 0 (nullable) and
  wrongly reported the PK as already off. Fixed the script to use index 1; the underlying product
  behavior was correct all along.
- **Step 8**: an early version of the script had tab B "rename" a table to its own current name —
  a no-op the app correctly declines to PATCH (no request, no revision bump), so tab A's later
  write wasn't actually racing anything and succeeded normally. Fixed by using a genuinely unique
  name for tab B's edit. This is the same class of pitfall documented in `PHASE2_REPORT.md` §9
  ("reusing identical string values across script runs caused false negatives").
- **Step 10**: the script's console-error assertion was too strict — Chromium logs *any* failed
  HTTP response (including the deliberately-triggered 422 itself) as a "Failed to load resource"
  console entry, which is not a JS exception. `PHASE2_REPORT.md` §8 documents the identical
  non-issue for its own step 8 (a deliberately-triggered 409). Both are the browser reporting the
  network response, not an unhandled error.

## 7. Deviations and decisions

1. **WorkspaceComponent deleted wholesale**, not just its CTA lines — see §2(a′)'s reachability
   evidence. The prompt named one file/line; the whole component was orphaned and mostly bypass
   code, so removing it outright was cleaner than leaving an inert shell.
2. **`schema-export.service.ts` renamed to `file-download.service.ts`** (class
   `SchemaExportService` → `FileDownloadService`) rather than just emptied in place, since after
   removing the generation methods its only remaining responsibility (a generic blob download) had
   nothing to do with "schema export" anymore; its one caller (`project-exports.component.ts`) was
   updated accordingly.
3. **Generate's fresh-create response is `200 OK`, not `201 Created`.** The prompt allowed "201 or
   codebase convention" — every other design-mutation endpoint in this codebase returns `200` with
   the full `DesignResponseDto` (never `201`), so fresh-create generate follows that existing
   convention for consistency rather than introducing the only `201` in the API.
4. **`IRelationshipSuggestionRepository.AddAsync` was replaced, not left in place, by the new
   non-saving `Add()`.** It had exactly one call site (the detection loop being fixed) and would
   otherwise have been dead code with zero callers anywhere in the codebase, including tests —
   consistent with the "no dead exports" principle applied throughout FIX 1.
5. **No new backend integration/controller-test project was introduced.** This codebase's existing
   test convention (established in Phase 1/2) is service-layer unit tests against EF Core InMemory,
   with zero existing controller-level tests. New tests for FIX 2/3/4 follow that same convention;
   the controllers' If-Match header parsing (428/400) is a thin, already-established pattern
   (`DesignController.WithIfMatch`, reused/mirrored exactly) and was exercised via the manual
   F2/F3 checks in §6 instead of a new test harness.

## 8. Confirmation

- All work is on `feature/design-model-foundation`, local only. `git log` shows no pushes; `git
  remote -v` was not modified at any point in this round.
- No other branch was created or switched to; `main` was never touched.
- Every commit in this round is prefixed `fix1:` (9 commits — see the list at the top of this
  report).
- `git status` reviewed before every commit: no `.env` files, no real `appsettings.json` (only the
  pre-existing, already-tracked `appsettings.Example.json` placeholder), no `bin/`, `obj/`,
  `node_modules/`, or `dist/` paths staged, no uploaded CSVs or database dumps.
- No `--force` flags, no `--no-verify`/skipped hooks, no workaround hacks. The one dependency
  installed for manual verification (Playwright) was `--no-save` and fully uninstalled afterward;
  `package.json`/`package-lock.json` are byte-identical to before this round.
