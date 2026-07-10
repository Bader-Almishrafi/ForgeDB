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

## FIX2 — final hygiene items from the delta review

A small, surgical follow-up round addressing exactly the delta review's Required Fixes. Same
branch, local only, every commit prefixed `fix2:`. Nothing outside these items was touched.

### 1. Removed the three legacy redirect stubs

`app.routes.ts:27-29` (`app/schema-review`, `app/relationships`, `app/deployment` → `redirectTo:
'projects'`) deleted. These referenced no component even before this round (Fix Round 1 had
already deleted the pages they used to point to); they served no purpose.

Acceptance grep, entire frontend (`ts`, `html`, spec files included — `*.ts` glob covers
`*.spec.ts`), re-run after the deletion:

```
$ grep -rnE "app/schema-review|app/relationships|app/deployment" frontend/angular-app/src --include="*.ts"
(no matches)
$ grep -rnE "app/schema-review|app/relationships|app/deployment" frontend/angular-app/src --include="*.html"
(no matches)
$ grep -rnE "schema-review|app/relationships|app/deployment" frontend/angular-app/src
(no matches)
```

Zero references remain anywhere. `npm run build` and `npm test` were re-run immediately after
this change and stayed green (see §4 below for final numbers).

### 2. FIX2 corrections — accuracy fixes to prior reports

**`PHASE1_REPORT.md`** (lines 116-120 at the time): the endpoint table still showed `accept` with
no `If-Match` and the prose beneath it ("Every mutating endpoint: missing `If-Match` → 428...")
implied a uniform rule with no exemptions — both stale since Fix Round 1's FIX 3 added the
If-Match/concurrency contract to `accept`. Replaced with the precise current contract: every
DesignModel-mutating endpoint requires `If-Match`; `generate` is exempt only pre-first-creation;
`reject` is deliberately exempt because it never touches the design. (Committed separately as
`d721df7`, before this section was written.)

**`FIX1_REPORT.md`** (this file) — the delta review found two factual errors in the original text
above, which are left as originally written (not silently edited) per the instruction to correct
by addition, not by rewriting history:

1. **§3, item 3's grep ("Removed route paths") reported only one remaining redirect-stub hit**
   (`app/schema-review`) and concluded "everything else is zero hits, as required." That
   conclusion was wrong. The grep pattern used there —
   `"workspace'|/workspace|schema-review|datasets/:datasetId/schema|schemas/:schemaId"` — never
   contained the literal strings `relationships` or `deployment`, so it could not have found the
   other two stubs even though they were present in the file at the time
   (`app.routes.ts:28-29`). **Three legacy redirect stubs existed, not one.** All three are
   removed as of this round's item 1 above.
2. **The commit list at the top of this report shows 9 `fix1:` commits**, ending at `574f962`. It
   omits `a4b7db6` ("fix1: add Fix Round 1 implementation report") — the commit that added this
   very file, which by construction could not list its own not-yet-created hash at the time it was
   written. **The correct total is 10 `fix1:` commits.** (This report applies the same reasoning to
   its own commit list in §5 below, so as not to repeat the mistake.)

### 3. Real-browser check: below-the-fold relationship delete/recreate

**Setup.** No seeded/documented login exists anywhere in this repo (checked for a `DbSeeder`,
`HasData`, startup seeding, and every root `*.md` — confirmed zero hits beyond
`SETUP_GUIDE.md`'s manual Postman walkthrough, which requires self-registration first). The
project used throughout Phase 1/2/Fix Round 1's own manual testing ("Phase1 Manual Test", id 18)
belongs to a test account whose password was never recorded anywhere retrievable. Rather than
reset another account's credentials in the DB to reuse that exact project — invasive and
disproportionate for a UI-reachability check — a fresh throwaway account was registered
(`fix2.tester@example.com`, user id 16) and a new project built (id 22) reproducing the identical
"sales/people" fixture shape used throughout this codebase's manual testing: a `people` dataset
(10 columns) and a `sales` dataset (10 columns, `client_no` foreign key), uploaded via
`POST .../datasets/upload` and turned into a design via `POST .../design/generate`, then one
`sales.client_no → people.client_no` relationship added via the Design API. This gives the `sales`
table 10 columns + 1 relationship — enough to push the relationships panel well below the fold.

**Browser.** Playwright (same tool as Fix Round 1: reinstalled with `npm install --no-save
playwright`, fully uninstalled again afterward — see §4) launched a **real, non-headless**
Chromium window (`headless: false`) at a 1280×720 viewport. Login was performed by seeding the
app's own `forgedb.token`/`forgedb.user` `localStorage` keys with a token obtained from the real
`/api/auth/register` call above (the exact state a normal login produces), then navigating to
`/projects/22/schema-designer` and selecting the `sales` table.

**Findings:**
- Before scrolling, the relationship row's Delete button had bounding-box `y=1901` against the
  720px-tall viewport — genuinely below the fold, confirming this was a real test of the reviewer's
  concern rather than a no-op.
- `scrollIntoViewIfNeeded()` (Playwright's standard scroll-to-element call, equivalent to a user
  scrolling the panel's own `overflow-y-auto` container with a mouse wheel) brought the button
  fully into view (`y=340`, inside the 720px viewport). **The row is reachable via ordinary
  scrolling — no scroll-container bug.**
- Clicking Delete triggered the app's real `window.confirm('Delete this relationship?')` dialog
  (auto-accepted, matching normal user behavior). `DELETE /api/design-relationships/14 → 200`
  fired; the header badge went `1 relationships` → `0 relationships`; the panel showed "No
  relationships involve this table yet."; both `GET .../preview?format=sql` and `format=dbml`
  were re-fetched immediately after (previews update).
- Recreating via the same panel's "Create relationship" form fired `POST
  /api/designs/6/relationships → 200`; the badge returned to `1 relationships` and the row
  reappeared (new id).
- Revision confirmed directly afterward via `GET /api/projects/22/design`: **revision 4** (1 =
  fresh generate, 2 = initial relationship create, 3 = delete, 4 = recreate) — each mutation
  incremented it by exactly 1, and both in-browser requests succeeded with 200 rather than 409,
  which is only possible if `DesignStateService` correctly tracked and sent the live revision as
  `If-Match` through the delete and the immediately-following recreate.
- **Incidentally noticed, deliberately not touched:** the Delete button's keyboard-focus
  `box-shadow` computed to `none` (no visible focus ring). This is outside this item's scope — the
  prompt's own branching is "if the button works normally: record PASS, done," and it does work
  normally via the mouse+scroll interaction this item asked about. Recorded here only for
  transparency; keyboard-focus visibility across the app was already exercised separately by Phase
  2 checklist step 12 and Fix Round 1's F-series matrix.

**Result: PASS.** The row was reachable and clickable at the tested viewport; delete,
preview-refresh, revision-increment, and recreate all worked correctly. No product code change was
needed or made for this item.

**Cleanup:** the throwaway Playwright driver script and its screenshots were written outside any
tracked path awareness (`frontend/angular-app/fix2_relationship_check.tmp.js` + 3 `.png` files) and
deleted immediately after use; `git status` was empty before every commit in this round. `playwright`
was uninstalled again (`npm uninstall playwright`); `package.json`/`package-lock.json` are
byte-identical to before this round (empty `git diff`). The throwaway account/project/datasets
(user id 16, project id 22) remain in the local dev Postgres volume — consistent with this
repo's existing practice across Phase 1/2 and Fix Round 1 of never cleaning up local-only test
fixtures (15 test users and 21 test projects already existed before this round from prior
sessions; none of those were cleaned up either, and this round follows the same precedent).

### 4. Verification

| Check | Result |
|---|---|
| `npm run build` (`ng build`, after item 1's route removal) | Clean, `Application bundle generation complete` |
| `npm test` (`ng test --watch=false`, after item 1's route removal) | **18/18 passed** (2 test files) |
| `dotnet test -c Release` (`backend/ForgeDB.sln`, nothing else running) | **32/32 passed** |
| `npm run build` (final re-check) | Clean |
| `npm test` (final re-check) | **18/18 passed** |

Backend/frontend dev servers started for the §3 browser check (`dotnet run` on :5000, `ng serve`
on :4200) were both stopped (`Stop-Process`) before the `dotnet test -c Release` run above, per
the file-lock lesson from Fix Round 1 §1.

### 5. Commit list

```
4a6e714 fix2: remove the three legacy redirect stubs from app.routes.ts
d721df7 fix2: correct stale accept If-Match claim and overstated contract in PHASE1_REPORT.md
```

Plus the one commit that adds this section itself (necessarily not listed here by its own hash,
for the same structural reason `a4b7db6` couldn't list itself in its own commit list — see item
2's second correction above). That commit's message begins `fix2: add Fix Round 2 report section`.

### 6. Confirmation

- All work is on `feature/design-model-foundation`, local only. Nothing was pushed; `git remote
  -v` was not touched.
- No other branch was created or switched to; `main` was never touched.
- Every commit in this round is prefixed `fix2:`.
- `git status` was empty (beyond the intended edit) before every commit; no `.env`, no real
  `appsettings.json`, no `bin/`/`obj/`/`node_modules/`/`dist/` paths staged, no uploaded CSVs or
  DB dumps committed (the two test CSVs used in §3 live only in the session scratchpad and in the
  local dev Postgres volume, never in the repo).
- No files outside this round's scope (the redirect stubs, the two report corrections, and the
  verification runs) were touched. No `--force`, no skipped hooks, no workaround hacks.
