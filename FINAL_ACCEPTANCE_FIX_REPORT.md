# ForgeDB Final Acceptance Fix Report

Date: 2026-07-13

Branch: `feature/final-ui-integration`

Acceptance project: `59` (`Final Defect Acceptance 1783976650588`)

Successful deployment: `11` / `forgedb_project_59`

Controlled failed deployment: `12`

## Final result

| Case | Result | Evidence |
|---|---|---|
| TC-24 Relationship detection/acceptance | **PASS** | A real detected `orders.customer_id -> customers.customer_id` suggestion returned structured 409 while the target was non-key, with unchanged design revision/status/count. The UI marked it unavailable. After `customers.customer_id` became PK, the same suggestion was accepted through the browser. |
| TC-25 Manual relationships/duplicates | **PASS** | The real manual form created `shipments.customer_id -> customers.customer_id`. Duplicate create, duplicate suggestion acceptance, and update-into-duplicate were rejected without revision/count changes. |
| TC-26 ER pan | **PASS** | Mouse drag changed translation at 1440 px; touch `PointerEvent` drag changed translation at 390 px; zoom continued after pan; Reset View restored 100% and `(0,0)`; neither viewport had page-level horizontal overflow. |
| TC-27 Deployment success | **PASS** | Deployment 11 succeeded with `customers=3`, `orders=4`, `shipments=4`, total 11. Direct psql verified schema, types, identity/defaults, constraints, rows, NULLs, decimals, timestamps, and FK joins. |
| TC-28 Rollback after success | **PASS** | Deployment 12 intentionally failed with PostgreSQL 23503. It recorded zero created tables/rows and redacted details. Psql proved deployment 11's schema and all 11 rows remained unchanged/queryable. |
| TC-35 Complete workflow | **PASS** | One fresh real-browser session completed Register -> Login -> Create Project -> Import -> Analysis -> Cleaning -> Re-analysis -> Confirm Quality -> Generate/configure/validate Schema -> detected/manual Relationships -> ER Diagram -> successful and failed Deployment -> Dashboard. Browser health arrays were all zero. |

Required outcome summary:

- Invalid non-key relationship accepted: **No**
- Duplicate relationship persisted: **No**
- Manual relationship UI present: **Yes**
- ER pan works: **Yes**
- Nullable NUMERIC deployment works: **Yes**
- Successful deployment verified by psql: **Yes**
- Failed deployment rollback verified: **Yes**
- Previous successful deployment preserved: **Yes**

All six requested rerun cases passed. Final acceptance is complete.

## Root causes and fixes

### 1. Relationship target validation

The suggestion-accept path resolved persisted columns but did not validate the target's persisted PK/Unique flags before mutating the suggestion, relationship, revision, and validation state. Manual create/update had the same gap.

`DesignRelationshipRules` now centralizes persisted target-key, exact normalized PostgreSQL type, duplicate, and PostgreSQL unique-violation checks. Suggestion acceptance validates before any mutation and returns a clear structured 409. Manual create/update validate before mutation and return structured 400/409. Rejected mutations leave revision, status, and relationship count unchanged. The frontend distinguishes a real validation conflict from an `If-Match` conflict and displays the backend message honestly.

### 2. Missing manual relationship UI

The Relationships page only rendered detected suggestions; it did not load the persisted design or expose the existing relationship mutation API.

The page now loads persisted tables, columns, and relationships and includes source/target table and column controls, cardinality, On Delete, Create, and Cancel/Reset. It filters columns with table selection; marks PK/Unique targets; disables non-key, same-endpoint, and type-mismatched targets; catches incomplete/duplicate input; persists through the real API; refreshes shared design state; shows persisted edit/delete controls; and retains all controls in light/dark desktop/mobile layouts.

### 3. Exact duplicate relationships

There was no application-level exact-tuple guard and no database uniqueness boundary, so sequential and racing writes could persist identical relationships.

Create, suggestion accept, and update now reject an existing `(DesignModelId, FromColumnId, ToColumnId, Cardinality)` tuple. Database unique violations are translated to clean 409 responses. The frontend warns/disables duplicates and refreshes from the persisted model.

Migration `20260713204415_PreventDuplicateDesignRelationships` uses `ROW_NUMBER()` partitioned by the exact tuple, keeps the oldest canonical row, removes only redundant exact copies, and creates:

```text
UX_design_relationship_endpoint_cardinality
(DesignModelId, FromColumnId, ToColumnId, Cardinality)
```

It was applied locally. Psql showed it as the newest EF migration and confirmed the unique index. The migration test verifies it does not issue an unqualified delete or remove distinct valid relationships. `dotnet ef migrations has-pending-model-changes` reported no pending changes.

### 4. ER Diagram pan

The ER surface had only a scale transform. It had no translation state, pointer capture lifecycle, bounds clamping, drag/click separation, or touch gesture handling.

The existing diagram now combines `translate3d` and scale, uses element-scoped pointer capture for mouse/touch, clamps translation to the container, changes grab/grabbing cursors, suppresses selection after a drag, preserves zoom, and resets zoom/translation together. No global listeners are installed. Helper text and an accessible Reset View button remain available.

### 5. Nullable deployment parameter binding

The deployment repository mixed EF positional placeholders, raw CLR values, and explicitly typed null parameters. EF/Npgsql could generate colliding names and infer `DBNull` as text, causing PostgreSQL 42804 for nullable numeric/integer cells.

Every cell now receives an explicit `NpgsqlParameter` named by table/row/column coordinates (`p_t{table}_r{row}_c{column}`), so names cannot collide after schema renames or across rows/tables. Null values use `DBNull.Value` plus the `NpgsqlDbType` derived from the validated design SQL type. Non-null values use the same explicit type. Supported types are SMALLINT, INTEGER, BIGINT, NUMERIC/DECIMAL, REAL, DOUBLE PRECISION, BOOLEAN, VARCHAR/TEXT, DATE, TIMESTAMP, TIMESTAMPTZ, and UUID. TIMESTAMP preserves a timezone-less wall-clock value; TIMESTAMPTZ binds UTC. Values are never concatenated into SQL.

The existing transaction remains intact. A live PostgreSQL integration test additionally proves a successful schema/count commit, full rollback on a later FK failure, and survival of the prior committed schema.

## Automated validation

- `npm run build`: **PASS**. Production bundle generated. Existing non-failing initial-budget warning: 26.55 kB over the 1.00 MB budget.
- `npm test -- --watch=false`: **83/83 passed**, 9/9 test files.
- `dotnet build backend/ForgeDB.sln`: **PASS**, 0 warnings, 0 errors.
- `dotnet test backend/ForgeDB.sln`: **178/178 passed**, 0 skipped.
- `python -m pytest -q` from `python-analysis-service`: **14/14 passed**.
- Focused relationship/controller suite during integration repair: **17/17 passed**.
- Focused deployment/controller suite: **35/35 passed**.
- Live PostgreSQL repository rollback integration: **1/1 passed**.
- EF pending-model check: **PASS** (`No changes have been made to the model since the last migration.`).
- `git diff --check`: **PASS**.

The frontend regression coverage includes the manual form, table/column filtering, PK/Unique labels, non-key/type/duplicate blocking, real create refresh, structured conflicts, invalid suggestion disabling, mouse/touch pan, reset, pan+zoom, and 390 px controls. Backend coverage includes non-key/PK/Unique relationship cases, duplicate create/suggestion/update, unchanged revision/status, database-race translation, migration SQL, all requested parameter types, unique coordinate names, alternating NULL/non-NULL values, exact decimal/date/UUID/timestamp conversion, successful counts, failure rollback, and prior-success preservation.

## Browser evidence

Playwright used one fresh Chromium context against real Angular (`4200`), ASP.NET Core (`5000`), the existing Python service (`8002`), and Docker PostgreSQL (`5433`). Result JSON: `artifacts/final-defect-fixes/result.json`.

- `artifacts/final-defect-fixes/01-real-imports.png`
- `artifacts/final-defect-fixes/02-analysis.png`
- `artifacts/final-defect-fixes/03-cleaning-confirmed.png`
- `artifacts/final-defect-fixes/04-invalid-suggestion-unavailable.png`
- `artifacts/final-defect-fixes/05-manual-relationship-and-list.png`
- `artifacts/final-defect-fixes/06-er-pan-desktop.png`
- `artifacts/final-defect-fixes/07-er-pan-mobile-390.png`
- `artifacts/final-defect-fixes/08-deployment-success.png`
- `artifacts/final-defect-fixes/09-controlled-failure-history.png`
- `artifacts/final-defect-fixes/10-dashboard-complete.png`

Browser health for the passing session:

- Console errors: **0**
- Uncaught page errors: **0**
- Unexpected HTTP error responses: **0**
- Unexpected request failures: **0**
- Unexpected 5xx responses: **0**

## PostgreSQL evidence

Direct psql queries were run after controlled deployment 12 failed.

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name = 'forgedb_project_59';
```

Result: `forgedb_project_59` exists. Its tables are exactly `customers`, `orders`, and `shipments`.

`information_schema.columns` verified INTEGER identity, TEXT, VARCHAR(120), NUMERIC, DATE, TIMESTAMP, TIMESTAMPTZ, and UUID columns with the expected nullable flags/defaults. `customers.customer_id` reports `is_identity=YES`, `identity_generation=BY DEFAULT`. `pg_constraint` reports all three PKs, `customers.customer_code` UNIQUE, and both successful customer FKs.

```sql
SELECT (SELECT count(*) FROM forgedb_project_59.customers) AS customers,
       (SELECT count(*) FROM forgedb_project_59.orders) AS orders,
       (SELECT count(*) FROM forgedb_project_59.shipments) AS shipments;
```

Result: `3 | 4 | 4` after the failed replacement.

Customer row 2 has SQL NULL for `credit_limit NUMERIC`, `loyalty_points INTEGER`, `joined_on DATE`, and `last_seen TIMESTAMPTZ`. Customer row 3 preserves `credit_limit=99999.99`, `loyalty_points=42`, `joined_on=2024-03-05`, and `last_seen=2024-03-05 11:30:00+00`. Order row 2 has SQL NULL `amount`; later order values preserve `30.75` and `40.00`. The timezone-less order timestamp remains exactly `2024-04-01 08:00:00`. Shipment row 2 has SQL NULL `shipped_on`; later dates persist.

FK join counts are 4/4 orders and 4/4 shipments. Deployment records are:

| Id | Status | Total rows | Created tables/counts |
|---|---|---:|---|
| 11 | Succeeded | 11 | customers/orders/shipments; 3/4/4 |
| 12 | Failed | 0 | `[]` / `{}`; persisted redacted PostgreSQL 23503 FK detail |

The following integrity queries both returned zero:

```text
duplicate_relationship_groups = 0
invalid_fk_targets = 0
```

This proves the failed transaction's `DROP SCHEMA`/recreate/inserts rolled back and restored the earlier committed schema, constraints, values, and counts rather than leaving partial objects.

## Files modified or created

Backend relationship and migration:

- `backend/ForgeDB.API/Controllers/DesignController.cs`
- `backend/ForgeDB.API/Data/ForgeDbContext.cs`
- `backend/ForgeDB.API/Data/Migrations/20260713204415_PreventDuplicateDesignRelationships.cs`
- `backend/ForgeDB.API/Data/Migrations/20260713204415_PreventDuplicateDesignRelationships.Designer.cs`
- `backend/ForgeDB.API/Data/Migrations/ForgeDbContextModelSnapshot.cs`
- `backend/ForgeDB.API/Services/DesignService.cs`
- `backend/ForgeDB.API/Services/RelationshipDetectionService.cs`
- `backend/ForgeDB.API/Services/Exceptions/DesignRelationshipConflictException.cs`
- `backend/ForgeDB.API/Services/Validation/DesignRelationshipRules.cs`
- `backend/ForgeDB.API.Tests/Controllers/DesignControllerTests.cs`
- `backend/ForgeDB.API.Tests/Services/DesignRelationshipMutationTests.cs`
- `backend/ForgeDB.API.Tests/Services/RelationshipDetectionServiceAcceptTests.cs`
- `backend/ForgeDB.API.Tests/Services/RelationshipUniquenessMigrationTests.cs`

Frontend:

- `frontend/angular-app/src/app/pages/project-relationships/project-relationships.component.ts`
- `frontend/angular-app/src/app/pages/project-relationships/project-relationships.component.html`
- `frontend/angular-app/src/app/pages/project-relationships/project-relationships.component.spec.ts`
- `frontend/angular-app/src/app/pages/project-er-diagram/project-er-diagram.component.ts`
- `frontend/angular-app/src/app/pages/project-er-diagram/project-er-diagram.component.html`
- `frontend/angular-app/src/app/pages/project-er-diagram/project-er-diagram.component.spec.ts`

Deployment:

- `backend/ForgeDB.API/Repositories/DeploymentRepository.cs`
- `backend/ForgeDB.API/Services/DeploymentPlanBuilder.cs`
- `backend/ForgeDB.API.Tests/Services/DeploymentPlanBuilderTests.cs`
- `backend/ForgeDB.API.Tests/Services/DeploymentRepositoryPostgresTests.cs`

Report:

- `FINAL_ACCEPTANCE_FIX_REPORT.md`

## Commits

- `4a9c450` — `fix: validate and deduplicate relationships`
- `5281289` — `feat(frontend): add manual relationship editor and ER panning`
- `420a0a5` — `fix: bind typed nullable deployment parameters`

No push, merge, reset, stash, rebase, or branch switch was performed. Acceptance fixtures, browser scripts, logs, JSON, and screenshots remain ignored under `artifacts/final-defect-fixes/`. The pre-existing untracked `FINAL_ACCEPTANCE_TEST_REPORT.md` was preserved and not committed.
