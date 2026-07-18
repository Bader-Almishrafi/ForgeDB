# ForgeDB — دليل جلسة Project Deployment to PostgreSQL الكامل

> **الجلسة رقم 09 — Deployment to PostgreSQL**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم آخر مرحلة في ForgeDB: التحقق من التصميم والنسخ المنظفة، بناء خطة النشر وملفات SQL، إنشاء Schema مستقلة داخل PostgreSQL، إدخال البيانات، إنشاء العلاقات، تنفيذ كل شيء داخل Transaction، وحفظ سجل النجاح أو الفشل.

---

## ملاحظة عن ترتيب Workflow

بعد إخفاء صفحة **ER Diagram** من المستخدم، أصبح الترتيب العملي:

```text
Projects
→ Data Sources
→ Analysis
→ Data Cleaning
→ Schema Designer
→ Relationships
→ Exports
→ Deployment
```

Deployment هي آخر مرحلة تنفيذية في المشروع الحالي.

---

## طريقة استخدام الدليل

- هذا الملف هو شرح الجلسة كاملًا، والشات للأسئلة.
- **سبق في الجلسات السابقة:** سأذكر المفهوم ثم أوضح استخدامه هنا.
- **مفهوم جديد:** يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة.

---

# المحتويات

1. الصورة العامة  
2. الفرق بين Export وDeployment  
3. أين يتم النشر فعليًا؟  
4. الـSchema الخاصة بكل Project  
5. الملفات والطبقات  
6. الصفحة والمسار  
7. ProjectDeploymentComponent  
8. تحميل Workspace  
9. شروط canDeploy في الواجهة  
10. شروط النشر الحقيقية في الباك إند  
11. نافذة التأكيد  
12. If-Match وDesign Revision  
13. DeploymentController  
14. DeploymentService  
15. سجل Running قبل التنفيذ  
16. Design validation  
17. Schema Ready والجودة المؤكدة  
18. Finalized cleaned versions  
19. منع نشر Raw Data  
20. Dataset-to-Table Mapping  
21. Column Mapping  
22. User-created Tables and Columns  
23. TableInsertPlan  
24. ترتيب الجداول للإدخال  
25. Circular Relationships  
26. تحويل القيم إلى PostgreSQL Types  
27. Null وEmpty String  
28. Npgsql Parameters  
29. لماذا Runtime Inserts Parameterized؟  
30. ملفات SQL القابلة للتنزيل  
31. schema.sql  
32. seed.sql  
33. deploy.sql  
34. الفرق بين Runtime Execution وDownloaded SQL  
35. Insert batching  
36. تأجيل Foreign Keys  
37. Identity Sequences  
38. DeploymentRepository  
39. Transaction الكاملة  
40. DROP SCHEMA CASCADE  
41. search_path  
42. النجاح  
43. الفشل وRollback  
44. Cancellation  
45. Deployment Entity  
46. Deployment History  
47. Latest Deployment  
48. تنزيل ملفات Deployment  
49. Frontend Download Flow  
50. Generated SQL Preview  
51. DeploymentResponseDto  
52. Status values  
53. Security and ownership  
54. الأخطاء وHTTP Codes  
55. المسارات الكاملة  
56. الاختبار العملي  
57. ملخص الحفظ  
58. تحسينات مؤجلة

---

# 1. الصورة العامة

Deployment تأخذ:

```text
Validated database design
+
Confirmed cleaned dataset versions
```

وتنشئ منها قاعدة فعلية داخل PostgreSQL:

```text
Dedicated project schema
├── Tables
├── Columns
├── Primary keys
├── Unique constraints
├── Defaults
├── Identity columns
├── Cleaned rows
├── Foreign keys
└── Indexes
```

المسار العام:

```text
User confirms deployment
→ POST deployment with design revision
→ verify ownership
→ verify current revision
→ verify design is Valid
→ verify quality is confirmed
→ verify exact cleaned versions
→ build insert plans
→ generate SQL artifacts
→ save Deployment as Running
→ begin PostgreSQL transaction
→ drop/recreate project schema
→ create tables
→ insert cleaned rows
→ reset identity sequences
→ add foreign keys
→ commit
→ mark Deployment Completed
```

إذا فشلت أي خطوة:

```text
Rollback whole transaction
→ no partial tables or rows remain
→ mark Deployment Failed
```

---

# 2. الفرق بين Export وDeployment

> **سبق في جلسة Exports.**

## Export

```text
Generate text files
→ preview
→ copy
→ download
```

لا تنفذ SQL ولا تغير Database.

## Deployment

```text
Generate plan
→ execute DDL and INSERT statements
→ change PostgreSQL
→ save execution result
```

Deployment عملية حقيقية ومؤثرة.

## مقارنة

| Export | Deployment |
|---|---|
| Read-only generation | Database mutation |
| لا يحتاج Transaction تنفيذ | ينفذ داخل Transaction |
| لا يحذف Schema | يسقط ويعيد إنشاء Project schema |
| لا يدخل Rows | يدخل Finalized cleaned rows |
| يعطي ملفات | يعطي سجل تنفيذ وملفات |
| فشل التوليد لا يغير DB | فشل التنفيذ يعمل Rollback |

---

# 3. أين يتم النشر فعليًا؟

> **مفهوم مهم جدًا**

الواجهة تقول:

```text
Deploy to PostgreSQL
```

لكنها لا تعرض Form لكتابة:

```text
Host
Port
Database
Username
Password
SSL
```

النشر الحالي يستخدم:

```csharp
ForgeDbContext.Database
```

أي نفس Connection String المسجلة في:

```text
ConnectionStrings:DefaultConnection
```

وفي `Program.cs`:

```csharp
options.UseNpgsql(
  builder.Configuration
    .GetConnectionString("DefaultConnection")
);
```

## المعنى

إذا ForgeDB تعمل على Database اسمها مثلًا:

```text
forgedb
```

فالتصميم المنشور ينشأ داخل **نفس Database**، لكن داخل Schema مستقلة.

ليس Deployment حاليًا إلى Server خارجي يختاره المستخدم.

---

# 4. الـSchema الخاصة بكل Project

الاسم يبنى هكذا:

```csharp
forgedb_project_{projectId}
```

مثال:

```text
Project ID = 5
Schema = forgedb_project_5
```

داخل PostgreSQL:

```text
Database: forgedb

Schemas:
├── public
│   ├── users
│   ├── projects
│   ├── datasets
│   └── ForgeDB internal tables
└── forgedb_project_5
    ├── customers
    ├── orders
    └── products
```

## لماذا Schema مستقلة؟

- تعزل Tables المنشورة عن Tables التطبيق الداخلية.
- تعزل كل Project عن الآخر.
- تسهل حذف وإعادة إنشاء مشروع واحد.
- تمنع تعارض أسماء مثل `customers` بين مشروعين.
- تجعل اسم Database واحدة كافيًا في النسخة الحالية.

---

# 5. الملفات والطبقات

## Frontend

```text
pages/project-deployment/project-deployment.component.ts
pages/project-deployment/project-deployment.component.html
services/design-api.service.ts
services/file-download.service.ts
services/api.models.ts
services/workflow-state.service.ts
app.routes.ts
```

## Backend — HTTP and Service

```text
Controllers/DeploymentController.cs
Services/DeploymentService.cs
Services/Interfaces/IDeploymentService.cs
```

## Backend — Planning and SQL

```text
Services/DeploymentPlanBuilder.cs
Services/PostgreSqlDeploymentSqlGenerator.cs
Services/PostgreSqlSqlFormatter.cs
Services/Generators/SqlSchemaGenerator.cs
Services/Generators/SqlIdentifiers.cs
```

## Backend — Persistence and Execution

```text
Repositories/DeploymentRepository.cs
Repositories/Interfaces/IDeploymentRepository.cs
Models/Entities/Deployment.cs
Models/DTOs/DeploymentDtos.cs
Data/ForgeDbContext.cs
```

## Related dependencies

```text
DesignService
DesignRepository
CleaningRepository
CleaningSnapshotSerializer
```

## المسار الطبقي

> **سبق:** `Component → API Service → Controller → Service → Repository`.

هنا:

```text
ProjectDeploymentComponent
→ DesignApiService
→ DeploymentController
→ DeploymentService
├── DesignRepository
├── DesignService
├── CleaningRepository
├── DeploymentPlanBuilder
├── PostgreSqlDeploymentSqlGenerator
└── DeploymentRepository
    └── ForgeDbContext / Npgsql / PostgreSQL
```

---

# 6. الصفحة والمسار

Route:

```text
/projects/:projectId/deployment
```

Component:

```text
ProjectDeploymentComponent
```

الصفحة تعرض:

- عدد Tables.
- عدد Relationships.
- Design Revision.
- Validation errors count.
- Schema SQL preview.
- زر Deploy.
- Confirmation dialog.
- أحدث Deployment.
- Tables created.
- Rows seeded.
- Relationships created.
- Failed rows.
- Row count لكل Table.
- ملفات SQL.
- Deployment history.

---

# 7. ProjectDeploymentComponent

المسؤوليات:

1. قراءة `projectId`.
2. حفظ Project في WorkflowState.
3. تحميل Design وSQL وHistory.
4. حساب هل الزر متاح.
5. فتح Confirmation.
6. إرسال Deployment.
7. التعامل مع Revision conflict.
8. عرض نجاح أو فشل.
9. نسخ SQL.
10. تنزيل SQL preview.
11. تنزيل ملفات سجل Deployment.

## Signals

```text
design
sqlPreview
latestDeployment
history

loading
deploying
confirmingDeploy
copied
downloadingFile
```

## متغيرات عادية

```text
projectId
errorMessage
```

---

# 8. تحميل Workspace

`load()` تستخدم:

> **سبق في Data Analysis وSchema Designer:** `forkJoin`.

ترسل معًا:

```text
GET current design
GET current schema SQL
GET deployment history
```

الكود المنطقي:

```text
forkJoin
├── design
├── sql
└── history
```

ثم:

```text
design Signal = design
sqlPreview = sql.sql
history Signal = history
latestDeployment = history[0] or null
```

## لماذا History[0]؟

Repository ترتب:

```text
StartedAt descending
```

لذلك أول عنصر هو الأحدث.

## فشل Request واحدة

`forkJoin` تفشل بالكامل.

مثال:

```text
Design موجودة
SQL موجود
History endpoint فشلت
→ الصفحة تعرض Load error
```

---

# 9. شروط canDeploy في الواجهة

Frontend تسمح بفتح Confirmation إذا:

```text
Design موجودة
Tables count > 0
Validation issue errors = 0
```

```ts
return !!design
  && design.tables.length > 0
  && errorIssueCount() === 0;
```

## ما لا تفحصه Frontend صراحة

- `design.status === Valid`.
- `validatedAt` موجودة.
- Schema Ready.
- Confirmed versions تطابق.
- Design ليست Stale.
- كل Table مربوطة Finalized Dataset.
- Rows قابلة للتحويل للأنواع.

الباك إند يفحص هذه الشروط الحقيقية.

> **قاعدة سبقت:** Frontend Validation لتحسين UX، والباك إند هي الحماية النهائية.

---

# 10. شروط النشر الحقيقية في الباك إند

`DeploymentService.DeployAsync` ترفض النشر إذا:

1. Project ليست للمستخدم.
2. Design غير موجودة.
3. Revision تغيرت.
4. Design بلا Tables.
5. Status ليست `Valid`.
6. `ValidatedAt` غير موجودة.
7. Schema Ready أصبحت false.
8. توجد Validation errors.
9. Dataset-to-Table mapping ناقصة أو غامضة.
10. Table تشير إلى Version غير مؤكدة.
11. Version Raw Original.
12. Version ليست Active.
13. Version غير محللة.
14. Source Columns غير مربوطة بالكامل.
15. قيمة لا يمكن تحويلها إلى SQL Type.

هذا يجعل Deployment Gate أقوى من Export الحالية.

---

# 11. نافذة التأكيد

قبل التنفيذ تعرض الصفحة Warning واضح:

```text
This drops and recreates
forgedb_project_{projectId}
```

وتوضح:

- Schema السابقة للمشروع ستُستبدل.
- Tables ستُعاد.
- Rows الحالية ستُعاد.
- بيانات ForgeDB الداخلية لا تتأثر.

## الأزرار

```text
Cancel
Deploy Now
```

## لماذا Confirmation ضرورية؟

لأن العملية Destructive داخل Project schema:

```sql
DROP SCHEMA IF EXISTS ... CASCADE;
```

أي بيانات أضيفت يدويًا داخل Schema المنشورة ستُحذف عند إعادة النشر.

---

# 12. If-Match وDesign Revision

> **سبق في Relationships وSchema Designer.**

Frontend ترسل:

```http
If-Match: {design.revision}
```

Endpoint:

```http
POST /api/projects/{projectId}/deployments
```

## الباك إند

تقارن:

```text
current design revision
vs
If-Match revision
```

إذا تغيرت:

```text
409 Conflict
```

Frontend:

```text
The schema design changed elsewhere...
→ load latest workspace
```

## لماذا؟

حتى لا ينشر المستخدم Design قديمة بعدما عدلها Tab آخر.

Deployment record تحفظ أيضًا:

```text
DesignRevision
```

حتى نعرف أي Revision نُشرت.

---

# 13. DeploymentController

```csharp
[ApiController]
[Authorize]
[Route("api/projects/{projectId:int}/deployments")]
```

## Endpoints

| Method | Path | الوظيفة |
|---|---|---|
| POST | `/deployments` | تنفيذ Deployment |
| GET | `/deployments` | History |
| GET | `/deployments/latest` | أحدث Deployment |
| GET | `/deployments/{id}` | سجل محدد |
| GET | `/deployments/{id}/schema.sql` | Schema file |
| GET | `/deployments/{id}/seed.sql` | Seed file |
| GET | `/deployments/{id}/deploy.sql` | Complete file |

## Deploy

```text
Ensure project ownership
→ Require If-Match
→ DeploymentService.DeployAsync
→ 200 response
```

ملاحظة: العملية تنشئ Resource جديدة، لكن Controller الحالية تعيد `200 OK` وليست `201 Created`.

---

# 14. DeploymentService

Dependencies:

```text
IDeploymentRepository
IDesignRepository
IDesignService
ICleaningRepository
ILogger
```

الدالة الرئيسية:

```csharp
DeployAsync(
  projectId,
  userId,
  ifMatchRevision
)
```

المراحل:

```text
Authorization
→ Design gate
→ Quality gate
→ Validation gate
→ Build schema name
→ Order tables
→ Build insert plans
→ Generate SQL artifacts
→ Add Running record
→ Execute transaction
→ Mark Completed or Failed
→ Reload response
```

---

# 15. سجل Running قبل التنفيذ

قبل لمس Project schema، الخدمة تنشئ Row في:

```text
deployments
```

بالحالة:

```text
Running
```

وتحفظ:

```text
ProjectId
DesignRevision
SchemaName
GeneratedSql
SeedSql
DeploySql
TriggeredByUserId
StartedAt
```

## لماذا قبل التنفيذ؟

حتى يكون هناك Audit record حتى لو فشل التنفيذ.

إذا نجح:

```text
Running → Completed
```

إذا فشل:

```text
Running → Failed
```

## Transaction مختلفة

حفظ Deployment record ليس داخل Transaction التي تسقط وتنشئ Project schema.

هذا مقصود، لأن Rollback التنفيذ لا يجب أن يحذف سجل الفشل.

---

# 16. Design validation

الخدمة تشترط أولًا:

```text
design.Status == Valid
ValidatedAt != null
```

ثم تستدعي:

```text
PrepareExportArtifactsAsync
```

وتفحص Validation Issues من Snapshot مرة ثانية.

إذا توجد Error:

```text
DesignValidationFailedException
```

## لماذا التحقق مرتين؟

- Status تثبت أن المستخدم عمل Validation.
- إعادة Validation تحمي من حالة غير متوقعة أو Design بنيوية غير صالحة.

## Warnings

لا تمنع النشر.

---

# 17. Schema Ready والجودة المؤكدة

> **سبق في Data Cleaning.**

الخدمة تستدعي:

```text
CleaningRepository.IsSchemaReadyAsync(projectId)
```

Schema Ready تعني:

```text
Confirmed version map
==
Current active version map
```

إذا Cleaning جديدة أو Restore أو Undo حدثت بعد Confirmation:

```text
Schema Ready = false
```

Deployment ترفض حتى:

```text
Re-analysis
→ Confirm Quality again
→ Regenerate/Revalidate when needed
```

---

# 18. Finalized cleaned versions

> **مفهوم مهم**

Deployment لا تقرأ `DatasetRows` العادية مباشرة.

تقرأ:

```text
DatasetVersion.RowsJson
DatasetVersion.ColumnsJson
```

من Version المؤكدة والمربوطة بالـDesign Table.

الشروط:

```text
Version is active
Version analyzed
Version confirmed
Version not raw original
```

## لماذا؟

حتى تنشر بالضبط Snapshot التي راجعها المستخدم وأكد جودتها.

---

# 19. منع نشر Raw Data

إذا:

```text
version.IsRawOriginal == true
```

ترفض الخدمة:

```text
Raw uploaded data cannot be deployed.
```

## المعنى

حتى لو البيانات الأصلية نظيفة، نظام Deployment الحالي يطلب Version ليست Raw.

هذا يعني أن دورة Cleaning/Finalization يجب أن تنتج نسخة Cleaned/Finalized.

## ملاحظة

في Data Cleaning كان يمكن تأكيد بيانات نظيفة أصلًا بلا Cleaning Batch، لكن Deployment هنا ترفض Raw Version صراحة.

هذه نقطة قد تسبب تعارضًا في حالة:

```text
Dataset نظيفة تمامًا
→ quality confirmed on raw v1
→ schema ready
→ Deployment rejects v1 as raw
```

هذه فجوة حالية مهمة ومسجلة في التحسينات.

---

# 20. Dataset-to-Table Mapping

كل Generated DesignTable يجب أن تحتوي:

```text
SourceDatasetId
SourceDatasetVersionId
```

الخدمة تتحقق:

- كل Confirmed Dataset لها Table واحدة بالضبط.
- لا توجد Dataset مرتبطة بأكثر من Table sourced.
- لا توجد Confirmed Dataset بلا Table.
- IDs تطابق Confirmed versions.

إذا mapping ناقصة أو غامضة:

```text
The finalized dataset-to-table mappings are incomplete or ambiguous.
```

## لماذا Table واحدة لكل Dataset؟

خطة النشر الحالية تفترض:

```text
one finalized dataset
→ one generated table
```

لا تدعم تقسيم Dataset واحدة إلى جدولين Generated تلقائيًا.

---

# 21. Column Mapping

داخل Table sourced، الأعمدة التي لها:

```text
SourceColumnName
```

تستخدم لربط DesignColumn بقيمة داخل Dataset Version.

الخدمة تتحقق:

1. لا يوجد SourceColumnName مكرر.
2. كل mapped source name موجودة في Version.
3. كل source column في Version ممثلة مرة واحدة.
4. لا توجد source column مفقودة من Design.

## مثال

Version:

```text
id
name
email
```

Design يجب أن يحتوي mappings:

```text
customer_id ← id
full_name   ← name
email       ← email
```

تغيير الاسم النهائي مسموح، لأن الربط يستخدم:

```text
SourceColumnName
```

وليس اسم DesignColumn النهائي.

---

# 22. User-created Tables and Columns

## User Table بلا Source mapping

إذا Table:

```text
SourceDatasetId = null
SourceDatasetVersionId = null
Origin != generated
```

يُنشأ لها Insert Plan فارغ:

```text
0 source columns
0 rows
```

فتظهر Table في DDL، لكن لا تُseed.

## Generated Table بلا Mapping

ترفض.

## User-added Column داخل sourced table

إذا لا تحتوي `SourceColumnName`:

- لا تدخل ضمن Insert column list.
- PostgreSQL تستخدم:
  - Default.
  - Identity.
  - أو Null إن كانت Nullable.

إذا كانت:

```text
NOT NULL
ولا Default
ولا Identity
```

فالInsert تفشل، وتعمل Transaction Rollback.

---

# 23. TableInsertPlan

Record داخل Repository interface:

```text
TableName
ColumnNames
ColumnSqlTypes
Rows
IdentityColumnNames
```

مثال:

```text
TableName: customers

ColumnNames:
[id, name, email]

ColumnSqlTypes:
[INTEGER, TEXT, TEXT]

Rows:
[
  [1, "Ahmed", "a@example.com"],
  [2, "Sara",  "s@example.com"]
]

IdentityColumnNames:
[id]
```

الخطة تفصل:

```text
Preparation
عن
Execution
```

فتستطيع اختبار Conversion وMapping دون تشغيل Database.

---

# 24. ترتيب الجداول للإدخال

> **سبق في SQL Generator، لكن هنا الترتيب للRows.**

إذا:

```text
orders.customer_id
→ customers.id
```

الترتيب:

```text
customers rows first
orders rows second
```

`OrderTablesForInsertion` تستخدم Dependency graph وDFS.

## الهدف

حتى لو Foreign Keys موجودة أثناء الإدخال، Target rows تكون موجودة أولًا.

لكن Runtime الحالية تؤجل جميع Foreign Keys أصلًا؛ الترتيب يبقى مفيدًا ومنطقيًا.

---

# 25. Circular Relationships

إذا:

```text
table_a → table_b
table_b → table_a
```

لا يوجد ترتيب صحيح كامل.

Plan Builder:

```text
detect cycle
→ fallback to table ID order
```

وهذا آمن لأن Deployment SQL تؤجل Foreign Keys إلى ما بعد Seed.

بعد إدخال كل Rows:

```text
add all FK constraints
```

إذا البيانات تخالف العلاقة:

```text
ADD CONSTRAINT fails
→ rollback everything
```

---

# 26. تحويل القيم إلى PostgreSQL Types

`ConvertValue(raw, sqlType)` تحول JSON values إلى CLR Types مناسبة لـNpgsql.

## الأنواع

| PostgreSQL | CLR |
|---|---|
| SMALLINT | `short` |
| INTEGER | `int` |
| BIGINT | `long` |
| REAL | `float` |
| DOUBLE PRECISION | `double` |
| NUMERIC / DECIMAL | `decimal` |
| BOOLEAN | `bool` |
| DATE | `DateOnly` |
| TIMESTAMP | `DateTime Unspecified` |
| TIMESTAMPTZ | `DateTime UTC` |
| UUID | `Guid` |
| TEXT / VARCHAR | `string` |

## InvariantCulture

> **سبق في Analysis وCleaning.**

الأرقام والتواريخ تتحول بطريقة لا تعتمد على لغة جهاز السيرفر.

---

# 27. Null وEmpty String

## Null

```text
null
Json null
→ DBNull.Value
```

## Empty text في TEXT/VARCHAR

تبقى:

```text
""
```

لأن Empty String قيمة نصية وليست Null.

## Empty text في نوع رقمي أو تاريخ

تتحول:

```text
DBNull.Value
```

لأن Snapshot تمثل Missing typed value أحيانًا كنص فارغ.

## Database rules

بعد ذلك PostgreSQL تقرر:

- Nullable → تقبل Null.
- NOT NULL → تفشل.
- Default لا تُستخدم عند إرسال Null صريح عادة؛ Default تستخدم عند حذف Column من INSERT.

---

# 28. Npgsql Parameters

> **مفهوم جديد مهم**

Runtime لا تضع القيم مباشرة داخل SQL.

تبني Parameters مثل:

```text
@p_t0_r0_c0
@p_t0_r0_c1
```

الاسم يحتوي:

```text
table index
row index
column index
```

مثال:

```text
p_t2_r15_c3
```

## Explicit PostgreSQL type

كل Parameter تأخذ:

```text
NpgsqlDbType
```

مثل:

```text
Integer
Text
TimestampTz
Uuid
```

حتى `DBNull` تكون Typed.

## لماذا Typed Null؟

Npgsql لا تستطيع دائمًا معرفة نوع:

```text
DBNull.Value
```

فيمكن أن تعتبره Text خطأ.

---

# 29. لماذا Runtime Inserts Parameterized؟

SQL التنفيذ:

```sql
INSERT INTO schema.table (id, name)
VALUES (@p_t0_r0_c0, @p_t0_r0_c1)
```

والقيم منفصلة.

## الفوائد

- حماية من SQL injection داخل Values.
- Quotes وUnicode تتعامل معها Driver.
- أنواع صحيحة.
- Null typed.
- لا تحتاج بناء Literal يدوي لكل Runtime row.

## Identifiers

أسماء Schema/Table/Column لا يمكن إرسالها Parameters.

لذلك تستخدم:

```text
SqlIdentifiers.Quote
SqlIdentifiers.QuoteIfNeeded
```

---

# 30. ملفات SQL القابلة للتنزيل

كل Deployment record تحفظ ثلاثة Artifacts:

```text
schema.sql
seed.sql
deploy.sql
```

## لماذا تحفظها؟

- Audit.
- إعادة تنزيل ما تم التخطيط له.
- تشغيل يدوي.
- مقارنة Deployment revisions.
- تشخيص الفشل.

## التخزين

في جدول `deployments` كحقول Text:

```text
GeneratedSql
SeedSql
DeploySql
```

---

# 31. schema.sql

تحتوي:

```text
BEGIN
CREATE SCHEMA IF NOT EXISTS
SET LOCAL search_path
Design DDL
COMMIT
```

مثال:

```sql
BEGIN;
CREATE SCHEMA IF NOT EXISTS forgedb_project_5;
SET LOCAL search_path TO forgedb_project_5, public;

CREATE TABLE customers (...);

COMMIT;
```

## ملاحظة

لا تسقط Schema الموجودة.

لكن إذا Tables موجودة، `CREATE TABLE` قد تفشل.

هي أقرب إلى:

```text
Schema-only artifact
```

وليست إعادة نشر كاملة مضمونة فوق نسخة موجودة.

---

# 32. seed.sql

تحتوي:

```text
BEGIN
SET LOCAL search_path
INSERT rows
Reset identity sequences
COMMIT
```

لا تنشئ Tables.

تفترض:

```text
schema.sql نفذت مسبقًا
```

إذا لا توجد Rows:

```sql
-- No finalized rows to seed.
```

---

# 33. deploy.sql

هذه Artifact الكاملة:

```text
BEGIN
DROP SCHEMA IF EXISTS ... CASCADE
CREATE SCHEMA ...
SET LOCAL search_path
Pre-seed DDL
Finalized cleaned data
Deferred foreign keys
COMMIT
```

هذه الأقرب إلى Runtime Deployment.

## Destructive

كل تشغيل:

```text
replaces project schema completely
```

---

# 34. الفرق بين Runtime Execution وDownloaded SQL

> **مفهوم مهم جدًا**

## Runtime

- Uses EF Core transaction.
- Inserts Row واحدة في كل Execute call.
- Uses typed Npgsql parameters.
- Runs pre-seed DDL.
- Inserts.
- Resets identity.
- Runs post-seed FKs.
- Commits.

## deploy.sql

- Text file.
- Values مكتوبة كSQL literals.
- Rows مجمعة في batches.
- يمكن تشغيلها يدويًا.
- تحتوي Transaction statements بنفسها.

## النتيجة

المنطق متقارب، لكن طريقة إرسال Values مختلفة.

```text
Runtime = parameterized
Artifact = literal executable SQL
```

---

# 35. Insert batching

في `seed.sql` و`deploy.sql`:

```text
InsertBatchSize = 500
```

مثال:

```sql
INSERT INTO customers (id, name)
VALUES
  (1, 'A'),
  (2, 'B'),
  ...
  (500, '...');

INSERT INTO customers ...
VALUES
  (501, '...'),
  ...
```

## لماذا؟

- يقلل عدد Statements.
- يمنع Statement واحدة ضخمة جدًا.
- أسهل من INSERT لكل Row داخل الملف.

## Runtime

لا تستخدم Batch size حاليًا؛ تنفذ Row واحدة في كل Loop.

هذه فجوة أداء للDatasets الكبيرة.

---

# 36. تأجيل Foreign Keys

Deployment SQL تزيل جميع FKs من DDL قبل Seed.

المسار:

```text
Create tables without FKs
→ insert all rows
→ add FKs afterward
```

## لماذا؟

- يدعم Cycles.
- يقلل مشاكل ترتيب الإدخال.
- يسمح بتحميل البيانات أولًا.
- يتحقق من العلاقات مرة واحدة بعد اكتمال Rows.

## لو البيانات فيها Orphan FK

مثال:

```text
orders.customer_id = 999
ولا يوجد customer 999
```

عند:

```sql
ALTER TABLE ... ADD FOREIGN KEY
```

PostgreSQL تفشل.

وبسبب Transaction:

```text
schema + tables + rows كلها rollback
```

---

# 37. Identity Sequences

إذا Dataset تحتوي IDs صريحة في Identity Column:

```text
1, 2, 100
```

بعد Insert، Sequence الداخلية قد تبقى عند 1.

ثم Insert جديد قد يحاول توليد:

```text
1
```

ويصطدم بـPK.

لذلك بعد Seed:

```sql
SELECT setval(
  pg_get_serial_sequence(...),
  MAX(id),
  ...
);
```

فتصبح القيمة التالية بعد أعلى ID موجودة.

## GENERATED BY DEFAULT

Design SQL تستخدم:

```text
GENERATED BY DEFAULT AS IDENTITY
```

وهذا يسمح بإدخال ID صريحة عند Seed.

---

# 38. DeploymentRepository

مسؤولياتها:

```text
Owned project lookup
Create Running record
Mark success
Mark failure
Get history
Get latest
Get by ID
Execute database transaction
```

## فصل المسؤوليات

### Service

تقرر:

- هل يسمح بالنشر؟
- أي Versions؟
- كيف تبنى Plans؟
- ما Artifacts؟

### Repository

تنفذ:

- EF reads/writes.
- SQL execution.
- Transaction.
- Status persistence.

---

# 39. Transaction الكاملة

```csharp
BeginTransactionAsync
```

داخلها:

```text
DROP/CREATE schema
Pre-seed DDL
All inserts
Identity resets
Post-seed foreign keys
Commit
```

إذا أي Statement ترمي Exception:

```text
using transaction disposes without commit
→ rollback
```

## Atomicity

```text
Everything deployed
or
nothing deployed
```

لا توجد حالة:

```text
3 tables created
2 tables missing
half rows inserted
```

---

# 40. DROP SCHEMA CASCADE

Runtime تبدأ:

```sql
DROP SCHEMA IF EXISTS forgedb_project_5 CASCADE;
```

## CASCADE

تحذف كل Objects داخل Schema:

```text
Tables
Constraints
Indexes
Views if any
Sequences
Manually added rows
Manually added objects
```

ثم:

```sql
CREATE SCHEMA forgedb_project_5;
```

## ما لا تحذفه

- `public` schema.
- ForgeDB internal tables.
- Schemas لمشاريع أخرى.
- Database نفسها.

---

# 41. search_path

بعد إنشاء Schema:

```sql
SET LOCAL search_path TO
  forgedb_project_5,
  public;
```

## لماذا؟

Generated DDL تستخدم Names غير Schema-qualified غالبًا:

```sql
CREATE TABLE customers
```

مع `search_path` تصبح:

```text
forgedb_project_5.customers
```

`LOCAL` تعني الإعداد داخل Transaction فقط.

بعد انتهاء Transaction لا يغير Session دائمًا.

---

# 42. النجاح

بعد Commit:

```text
MarkSucceededAsync
```

تحدث:

```text
Status = Completed
CompletedAt
CreatedTablesJson
InsertedRowCountsJson
TablesCreated
TotalRowsInserted
RelationshipsCreated
FailedRows = 0
```

Frontend تعرض:

```text
Deployment Completed
Schema name
Tables created
Rows seeded
Relationships
Failed rows
Rows per table
```

---

# 43. الفشل وRollback

إذا Execution ترمي Exception:

1. Transaction تكون Rolled Back.
2. Service تسجل Error في Logs.
3. تقص الرسالة إلى 2000 حرف.
4. `MarkFailedAsync` تحدث Deployment record.
5. ترجع Response بحالة Failed.

## نقطة مهمة

Deployment failure داخل تنفيذ SQL لا تعاد دائمًا كـHTTP Error.

الخدمة تمسك Exception وتعيد:

```text
200 OK
DeploymentResponse.Status = Failed
```

الواجهة تعرض Failed card.

## لماذا؟

الفشل يعتبر Outcome مسجل للعملية، وليس فشل Transport/API فقط.

أما فشل Preconditions قبل إنشاء Deployment record فيعاد 4xx.

---

# 44. Cancellation

إذا Request أُلغيت:

```text
OperationCanceledException
```

الخدمة:

```text
mark failed:
Deployment was cancelled and rolled back.
```

باستخدام:

```text
CancellationToken.None
```

حتى حفظ حالة الإلغاء لا يُلغى مع Request.

ثم تعيد رمي Exception.

## Frontend الحالية

لا يوجد زر Cancel Deployment.

Cancellation قد تأتي من:

- إغلاق الاتصال.
- Server shutdown.
- Request timeout.
- Client disconnect.

---

# 45. Deployment Entity

```text
Id
ProjectId
DesignRevision
SchemaName
Status

GeneratedSql
SeedSql
DeploySql

ErrorMessage
CreatedTablesJson
InsertedRowCountsJson

TablesCreated
TotalRowsInserted
RelationshipsCreated
FailedRows

TriggeredByUserId
StartedAt
CompletedAt
```

## JSONB

```text
CreatedTablesJson
InsertedRowCountsJson
```

مخزنة كـ`jsonb`.

## SQL

الملفات الثلاثة مخزنة كـ`text`.

## Index

```text
ProjectId + StartedAt
```

يساعد History query.

---

# 46. Deployment History

Endpoint:

```http
GET /api/projects/{projectId}/deployments
```

Repository:

```text
WHERE ProjectId
ORDER BY StartedAt DESC
```

لا يوجد Limit أو Pagination حاليًا.

## Frontend

تعرض History فقط إذا:

```text
history.length > 1
```

وتعرض:

```text
StartedAt
Status
```

لا يوجد اختيار History item لعرض تفاصيله أو تنزيل ملفاته.

Download buttons الحالية تخص:

```text
latestDeployment فقط
```

---

# 47. Latest Deployment

Endpoint مستقل:

```http
GET /api/projects/{projectId}/deployments/latest
```

لكن Component الحالية لا تستخدمه.

هي تستخدم:

```text
GET history
→ history[0]
```

الEndpoint قد تفيد لصفحات أخرى أو تحسين الأداء.

---

# 48. تنزيل ملفات Deployment

Endpoints:

```text
/{deploymentId}/schema.sql
/{deploymentId}/seed.sql
/{deploymentId}/deploy.sql
```

Controller:

1. تتحقق Ownership.
2. تجلب Deployment داخل Project.
3. تختار الحقل.
4. إذا فارغ → 404.
5. تعيد File بـUTF-8.

## File name whitelist

Service تقبل فقط:

```text
schema.sql
seed.sql
deploy.sql
```

أي اسم آخر:

```text
ArgumentException
```

لكن Controller لديها Routes ثابتة، فلا يصل عادة اسم عشوائي من المستخدم.

---

# 49. Frontend Download Flow

DesignApiService تطلب File endpoint:

```ts
responseType: 'text'
```

ثم Component تستقبل Content وتستخدم:

```text
FileDownloadService
→ Blob
→ Object URL
→ anchor download
```

> **سبق في Exports:** Blob وObject URL.

## لماذا لا يفتح Browser URL مباشرة؟

HttpClient يمر عبر Auth interceptor ويرسل JWT.

بعد استلام النص، يصنع Download محلية.

## downloadingFile

تحفظ:

```text
schema.sql
seed.sql
deploy.sql
null
```

وتمنع تنزيلين متزامنين.

---

# 50. Generated SQL Preview

الصفحة تحمل:

```http
GET /api/projects/{projectId}/schema/sql
```

وتعرض:

```text
Schema DDL preview
```

## ملاحظة مهمة

النص المعروض ليس `deploy.sql` الكاملة.

لا يحتوي بالضرورة:

```text
DROP project schema
Seed rows
Deferred FK section
```

هو SQL الخاصة بالـDesign الحالية.

بعد Deployment، الصفحة لا تستبدله تلقائيًا بـ`latest.generatedSql`.

لرؤية Artifacts الدقيقة للنشر:

```text
Schema SQL
Seed SQL
Complete SQL
```

استخدم أزرار Deployment Completed.

النص في الواجهة:

```text
The exact DDL that will run
```

دقيق بالنسبة لجزء Design DDL، لكنه ليس كامل عملية النشر.

---

# 51. DeploymentResponseDto

Frontend وBackend تحتوي:

```text
deploymentId
id
projectId
designRevision
schemaName
status
generatedSql
errorMessage
createdTables
insertedRowCounts
tablesCreated
rowsSeeded
totalRowsInserted
relationshipsCreated
failedRows
schemaSqlAvailable
seedSqlAvailable
deploySqlAvailable
startedAt
completedAt
```

## id وdeploymentId

كلاهما نفس القيمة.

غالبًا موجودان للتوافق بين نسخ UI/API.

## rowsSeeded وtotalRowsInserted

كلاهما يعكسان:

```text
TotalRowsInserted
```

أيضًا تكرار توافق.

---

# 52. Status values

Entity تعرف:

```text
Running
Completed
Failed
```

وتعرف Alias:

```text
Succeeded = Completed
```

Frontend تتحمل:

```text
Completed
أو
Succeeded
```

لكن الباك إند الحالية تحفظ النجاح كـ:

```text
Completed
```

## Running

قد تظهر في History إذا Request أخرى قرأت السجل أثناء التنفيذ.

Component الحالية تنتظر POST حتى تنتهي، لأنها عملية Synchronous.

---

# 53. Security and ownership

> **سبق في كل الميزات.**

كل Endpoint:

```text
[Authorize]
```

ثم:

```text
Project.UserId
==
JWT user ID
```

## Downloads

حتى لو عرف المستخدم:

```text
deploymentId
```

لا يستطيع تنزيلها عبر Project مستخدم آخر.

Query نفسها تبحث:

```text
ProjectId + DeploymentId
```

بعد Ownership check.

## SQL injection

### Values

Parameterized في Runtime.

### Identifiers

Quoted وValidated.

### Downloaded literals

`PostgreSqlSqlFormatter` تهرب:

- Single quotes.
- Backslashes.
- New lines.
- Tabs.
- Dates.
- UUIDs.
- Numeric invariant formatting.

وتمنع Zero byte في Text.

---

# 54. الأخطاء وHTTP Codes

## قبل التنفيذ

| Code | الحالة |
|---:|---|
| 400 | Project ID أو If-Match غير صالحة |
| 401 | JWT مفقودة/غير صالحة |
| 403 | Project ليست للمستخدم |
| 404 | Project/Design/Deployment/File غير موجودة |
| 409 | Design Revision تغيرت |
| 422 | Design/quality/mapping/precondition غير صالحة |
| 428 | If-Match مفقودة |

## أثناء التنفيذ

غالبًا:

```text
200 OK
Status = Failed
ErrorMessage
```

لأن الفشل يسجل كDeployment outcome.

## أمثلة 422

```text
Validate final schema first
No finalized cleaned dataset approved
Design has no tables
Raw data cannot be deployed
Mapping incomplete
Version no longer active
Column mapping incomplete
Value conversion failed before execution
```

## 500 محتمل

أخطاء غير ممسوكة في Controller أو فشل حفظ Deployment status نفسه.

---

# 55. المسارات الكاملة

## فتح الصفحة

```text
/projects/5/deployment
→ read projectId
→ forkJoin:
   current design
   schema SQL preview
   deployment history
→ latest = history[0]
```

## ضغط Deploy

```text
canDeploy frontend
→ confirmation dialog
→ POST deployments + If-Match
→ ownership
→ current revision
→ design Valid
→ schema ready
→ validation
→ active confirmed versions
→ exact table/column mappings
→ convert values
→ build plans
→ build schema/seed/deploy SQL
→ create Running record
```

## Runtime transaction

```text
BEGIN transaction
→ DROP project schema CASCADE
→ CREATE project schema
→ SET LOCAL search_path
→ create tables/indexes without FKs
→ parameterized row inserts
→ reset identity sequences
→ add FK constraints
→ COMMIT
```

## Success

```text
mark Completed
→ rows/tables/relationships counts
→ return DeploymentResponse
→ add to top of frontend history
```

## Failure

```text
exception
→ rollback
→ mark Failed outside transaction
→ return Failed DeploymentResponse
→ display failure card
```

## Download

```text
select latest deployment
→ GET SQL artifact
→ authenticated text response
→ Blob download
```

---

# 56. الاختبار العملي

## Target database

- Confirm deployment goes to `DefaultConnection`.
- Verify schema `forgedb_project_{id}`.
- Verify `public` ForgeDB tables remain.
- Verify another Project schema remains.
- Verify re-deploy replaces only current Project schema.

## Frontend load

- Valid project.
- Invalid project ID.
- No design.
- Design no tables.
- History empty.
- History multiple.
- One forkJoin request fails.
- Revision displayed correctly.

## Preconditions

- Design Draft.
- Design Invalid.
- ValidatedAt null.
- Validation error exists.
- Schema Ready false.
- Design revision stale.
- Missing If-Match.
- Project another user.

## Raw/finalized versions

- Raw original only.
- Cleaned active analyzed.
- Cleaned inactive.
- Cleaned unanalyzed.
- Confirmed map mismatch.
- Dataset missing Table.
- Two Tables mapped to same Dataset.
- Generated Table missing mapping.

## Column mapping

- Rename DesignColumn but keep SourceColumnName.
- Missing source column.
- Duplicate SourceColumnName.
- Extra source column not mapped.
- User-added Nullable column.
- User-added Default column.
- User-added NOT NULL column بلاDefault.
- User Table بلا source mapping.

## Type conversion

- SMALLINT min/max.
- INTEGER.
- BIGINT.
- NUMERIC.
- REAL.
- DOUBLE.
- BOOLEAN true/false.
- Invalid boolean مثل `yes` في Deployment conversion.
- DATE.
- TIMESTAMP.
- TIMESTAMPTZ.
- UUID.
- Empty text.
- Empty numeric.
- Null.
- Invalid typed value.

## SQL safety

- Apostrophe in text.
- Backslash.
- Newline.
- Arabic/Unicode.
- Zero byte.
- Reserved identifier.
- Quoted identifier.
- Parameter name uniqueness.

## Relationships

- Parent inserted before child.
- Cycle.
- Orphan FK causes rollback.
- Cascade.
- Set null.
- No action.
- Relationships added after Seed.
- Indexes created.

## Transaction

- Failure on first table.
- Failure after several rows.
- Failure adding FK.
- Failure resetting sequence.
- Verify schema unchanged/absent after rollback.
- Verify Deployment record remains Failed.
- Verify counts are zero on failure.

## Identity

- Explicit IDs seeded.
- Sequence resets to MAX.
- New insert gets next value.
- User-created identity column omitted from source mapping.

## Artifacts

- `schema.sql`.
- `seed.sql`.
- `deploy.sql`.
- Empty seed.
- 500-row batch.
- 501 rows → two batches.
- Foreign keys deferred.
- Download availability flags.
- Unauthorized download.
- Wrong deployment ID.

## Re-deploy

- First deployment succeeds.
- Add manual row in Project schema.
- Re-deploy.
- Manual row disappears.
- New finalized rows replace previous rows.
- History retains both records.

## Cancellation/concurrency

- Cancel request.
- Server shutdown during deployment.
- Two Deploy requests at same time.
- Two Tabs with same revision.
- Design changes during preparation.

---

# 57. ملخص الحفظ السريع

## الهدف

```text
Validated design
+
confirmed cleaned versions
→ real PostgreSQL schema
```

## Target

```text
Same DefaultConnection database
→ forgedb_project_{projectId}
```

## Gate

```text
ownership
revision
Valid design
ValidatedAt
schema ready
no errors
exact finalized mapping
non-raw active analyzed versions
convertible values
```

## Plan

```text
DesignTable
+ source DatasetVersion
→ TableInsertPlan
```

## التنفيذ

```text
drop schema
create schema
create tables
insert rows
reset identities
add foreign keys
commit
```

## الأمان

```text
JWT ownership
If-Match
validated design
confirmed versions
quoted identifiers
typed parameters
one transaction
rollback
```

## Artifacts

```text
schema.sql = DDL
seed.sql   = Rows
deploy.sql = destructive full deployment
```

## مفاهيم جديدة

```text
Database schema namespace
same DefaultConnection target
deployment plan
typed Npgsql parameters
explicit typed nulls
runtime SQL vs downloadable SQL
deferred foreign keys
identity sequence reset
deployment outcome record
rollback with separate failure audit
```

## مفاهيم سبقت

```text
Signals
forkJoin
finalize
Blob download
JWT ownership
Design Revision
If-Match
Schema Ready
Dataset Versions
Validation
Topological ordering
Transactions
```

---

# 58. تحسينات مؤجلة

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. إضافة Target connection form آمنة بدل النشر فقط إلى `DefaultConnection`.
2. تشفير Secrets وعدم حفظ Password نصيًا.
3. Test Connection قبل Deploy.
4. Allow-list للمضيفين والشبكات المسموح بها.
5. دعم SSL mode وCertificates.
6. إظهار Database وHost الهدف بوضوح في Confirmation.
7. منع نشر Raw version أو تعديل Quality flow بحيث clean data بلا issues تنتج Finalized version غير Raw.
8. إصلاح التعارض بين تأكيد جودة Raw نظيفة ورفض Deployment للRaw.
9. إضافة Distributed Lock أو Project deployment lock لمنع نشرين متزامنين.
10. تحويل Deployment إلى Background Job.
11. Status polling وProgress:
    - preparing
    - creating schema
    - inserting table
    - adding constraints
12. زر Cancel Deployment حقيقي.
13. Batch/COPY runtime inserts بدل Row-by-row.
14. استخدام PostgreSQL binary `COPY` للسرعة.
15. Retry policy للأخطاء المؤقتة فقط.
16. Dry Run داخل Transaction تنتهي Rollback.
17. Deployment diff قبل Drop/Recreate.
18. Migration mode بدل إعادة إنشاء Schema كاملة.
19. Backup/restore للSchema السابقة قبل الاستبدال.
20. Rename old schema ثم atomic swap عند النجاح.
21. حفظ checksum للDesign وDataset versions في Deployment.
22. التحقق أن Design ليست Stale مباشرة داخل Deployment، وليس Schema Ready فقط.
23. حفظ exact confirmed version map داخل Deployment record.
24. حفظ target connection identity الآمنة داخل السجل.
25. Pagination للHistory.
26. اختيار Deployment قديمة وعرض تفاصيلها.
27. تنزيل Artifacts لأي History item من UI.
28. إظهار المستخدم الذي شغل Deployment.
29. إظهار مدة التنفيذ.
30. إظهار Progress per table.
31. جعل SQL preview تعرض `deploy.sql` الفعلية بدل Schema DDL فقط.
32. توضيح النص الحالي الذي يقول Exact DDL.
33. استبدال `application/sql` بـMIME متوافق وموحد عند الحاجة.
34. استخدام `201 Created` مع Location للDeployment الجديدة.
35. Endpoint منفصلة لبدء Job وEndpoint لقراءة الحالة.
36. التحقق من عدم وجود Running Deployment قبل بدء أخرى.
37. Retention policy لملفات SQL الكبيرة.
38. ضغط Artifacts.
39. إخفاء Sensitive values من Seed SQL أو جعل تنزيل البيانات Option صريح.
40. Audit log للDownload.
41. تشغيل Integration tests على PostgreSQL حقيقية، وليس InMemory.
42. Test rollback بعد فشل FK.
43. Test Unicode/quotes/typed nulls.
44. Test 500-row batching.
45. تحسين Boolean conversion لتقبل نفس القيم التي قبلها Cleaning/Analysis إذا كان ذلك مقصودًا.
46. دعم NUMERIC precision/scale في Parameters.
47. التعامل مع User columns ذات Default/Identity بشكل أوضح في Insert plan.
48. إظهار Warning أن Re-deploy تحذف Manual changes داخل Project schema.
49. إضافة Export backup قبل Re-deploy.
50. Health check لPostgreSQL قبل بدء الخطة الثقيلة.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. الفرق بين Export وDeployment.
2. أين يتم النشر حاليًا.
3. لماذا يستخدم `forgedb_project_{id}`.
4. لماذا Frontend canDeploy ليست الحماية الكاملة.
5. لماذا تحتاج Deployment إلى Valid design وSchema Ready.
6. لماذا تنشر DatasetVersion وليس DatasetRows.
7. كيف يتحقق Dataset-to-Table mapping.
8. كيف يتحقق Column mapping.
9. ما هي TableInsertPlan.
10. كيف تتحول JSON values إلى CLR/PostgreSQL types.
11. لماذا Runtime تستخدم Parameters.
12. الفرق بين schema.sql وseed.sql وdeploy.sql.
13. لماذا تؤجل Foreign Keys.
14. كيف يعاد ضبط Identity sequence.
15. كيف تعمل Transaction الكاملة.
16. ماذا يفعل DROP SCHEMA CASCADE.
17. لماذا سجل Running يُحفظ قبل Transaction.
18. كيف يسجل الفشل بعد Rollback.
19. لماذا بعض فشل النشر يرجع 200 مع Status Failed.
20. ما القيود الحالية للنشر، خصوصًا Raw clean data وSame DefaultConnection.
