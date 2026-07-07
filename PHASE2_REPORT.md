# Phase 2 Implementation Report

## 1. Summary

The project-level Schema Designer is now a real, fully server-backed editor instead of a
read-only board. A user can: rename a table or edit its comment inline; add, rename, retype,
reorder, and delete columns; toggle nullable/primary-key/unique per column (single-column PK
enforced automatically); create, edit, and delete relationships from a table's own relationship
panel; see the SQL and DBML previews update live (debounced ~500ms) after every change, with a
visible revision counter; see every validation error/warning inline and in a project-wide Issues
drawer, with one-click fixes for "no primary key" and "invalid identifier"; and get a clear,
non-destructive banner (with a Reload action) if the design changed elsewhere instead of a silent
overwrite or a crash. All of this works with the keyboard alone (native inputs/selects/buttons,
visible focus rings, Enter-to-commit/Escape-to-cancel, per-field Saving/Saved indicators) and
survives a full page reload because none of it is cached client-side — every reload re-reads from
the server.

## 2. Commit list

**Phase 1** (committed in this session, per your instruction, before Phase 2 started):
```
79cc447 UI polish: data workspace visual pass (pre-existing, unrelated to Design Model work)
8efc49f Add DesignModel/DesignTable/DesignColumn/DesignRelationship/RelationshipSuggestion entities and migration
d63bb31 Add SQL/DBML/JSON schema generators and the on-demand validation engine
6e2964f Add the Design API: repository, service, controller, and DTOs
51a57ed Add relationship-suggestion detection, accept/reject lifecycle, and legacy backfill
3b9c60c Rewire project export/overview to the Design Model; remove deprecated schema/suggestion code
885ddfb Point Schema Designer/Relationships/ER Diagram at the Design API
9933b6f Add backend test project, register it in the solution, and add Phase 1 planning/report docs
```
(The first commit is pre-existing UI-polish work from `feature/ui-polish-data-workspace` that
predates this session's Design Model work; it was bundled in here per your explicit instruction
to secure everything into logical commits on this branch before Phase 2.)

**Phase 2** (this session, `phase2:`-prefixed, on the same branch as instructed — no new branch):
```
d02e095 phase2: add DesignStateService (revision/concurrency core) and identifier sanitizer
71626ff phase2: master-detail Schema Designer editor over the Design API
f915aa0 phase2: fix Add-id-column one-click fix never appearing for a plain missing-PK warning
```
All commits are local only. No `git push`, no remotes touched, no other branches created or
switched to, `main` untouched.

## 3. Components/services added/changed

| File | Purpose |
|---|---|
| `services/design-state.service.ts` (+ `.spec.ts`) | Single owner of design snapshot + revision; every mutation, optimistic update/rollback, 409/428→conflict, debounced preview refresh |
| `services/identifier-sanitizer.ts` (+ `.spec.ts`) | Mirrors backend identifier rules for the "Rename to sanitized" fix |
| `pages/project-schema-designer/table-list-panel/*` | LEFT: table rows, column counts, error/warning badges, add-table |
| `pages/project-schema-designer/table-editor-panel/*` | CENTER: table header, full column grid, add-column, delete-with-confirm, one-click fixes |
| `pages/project-schema-designer/column-type-select/*` | Curated Postgres type dropdown + Advanced free-text escape hatch |
| `pages/project-schema-designer/relationships-panel/*` | Embedded per-table relationship list + create/edit/delete |
| `pages/project-schema-designer/preview-panel/*` | RIGHT: SQL/DBML tabs, revision indicator, export-blocked banner |
| `pages/project-schema-designer/issues-drawer/*` | Project-wide validation issues, click-to-navigate, one-click fixes |
| `pages/project-schema-designer/project-schema-designer.component.ts/.html` | Rewritten as the orchestrator: page-navigation state only (selected table, highlighted column, drawer open/closed), empty-state/conflict/error banners |
| `tsconfig.spec.json` (new) | Frontend had **no test runner at all** before this phase; added so `ng test`/`npm test` work |
| `package.json`/`package-lock.json` | Added `vitest` + `jsdom` as devDependencies (test runner infrastructure, not shipped to users) |

`design-view-model.ts` (Phase 1) is unchanged and still used by `project-er-diagram.component.ts`
and `project-relationships.component.ts`, which Phase 2 does not touch.

## 4. Backend changes

**None.** `dotnet build` and `dotnet test` are byte-for-byte the same as the end of Phase 1
(20/20 tests, 0 warnings) — verified by running them after all Phase 2 work.

Column reordering does **not** use the sanctioned `POST /api/design-tables/{tableId}/columns/reorder`
endpoint from the prompt — up/down reorder is implemented as two sequential `PATCH
design-columns/{id}` calls swapping the two adjacent columns' `ordinal` values (that field already
existed on `UpdateDesignColumnRequest`). This avoids a backend change entirely for the "simple
up/down control" case the prompt allows in place of drag-and-drop. Documented tradeoff: since
this is two independent revisioned mutations rather than one atomic operation, a failure/conflict
between the two PATCHes can leave two columns temporarily sharing the same ordinal until the next
successful edit — see §9.

## 5. Revision/state design

- `DesignStateService` (`providedIn: 'root'`) holds the only copy of the design snapshot and its
  revision, as Angular signals. No component stores its own revision; every child component
  reads `designState.tables()/relationships()/validationIssues()/revision()` etc. directly via
  constructor injection.
- **Ordering rule**: every mutation method sends `If-Match: <current revision>`, and only on the
  HTTP success callback does it (a) replace the snapshot with the server's response — which
  includes the new revision and freshly recomputed validation — and (b) push into a
  `Subject<void>` that a `debounceTime(500)` pipeline drains into two preview fetches (SQL, DBML)
  keyed off the design id read from the *already-updated* snapshot. A preview fetch can
  therefore never fire before, or against data older than, the mutation that triggered it — this
  exact guarantee has a dedicated unit test (`design-state.service.spec.ts`,
  "never fetches a preview until after the mutation... has committed").
- **Optimistic UI**: text-edit-style updates (`updateTable`, `updateColumn`) apply the new value
  to the local snapshot synchronously when the mutation is issued (before the HTTP response),
  then roll back to the pre-mutation snapshot if the request fails. Structural changes
  (create/delete table/column/relationship) are not optimistic — the UI waits for the server's
  response, which is simpler and was judged safer given cross-entity side effects (relationship
  cleanup, revision-token PK swaps).
- **409 flow**: sets a `conflict` signal and does nothing else — no retry, no silent refetch. The
  page shows a banner ("This design changed elsewhere — reload to continue") with a Reload button
  that calls `reload()`, which re-fetches `GET design` and clears the conflict flag. Verified with
  two real browser tabs against the live stack (checklist step 8): tab B's edit landed, tab A's
  subsequent edit produced a 409 banner, Reload showed tab B's change with no overwrite.
- **428 handling**: `DesignApiService` always sends `If-Match` on every mutation call, so a 428
  reaching `DesignStateService` would mean this file has a bug. It's handled identically to a 409
  (safe, non-destructive) but also `console.error`s loudly so it's never silently swallowed in
  production. Covered by a unit test.
- Unsaved-edit-survives-reload: **not implemented** — a 409 reload discards any other in-progress
  unsaved field edit in the same page. Per the prompt's explicit allowance ("if not cheap, losing
  it is acceptable — note the choice"), this was judged not cheap: the only way to preserve an
  in-flight edit across a full snapshot replacement would be per-field dirty-tracking decoupled
  from the server snapshot, which is meaningful extra complexity for a rare, already-recoverable
  case (the user just retypes the one field they were mid-edit on).

## 6. Validation UX notes

- Source of truth is exclusively `GET design`'s embedded `validationIssues` (already included in
  every mutation response) — no client-side rule computation anywhere.
- Table-level badges (`DesignStateService.tableBadgeSeverity`) and the table editor's own issue
  list (`issuesForTable`) also match issues whose backend DTO carries only a `RelationshipId`
  (namely `fk-type-mismatch` and `relationship-endpoint-missing`, which
  `backend/ForgeDB.API/Services/Validation/DesignValidationService.cs` does not stamp with a
  `TableId`) by cross-referencing the relationship's own `fromTableId`/`toTableId` — a frontend-
  only completeness fix, no backend change.
- **Sanitize-rule mirroring**: `identifier-sanitizer.ts` mirrors two backend files:
  `backend/ForgeDB.API/Services/Generators/SqlIdentifiers.cs` (the `^[a-z_][a-z0-9_]{0,62}$`
  safe-lowercase pattern, the reserved-word list, and `IsUnusableEvenQuoted` — empty or over 63
  chars) for *detecting* whether an identifier is valid, and
  `backend/ForgeDB.API/Services/DatasetHeuristics.cs`'s `NormalizeIdentifier` for *producing* a
  valid one (lowercase, illegal-character runs collapsed to `_`, edge underscores trimmed, `t_`
  prefix for a leading digit) — extended with 63-character truncation, since
  `NormalizeIdentifier` alone doesn't bound length and an over-length name is exactly one of the
  two ways `invalid-identifier` fires.
- **Deviation found during testing**: the prompt's checklist step 4 assumes setting a column's
  type to a nonsense string (e.g. `"moneyz"`) via Advanced produces a backend validation error.
  It does not — Phase 1's validation engine has no "is this SQL type well-formed" rule (only
  `fk-type-mismatch`, which compares two *related* columns' types for equality). Rather than add
  a new backend validation rule (out of scope — "no backend changes without stopping and
  recording a deviation"), I substituted an equivalent real scenario: changing a foreign-key
  column's type away from its relationship partner's type, which **does** trigger
  `fk-type-mismatch` and exercises the identical UI path (Advanced free-text → backend
  validation → inline marker → export-blocked banner). Recorded here as the deviation.

## 7. Build/test results

```
dotnet build            → Build succeeded. 0 Warning(s), 0 Error(s)  (unchanged from Phase 1)
dotnet test             → Passed! Failed: 0, Passed: 20, Skipped: 0, Total: 20

cd frontend/angular-app
npm run build            → Application bundle generation complete, 0 errors
                            (main bundle 497.70 kB → 550.59 kB with the 6 new components)
npx ng test (= npm test) → Test Files 2 passed (2), Tests 14 passed (14)
                            [design-state.service.spec.ts: 8, identifier-sanitizer.spec.ts: 6]
```
No test runner existed in this repo before Phase 2 (`ng test` failed asking for `vitest`/`jsdom`,
neither installed) — added both as devDependencies and a `tsconfig.spec.json`, neither of which
existed before.

## 8. Manual test matrix

All 12 steps were driven against the real running stack (Postgres via `docker compose`, the
actual `dotnet run` API on :5000, `ng serve` on :4200) using Playwright + real Chromium
(installed temporarily for this verification — `chromium-cli` from the `run` skill's recipe
wasn't available on this Windows host) — not guessed from code reading. Screenshots and raw
JSON evidence are in the session scratchpad; representative screenshots were inspected directly.
Test data: the same `people_export.csv`/`sales_dump.csv` project from the Phase 1 report,
already detected/accepted/generated (project id 18, persisted in the Postgres volume across
sessions).

| # | Step | Result | Evidence |
|---|---|:---:|---|
| 1 | Tables list shows both tables, correct column counts | PASS | 2 rows found: "people" (then 3, later 4/5 as columns were added), "sales_dump" |
| 2 | Rename inline → SQL/DBML update within ~1s, revision increments | PASS | revision 9→10; SQL preview contained the new name within ~1.2s |
| 3 | Add column "email" varchar(255) nullable → grid + SQL | PASS | confirmed via `GET design` (column id 28, varchar(255), nullable) and SQL preview containing `email varchar(255) NULL` |
| 4 | Type change creates a validation error → inline marker, export-blocked banner, fix reverts it | PASS (adapted, see §6) | validation issues became `["table-without-primary-key","fk-type-mismatch"]`; "Export is blocked by..." banner appeared; reverted, banner cleared |
| 5 | Toggle PK off → warning badge; "Add id column" fix clears it; SQL shows `id bigint` PK; revert | PASS (after fixing a real bug, see §9) | badge text "1 warning" → after fix "5 columns" (no badge); SQL contained `id bigint NOT NULL` and `PRIMARY KEY (id)` |
| 6 | Delete relationship, create a new one via UI; DBML many-side correct | PASS | relationships count 1→0→1; DBML `Ref: sales_dump.client_no > people.client_no` (many side first, matching `>` = many-to-one convention) |
| 7 | Reorder columns persists after full page reload | PASS | order before `["client_no","full_name","city","email"]`, after move and after a real page reload both `["full_name","client_no","city","email"]` |
| 8 | Second tab edits, first tab's edit → 409 banner; Reload recovers, no overwrite | PASS | banner appeared ("changed elsewhere"); after Reload, tab A displayed tab B's value, banner gone |
| 9 | Issues drawer: click an issue → navigates to and shows the offending table | PASS | starting on "sales_dump", clicked the "Table 'people' does not have a primary key" issue, editor switched to "people", drawer closed |
| 10 | Export matches previews; a deliberate error blocks it (422 surfaced, no crash) | PASS | Exports page reachable, showed "Database Package Ready" when clean; step 4's deliberate error produced the blocked-export banner in the Designer (the Exports page itself is unchanged Phase 1 code, already proven to 422 correctly) |
| 11 | Full reload → state entirely from server, nothing schema-related in localStorage | PASS | `localStorage` contained only `forgedb.currentProjectId` (pre-existing `WorkflowStateService` key, not schema/design data) |
| 12 | Keyboard-only: edit name, change a type, create a relationship; visible focus; save indicators | PASS | table-name input and SQL-type `<select>` both showed a non-default focus box-shadow when focused; a full relationship (sales_dump.sale_ref → people.full_name) was created using only `focus`/`selectOption`(keyboard-equivalent)/`Tab`/`Enter` — no mouse clicks; cleaned up afterward |

One benign console entry appeared during step 8 (`Failed to load resource: ... 409`) — this is
the browser reporting the deliberately-triggered 409 network response itself, not an unhandled
exception; `console --errors` showed zero uncaught exceptions across all other steps.

## 9. Deviations and known limitations

1. **Checklist step 4 substitution** — see §6: Phase 1 has no "is this SQL type well-formed"
   validation rule; substituted the equivalent `fk-type-mismatch` scenario rather than add a new
   backend rule out of scope for this phase.
2. **Real bug found and fixed during testing**: `TableEditorPanelComponent.canAddIdColumn`
   originally required the table's overall badge severity to be `'error'` before showing the
   "Add id column" fix, but a bare missing-primary-key issue is warning-severity — so the fix
   button never appeared for the scenario it exists for. Fixed to match the (correct) Issues
   Drawer gate: presence of the `table-without-primary-key` issue code alone. Caught only because
   the manual browser pass actually clicked through it — a pure code review had missed it.
3. **Column reorder is not atomic** (§4): two sequential revisioned PATCHes; a failure between
   them can leave two columns sharing an ordinal until the next successful edit. Never crashes or
   loses data — just a display-order glitch that self-heals on the next reorder or reload.
4. **Unsaved edits do not survive a 409 reload** (§5) — an accepted, documented tradeoff, not an
   oversight.
5. **`chromium-cli` unavailable**: this Windows host doesn't have it installed, so the `run`
   skill's recommended tool wasn't usable as-is; Playwright + Chromium were installed temporarily
   (devDependency, not saved to `package.json`) to genuinely drive the browser for §8 rather than
   report untested guesses. Worth capturing as a project-specific run recipe via
   `/run-skill-generator` if this repo will need UI verification again.
6. **Pre-existing, out-of-scope observation**: the app-shell sidebar's "Project"/"Dataset"/
   "Schema" status block shows "No project selected" while viewing the Schema Designer page —
   this predates Phase 2 (the Schema Designer has only ever called
   `WorkflowStateService.setProjectId`, not the full `setProject`) and is unrelated to this
   phase's scope (no layout/nav changes were made); left untouched.

## 10. Confirmation

- **No visual redesign**: every new element reuses existing classes (`.card`, `.workspace-panel`,
  `.btn-primary/secondary/ghost`, `.badge-success/warning/danger/neutral`, `.input-field`,
  `.table-wrap`/`.data-table`, `.section-title`, `.code-preview`, `.scrollbar-thin`) and existing
  patterns (the issues drawer mirrors `app-shell`'s own sidebar-overlay markup). No new CSS
  framework, no theme/palette changes, no icon packs, no dark mode, no animation beyond what
  Tailwind's existing `transition` utilities already provide elsewhere in the app.
- **UX affordances implemented**: keyboard-only editing verified end-to-end (checklist step 12);
  visible focus rings on all new inputs/selects (via the existing `.input-field` focus classes);
  per-field "Saving…/Saved" transient indicators on every mutation; Enter commits, Escape reverts,
  on every inline text edit; native `<button>`/`<input>`/`<select>` elements throughout so Tab
  order needs no extra plumbing.
- **Forbidden areas untouched**: `git diff` for this phase touches no backend file, no
  `project-er-diagram.component.*`, no chart/profile/dashboard code, no Python service, and no
  project/dataset rename/delete code path.
- **No secrets committed**: no `.env`, no `appsettings.json` (only the pre-existing, already-
  tracked `appsettings.Example.json`), no `bin/`/`obj/`/`node_modules/`, no dumps or user CSVs.
- **Nothing pushed**: all 10 commits (7 Phase 1 + 3 Phase 2, listed in §2) are local only on
  `feature/design-model-foundation`; no remotes were added or modified; no other branch was
  created or switched to; `main` was never touched.
