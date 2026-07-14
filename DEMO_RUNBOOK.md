# ForgeDB Demo Runbook

This is the stable 10–12 minute presentation path. Use a fresh browser session and a new email such as `presenter.<timestamp>@example.com`.

## Before presenting

Confirm these checks:

```text
http://localhost:4200/login        → Angular login
http://localhost:5000/health       → healthy, database connected
http://localhost:8002/health       → healthy
PostgreSQL forgedb-postgres        → accepting connections
```

Use these ignored fixtures:

```text
artifacts/demo-readiness/fixtures/customers.csv
artifacts/demo-readiness/fixtures/orders.csv
artifacts/demo-readiness/fixtures/shipments.csv
```

Optional import examples are `demo-import.xlsx` and the local JSON fixture server on `http://127.0.0.1:8766`.

## Presentation sequence

1. Register and create a project named **ForgeDB Presentation**.

2. Import the three CSVs from Data Sources. Show the raw counts:

   - customers: 4 rows, 4 columns
   - orders: 3 rows, 5 columns
   - shipments: 3 rows, 5 columns

3. Open Analysis and click **Run Project Analysis**. Point out:

   - one exact duplicate customer;
   - whitespace in `customer_name`;
   - missing `orders.amount` and `shipments.shipped_on`;
   - inferred integer, numeric, and date columns.

4. Open Data Cleaning and preview/apply these five operations:

   - customers `customer_name`: Trim/Collapse whitespace;
   - customers duplicate: Keep first;
   - orders `amount`: fill with `0`;
   - orders `status`: Title Case;
   - shipments `shipped_on`: custom value `2026-07-03`.

   Show that Preview is non-mutating, then apply. Briefly open History to show versioning. Re-run analysis and click **Confirm Quality**. Final counts must be 3 customers, 3 orders, and 3 shipments.

5. Generate the schema and configure it exactly:

   - customers: `customer_id INTEGER PK NOT NULL`; `customer_name VARCHAR(120) NOT NULL`; `email VARCHAR(180) UNIQUE NOT NULL`; `city VARCHAR(80) NULL`.
   - orders: `order_id INTEGER PK NOT NULL`; `customer_id INTEGER NOT NULL`; `order_date DATE NOT NULL`; `amount NUMERIC NOT NULL`; `status VARCHAR(30) NOT NULL`.
   - shipments: `shipment_id INTEGER PK NOT NULL`; `order_id INTEGER NOT NULL`; `shipped_on DATE NOT NULL`; `carrier VARCHAR(80) NOT NULL`; `cost NUMERIC NOT NULL`.

   Click **Save Draft**, refresh the browser to show persistence, click **Validate Schema**, then open **SQL Preview** and **Verify with Backend**.

6. Open Relationships and click **Detect Relationships**.

   - If `orders.customer_id → customers.customer_id` is available, accept it.
   - If the equal-sized fixtures produce the reverse unavailable suggestion, reject that card and use **Create Relationship** for `orders.customer_id → customers.customer_id`, many-to-one, no-action.
   - Create `shipments.order_id → orders.order_id`, many-to-one, no-action.

   Confirm exactly two persisted relationships, then revalidate the schema if prompted.

7. Open ER Diagram. Show all three tables, PK/FK badges, both links, zoom, pan, and Reset View. A 390 px viewport also supports touch pan without page overflow.

8. Open Deployment. Confirm the design is Valid, click **Deploy to PostgreSQL**, and approve **Deploy Now**. The success card must show:

   - customers: 3
   - orders: 3
   - shipments: 3
   - total: 9

9. Optionally prove the real database in a terminal, replacing the schema name with the success card value:

```sql
SELECT 'customers' AS table_name, count(*) FROM <schema>.customers
UNION ALL SELECT 'orders', count(*) FROM <schema>.orders
UNION ALL SELECT 'shipments', count(*) FROM <schema>.shipments;
```

10. Finish with Dashboard and Exports:

   - show 3 rows and zero missing/duplicates on each cleaned dashboard;
   - show a numeric summary, top values, and a chart recommendation;
   - open Exports, preview SQL/DBML/JSON, copy SQL, and download an artifact.

## Presenter checkpoints

- Do not run the rollback test during the presentation; it is already covered in the readiness report.
- If relationship detection chooses the reverse direction, use the documented manual fallback instead of changing schema constraints for the audience.
- If a step is disabled, follow the page's prerequisite message: cleaning quality must be confirmed before schema generation, and schema must be valid before deployment.
- Expected final state: three datasets, three cleaned rows each, two foreign keys, Valid schema, and one successful nine-row PostgreSQL deployment.
