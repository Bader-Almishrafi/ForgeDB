# ForgeDB — دليل جلسة Project Exports & Database Package الكامل

> **الجلسة رقم 08 — Project Exports / Database Package**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم كيف يجمع ForgeDB التصميم النهائي في Package واحدة، ويولد SQL وDBML وJSON وتقارير العلاقات والجودة، ويتحقق من صحة التصميم، ثم يعرض المحتوى وينسخه وينزله من المتصفح.

---

## ملاحظة عن ترتيب المشروع

صفحة **ER Diagram** أصبحت مخفية عن المستخدم حسب القرار الأخير، مع إبقاء ملفاتها محفوظة داخل المشروع.

لذلك مسار المستخدم أصبح:

```text
Schema Designer
→ Relationships
→ Exports
→ Deployment
```

هذا الملف يشرح **Exports**، والجلسة التالية ستكون **Deployment**.

---

## طريقة استخدام الدليل

- هذا الملف هو شرح الجلسة كاملًا، والشات للأسئلة.
- **سبق في الجلسات السابقة:** سأذكر المفهوم ثم أشرح استخدامه هنا.
- **مفهوم جديد:** يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة.

---

# المحتويات

1. الصورة العامة  
2. مكان Exports في Workflow  
3. ما المقصود بـDatabase Package  
4. الملفات والطبقات  
5. الصفحة والمسار  
6. ProjectExportsComponent  
7. Signals وحالة الصفحة  
8. تحميل Export Package  
9. Artifact Preview  
10. Copy to Clipboard  
11. Download داخل المتصفح  
12. Blob وObject URL  
13. MIME Types  
14. ForgeApiService  
15. ProjectsController  
16. Ownership وJWT  
17. ProjectService  
18. حالة عدم وجود Design  
19. التحقق قبل التصدير  
20. DesignValidationFailedException  
21. PrepareExportArtifactsAsync  
22. Design Snapshot  
23. Generator Resolver  
24. SQL Artifact  
25. ترتيب الجداول  
26. Circular Foreign Keys  
27. SQL Constraints وIndexes  
28. SQL Comments وTransactions  
29. DBML Artifact  
30. DBML Cardinality  
31. JSON Schema Artifact  
32. هل JSON الناتج Standard JSON Schema؟  
33. Relationship Report  
34. Evidence وMalformed JSON  
35. Data Quality Report  
36. ما الذي لا يحتويه تقرير الجودة  
37. ProjectExportPackageDto  
38. Status وGeneratedAt  
39. Artifact Count  
40. Refresh Behavior  
41. Export Readiness في Overview  
42. Validation Errors مقابل Warnings  
43. Stale Schema: السلوك الحالي  
44. Exports لا تخزن ملفات على السيرفر  
45. الفرق بين Export وDeployment  
46. المسارات الكاملة  
47. الحالات والأخطاء  
48. الاختبار العملي  
49. ملخص الحفظ  
50. تحسينات مؤجلة

---

# 1. الصورة العامة

في نهاية تصميم قاعدة البيانات، ForgeDB يحول `DesignModel` إلى ملفات قابلة للاستخدام خارج النظام.

```text
Validated Design
├── schema.sql
├── schema.dbml
├── schema.json
├── relationship-report.json
└── data-quality-report.json
```

المسار:

```text
Open Exports page
→ GET project export package
→ Verify project ownership
→ Load project datasets
→ Load current design
→ Build one design snapshot
→ Validate the snapshot
→ Generate SQL
→ Generate DBML
→ Generate JSON
→ Build relationship report
→ Build data-quality report
→ Return one API response
→ Preview / Copy / Download in Angular
```

---

# 2. مكان Exports في Workflow

المسار المنطقي بعد إخفاء ER Diagram:

```text
Import
→ Analysis
→ Cleaning
→ Confirm Quality
→ Schema Designer
→ Relationships
→ Validate Design
→ Exports
→ Deployment
```

Exports لا تعدل التصميم.

هي عملية:

```text
Read current state
→ generate text artifacts
→ return them
```

لذلك Endpoint المستخدمة:

```http
GET
```

وليست `POST` أو `PATCH`.

---

# 3. ما المقصود بـDatabase Package؟

> **مفهوم جديد**

Database Package في المشروع الحالي ليست ZIP محفوظة على السيرفر.

هي **API Response واحدة** تحتوي خمسة نصوص:

```text
SQL string
DBML string
JSON schema string
Relationship report JSON string
Data-quality report JSON string
```

Angular تعرضها كأنها ملفات مستقلة، ثم تنشئ ملفات محلية عند الضغط على Download.

## الشكل المنطقي

```json
{
  "projectId": 5,
  "projectName": "Sales Database",
  "status": "Database Package Ready",
  "generatedAt": "2026-07-18T...",
  "sql": "...",
  "dbml": "...",
  "jsonSchema": "...",
  "relationshipReportJson": "...",
  "dataQualityReportJson": "..."
}
```

---

# 4. الملفات والطبقات

## Frontend

```text
pages/project-exports/project-exports.component.ts
pages/project-exports/project-exports.component.html
services/forge-api.service.ts
services/file-download.service.ts
services/api.models.ts
services/workflow-state.service.ts
app.routes.ts
```

## Backend

```text
Controllers/ProjectsController.cs
Services/ProjectService.cs
Services/Interfaces/IProjectService.cs
Models/DTOs/ProjectWorkspaceDto.cs
Services/DesignService.cs
Services/Validation/DesignValidationService.cs
```

## Generators

```text
Services/Generators/SqlSchemaGenerator.cs
Services/Generators/DbmlGenerator.cs
Services/Generators/JsonSchemaGenerator.cs
Services/Generators/DesignSchemaGeneratorResolver.cs
Services/Generators/DesignModelSnapshot.cs
Services/Generators/SqlIdentifiers.cs
```

## المسار الطبقي

> **سبق:**  
> `Component → API Service → Controller → Service → Repository`.

في Exports:

```text
ProjectExportsComponent
→ ForgeApiService
→ ProjectsController
→ ProjectService
├── ProjectRepository
├── DesignService
│   ├── DesignRepository
│   ├── DesignValidationService
│   └── Generator Resolver
│       ├── SQL Generator
│       ├── DBML Generator
│       └── JSON Generator
└── RelationshipDetectionService
→ ProjectExportPackageDto
→ Angular FileDownloadService
```

---

# 5. الصفحة والمسار

Route:

```text
/projects/:projectId/exports
```

Component:

```text
ProjectExportsComponent
```

الصفحة تعرض:

- Project name.
- Package status.
- Generated timestamp.
- Artifact count.
- قائمة Artifacts.
- Preview tabs.
- Copy.
- Download current.
- Download كل Artifact.
- Refresh.
- رابط Schema Designer.

## Artifacts

```text
schema.sql
schema.dbml
schema.json
relationship-report.json
data-quality-report.json
```

---

# 6. ProjectExportsComponent

الكلاس بسيط مقارنة بصفحات Analysis وCleaning.

مسؤولياته:

1. قراءة `projectId`.
2. حفظ Project في WorkflowState.
3. جلب Package.
4. اختيار Preview.
5. حساب عدد Artifacts.
6. نسخ النص.
7. تنزيل النص كملف.

لا يدير:

- Design edits.
- Revision.
- `If-Match`.
- Validation mutation.
- Background jobs.
- Upload.

Exports صفحة قراءة وتنزيل فقط.

---

# 7. Signals وحالة الصفحة

## exportPackage

```ts
signal<ProjectExportPackage | null>(null)
```

تحفظ Response كاملة.

## loading

```ts
signal(false)
```

تتحكم في:

```text
Loading message
Refresh button
```

## activePreview

القيمة الافتراضية:

```text
sql
```

والخيارات:

```text
sql
dbml
json
relationships
quality
```

## copiedTarget

تحفظ أي Artifact تم نسخها:

```text
sql
dbml
json
relationships
quality
null
```

وتستخدم مؤقتًا لتغيير النص:

```text
Copy
→ Copied
```

## errorMessage

String عادية وليست Signal:

```ts
errorMessage = ''
```

تعمل لأن HTTP callbacks تحدث داخل Angular context، لكن توحيدها كـSignal سيكون أوضح مع `OnPush`.

---

# 8. تحميل Export Package

## ngOnInit

```text
read projectId
→ validate positive finite number
→ invalid: navigate /projects
→ workflow.setProjectId
→ loadPackage
```

## loadPackage()

```text
clear error
→ loading = true
→ GET export package
→ success: set exportPackage
→ error: set message
→ finalize: loading = false
```

> **سبق:** `finalize` تعمل عند النجاح أو الفشل.

## Endpoint

```http
GET /api/projects/{projectId}/exports/package
```

---

# 9. Artifact Preview

## previewText()

تقرأ `activePreview` وتعيد النص المناسب:

```text
dbml          → exportPackage.dbml
json          → exportPackage.jsonSchema
relationships → relationshipReportJson
quality       → dataQualityReportJson
default       → sql
```

## previewFileName()

تعيد الاسم المناسب:

```text
schema.sql
schema.dbml
schema.json
relationship-report.json
data-quality-report.json
```

## Preview area

تستخدم:

```html
<pre><code>{{ previewText(data) }}</code></pre>
```

هذا يعني:

- النص لا يُفسر كـHTML.
- Formatting والمسافات تبقى.
- المستخدم يرى المحتوى كما سيُنزل.

## Tabs

اختيار Tab لا يرسل API Request جديدة.

هي فقط تغير:

```ts
activePreview.set(...)
```

لأن كل Artifacts موجودة أصلًا داخل Package.

---

# 10. Copy to Clipboard

```ts
navigator.clipboard.writeText(content)
```

ترجع Promise.

## النجاح

```text
copiedTarget = target
wait 2 seconds
copiedTarget = null
```

فتظهر:

```text
Copied
```

لمدة ثانيتين.

## الفشل

```text
Unable to copy in this browser.
```

## متى قد تفشل Clipboard API؟

- Browser لا يدعمها.
- الصفحة ليست في Secure Context في بيئة غير localhost.
- المستخدم رفض الصلاحية.
- Policy في الجهاز تمنع Clipboard.

## ملاحظة

Localhost يُعامل غالبًا كSecure Context لأغراض التطوير.

---

# 11. Download داخل المتصفح

`download()` لا تستدعي Backend.

```ts
this.fileDownload.downloadText(
  fileName,
  content,
  mimeType
);
```

أي أن Content وصلت سابقًا ضمن Package، والتنزيل Client-side.

## الفوائد

- لا يحتاج Endpoint منفصلة لكل ملف.
- لا يحتاج تخزين مؤقت على السيرفر.
- لا يحتاج إدارة File cleanup.
- المستخدم ينزل فورًا.

## الحدود

- كل المحتوى موجود في ذاكرة Browser.
- Package الكبيرة قد تستهلك ذاكرة.
- لا يوجد Streaming.
- لا يوجد ZIP حقيقي.
- لا يوجد Progress للتنزيل.

---

# 12. Blob وObject URL

> **مفهوم جديد**

`FileDownloadService` تنفذ:

```ts
const blob = new Blob([content], { type: mimeType });
```

## Blob

كائن يمثل Bytes/File-like data داخل المتصفح.

ثم:

```ts
const url = URL.createObjectURL(blob);
```

ينشئ URL مؤقت مثل:

```text
blob:http://localhost:4200/...
```

ثم ينشئ `<a>`:

```ts
anchor.href = url;
anchor.download = fileName;
anchor.click();
```

المتصفح يبدأ التنزيل.

بعدها:

```ts
URL.revokeObjectURL(url)
```

لتحرير الذاكرة.

## لماذا يضاف Anchor إلى document؟

بعض المتصفحات تتعامل بشكل أكثر ثباتًا مع Click إذا العنصر موجود فعليًا في DOM.

---

# 13. MIME Types

> **مفهوم جديد صغير**

MIME Type تصف نوع المحتوى للمتصفح.

## SQL

```text
text/sql;charset=utf-8
```

## DBML

```text
text/plain;charset=utf-8
```

## JSON

```text
application/json;charset=utf-8
```

## Download Current

الزر الحالي يستخدم:

```text
text/plain;charset=utf-8
```

لجميع الأنواع، حتى JSON وSQL.

هذا لا يغير محتوى الملف، لكنه أقل دقة من استخدام MIME المناسب حسب Tab.

سنسجلها ضمن التحسينات.

---

# 14. ForgeApiService

> **سبق:** ForgeApiService تعرف HTTP فقط، والComponent تدير واجهة المستخدم.

Method:

```ts
getProjectExportPackage(
  projectId: number
): Observable<ProjectExportPackage>
```

تستدعي:

```http
GET /api/projects/{projectId}/exports/package
```

لا ترسل:

- Revision.
- Request body.
- Format parameter.
- File name.
- Download flag.

لأن Endpoint تعيد كل Formats مرة واحدة.

---

# 15. ProjectsController

Action:

```csharp
[HttpGet("{projectId:int}/exports/package")]
```

المسار:

```text
EnsureOwnedProjectAsync
→ ProjectService.GetProjectExportPackageAsync
→ 200 OK
```

## Error mapping

```text
ArgumentException       → 400
UnauthorizedAccess      → 403
KeyNotFound             → 404
DesignValidationFailed  → 422
```

## لماذا 422؟

> **سبق في API Import:** `422 Unprocessable Entity`.

هنا Request صحيحة، وProject موجودة، لكن Design الحالية لا يمكن تحويلها إلى Package صالحة بسبب Validation errors.

---

# 16. Ownership وJWT

> **سبق في Projects وRelationships.**

قبل التصدير:

```text
Project ID from URL
→ ProjectRepository.GetByIdAsync
→ compare Project.UserId with JWT user ID
```

إذا Project لمستخدم آخر:

```text
403 Forbidden
```

إذا لا توجد Project:

- Ownership helper لا ترمي Forbidden.
- Service ترمي `KeyNotFoundException`.
- Controller تعيد `404`.

هذا يمنع تغيير URL لتصدير Project شخص آخر.

---

# 17. ProjectService

الدالة الرئيسية:

```csharp
GetProjectExportPackageAsync(projectId)
```

المسار:

```text
Load project workspace
→ Build data-quality JSON
→ Prepare design export artifacts
→ no design: return empty package
→ validate artifacts
→ errors: throw
→ load relationship suggestions
→ build relationship report
→ return ready package
```

Dependencies المستخدمة:

```text
IProjectRepository
IDesignService
IRelationshipDetectionService
ICleaningRepository
```

في Export الفعلي تستخدم:

- ProjectRepository.
- DesignService.
- RelationshipDetectionService.

CleaningRepository تستخدم في أجزاء Overview، وليست مباشرة في بناء Package الحالية.

---

# 18. حالة عدم وجود Design

إذا:

```text
PrepareExportArtifactsAsync
→ null
```

الخدمة لا ترمي Error.

تعيد `200 OK` مع:

```text
Status:
Upload datasets and generate a design to build a package

SQL = ""
DBML = ""
JSON = ""
RelationshipReport = []
DataQualityReport = current datasets report
```

## النتيجة في الواجهة

- Page تفتح.
- Artifact count قد يكون 1 فقط، لأن Data Quality Report غير فارغة.
- أزرار الملفات الأخرى موجودة، لكنها قد تنزل ملفات فارغة.

هذا هو السلوك الحالي، وليس منعًا كاملًا لفتح Exports.

---

# 19. التحقق قبل التصدير

إذا توجد Design:

```text
Build snapshot
→ DesignValidationService.Validate(snapshot)
```

ثم ProjectService تفصل:

```text
issues where severity == error
```

إذا يوجد Error واحد أو أكثر:

```text
throw DesignValidationFailedException
```

لا تُعاد Package للمستخدم.

## أمثلة Errors

```text
Duplicate table name
Invalid identifier
Zero-column table
Duplicate column
Unsupported SQL type
Nullable primary key
Invalid identity
Invalid default
Missing relationship endpoint
FK target not key
FK type mismatch
```

## Warnings

لا تمنع Export.

مثل:

```text
Table without primary key
Table without unique constraint
Isolated table
TEXT unbounded
Nullable foreign key
Renamed generated item
```

---
# 20. DesignValidationFailedException

Exception متخصصة تحمل:

```text
Message
Issues
```

Controller تعيد:

```json
{
  "message": "...",
  "issues": [...]
}
```

لكن Frontend الحالية تعرض غالبًا:

```text
error.error?.message
```

ولا تعرض قائمة Issues بالتفصيل داخل صفحة Exports.

لذلك المستخدم قد يعرف أن التصميم غير صالح، لكنه يحتاج العودة إلى Schema Designer لرؤية المشاكل.

---

# 21. PrepareExportArtifactsAsync

داخل `DesignService`:

```text
Get full design by project
→ null if absent
→ BuildSnapshot
→ Validate snapshot
→ Generate SQL
→ Generate DBML
→ Generate JSON
→ return relationships and issues
```

Result:

```text
DesignId
Revision
ValidationIssues
Relationships
Sql
Dbml
Json
```

## نقطة مهمة

نفس Snapshot تدخل إلى:

- Validation.
- SQL Generator.
- DBML Generator.
- JSON Generator.

هذا يقلل اختلاف النتائج بين Validation والتصدير.

---

# 22. Design Snapshot

> **سبق في Schema Designer:** Snapshot هي نسخة قراءة مستقلة عن EF Entity.

تشمل:

```text
Project metadata
Design revision
Generated date
Tables
Columns
Relationships
```

كل Generator لا تحتاج:

- DbContext.
- Tracking.
- Navigation loading.
- Repository access.

تحتاج Model جاهزة فقط.

## الفائدة

```text
Pure input
→ deterministic text output
```

هذا يسهل:

- Unit testing.
- إعادة الاستخدام.
- منع تغييرات قاعدة البيانات أثناء التوليد.
- توحيد Preview وExport.

---

# 23. Generator Resolver

`DesignSchemaGeneratorResolver` تستقبل كل Generators المسجلة في DI.

في `Program.cs`:

```text
SqlSchemaGenerator
DbmlGenerator
JsonSchemaGenerator
```

كل واحدة تعرف:

```text
Format
Generate(snapshot)
```

Resolver تبني Dictionary:

```text
sql  → SqlSchemaGenerator
dbml → DbmlGenerator
json → JsonSchemaGenerator
```

ثم:

```csharp
Generate("sql", snapshot)
```

## Format matching

غير حساسة لحالة الأحرف:

```text
SQL
sql
Sql
```

كلها تجد نفس Generator.

## Unsupported format

ترمي:

```text
ArgumentException
```

وتذكر Formats المدعومة.

---

# 24. SQL Artifact

`schema.sql` هي PostgreSQL DDL.

تحتوي حسب التصميم:

```text
BEGIN
CREATE TABLE
Columns
Identity
Default
NOT NULL
UNIQUE
PRIMARY KEY
FOREIGN KEY
ON DELETE
CREATE INDEX
COMMENT ON TABLE
COMMIT
```

مثال مبسط:

```sql
BEGIN;

CREATE TABLE customers (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    PRIMARY KEY (id)
);

COMMIT;
```

## ليست Seed Data

`schema.sql` في Export Package هي Schema DDL فقط.

لا تحتوي Rows المستوردة كـ`INSERT` في المسار الحالي.

Seed SQL تأتي ضمن Deployment workflow، وستشرح في الجلسة التالية.

---

# 25. ترتيب الجداول

> **سبق في Schema Designer:** Topological ordering.

إذا:

```text
orders.customer_id
→ customers.id
```

يجب إنشاء:

```text
customers
قبل
orders
```

Generator تبني Dependency graph.

ثم DFS بحالات:

```text
unvisited
visiting
visited
```

وتعيد ترتيب Tables حسب التبعيات.

## الفائدة

Foreign Key يمكن وضعها داخل:

```sql
CREATE TABLE orders (...)
```

لأن Target table موجودة مسبقًا.

---

# 26. Circular Foreign Keys

إذا:

```text
table_a → table_b
table_b → table_a
```

لا يوجد ترتيب يرضي العلاقتين.

Generator تكتشف Cycle.

ثم تستخدم:

```text
CREATE all tables without FKs
→ ALTER TABLE ADD CONSTRAINT for every FK
```

مثال:

```sql
ALTER TABLE table_a
ADD CONSTRAINT fk_table_a_b_id
FOREIGN KEY (b_id)
REFERENCES table_b(id);
```

هذا يمنع فشل DDL بسبب ترتيب الإنشاء.

---

# 27. SQL Constraints وIndexes

## Identity

```sql
GENERATED BY DEFAULT AS IDENTITY
```

## Default

```sql
DEFAULT 'active'
```

## NOT NULL

تضاف إذا:

```text
IsNullable = false
```

## UNIQUE

تضاف للColumn إذا:

```text
IsUnique = true
AND
not Primary Key
```

## Primary Key

تضاف كTable constraint:

```sql
PRIMARY KEY (id)
```

وتدعم Composite PK:

```sql
PRIMARY KEY (order_id, line_number)
```

## Foreign Key

```sql
FOREIGN KEY (customer_id)
REFERENCES customers(id)
ON DELETE NO ACTION
```

## Index

لكل Foreign Key ينشئ:

```sql
CREATE INDEX ix_orders_customer_id
ON orders(customer_id);
```

الهدف تحسين Join وLookup المرتبط بالعلاقة.

---

# 28. SQL Comments وTransactions

## Table Comments

إذا `DesignTable.Comment` موجود:

```sql
COMMENT ON TABLE customers
IS 'Customer master data';
```

Single quote داخل التعليق تُهرب:

```text
'
→ ''
```

## BEGIN / COMMIT

الملف يبدأ:

```sql
BEGIN;
```

وينتهي:

```sql
COMMIT;
```

الهدف تنفيذ DDL داخل Transaction واحدة عند دعم PostgreSQL للعملية.

إذا فشل Statement:

```text
يمكن Rollback بدل ترك Schema نصف منشأة
```

لكن SQL Artifact نفسها لا تحتوي:

```sql
ROLLBACK;
```

فالعميل/أداة التنفيذ تتعامل مع الفشل.

---

# 29. DBML Artifact

`schema.dbml` تستخدم مع أدوات مثل:

```text
dbdiagram.io
```

المحتوى يبدأ:

```dbml
Project ProjectName {
  database_type: "PostgreSQL"
}
```

ثم:

```dbml
Table customers {
  id integer [pk, not null, increment]
  email text [unique]
}
```

## Column settings

```text
pk
unique
not null
increment
default
```

## Table note

إذا يوجد Comment:

```dbml
Note: 'Customer master data'
```

---

# 30. DBML Cardinality

العلاقات:

## Many-to-one

```dbml
Ref: orders.customer_id > customers.id
```

العلامة:

```text
>
```

## One-to-one

```dbml
Ref: users.id - user_profiles.user_id
```

العلامة:

```text
-
```

## ملاحظة

`OnDelete` لا تظهر في DBML Generator الحالية.

SQL وJSON يحفظانها، لكن DBML الحالية تعرض العلاقة والCardinality فقط.

هذه نقطة مهمة عند مقارنة Formats.

---

# 31. JSON Schema Artifact

`schema.json` تحتوي Document منظم.

الجذر:

```text
formatVersion
tables
relationships
metadata
```

## Table

```text
id
name
comment
columns
```

## Column

```text
id
name
sqlType
isNullable
isPrimaryKey
isUnique
defaultValue
isAutoIncrement
ordinal
```

## Relationship

```text
id
fromTable
fromColumn
toTable
toColumn
cardinality
onDelete
```

## Metadata

```text
projectId
revision
generatedAt
```

وتستخدم:

```text
WriteIndented = true
```

فتكون قابلة للقراءة.

---

# 32. هل JSON الناتج Standard JSON Schema؟

> **مفهوم مهم لتجنب اللبس**

اسم الخاصية في API:

```text
JsonSchema
```

واسم الملف:

```text
schema.json
```

لكن المحتوى الحالي ليس معيار JSON Schema الرسمي مثل:

```text
$schema
type
properties
required
definitions
```

هو **ForgeDB Design JSON format** موثق ومهيكل.

أي:

```text
Application-specific schema representation
```

وليس مباشرة ملفًا صالحًا لكل أدوات JSON Schema Validation.

`formatVersion = 1` تسمح للنظام بتطوير تنسيقه مستقبلًا.

---

# 33. Relationship Report

`relationship-report.json` تجمع Suggestions كلها، لا العلاقات المقبولة فقط.

لكل Suggestion:

```text
suggestionId
sourceTable
sourceColumn
targetTable
targetColumn
score
status
decidedAt
createdAt
evidence
relationship
```

## status

يمكن:

```text
suggested
accepted
rejected
```

## relationship

إذا Suggestion مرتبطة بـDesignRelationship:

```text
id
fromTableName
fromColumnName
toTableName
toColumnName
cardinality
onDelete
```

إذا لا:

```json
null
```

## Manual relationships

العلاقة اليدوية التي لا تحتوي `SuggestionId` تدخل في SQL/DBML/JSON Design، لكنها لا تظهر كعنصر مستقل داخل Relationship Report الحالية لأن التقرير يبدأ من Suggestions.

هذه نقطة مهمة.

---

# 34. Evidence وMalformed JSON

Suggestion تحفظ:

```text
EvidenceJson
```

ProjectService تحاول:

```text
JsonDocument.Parse
```

إذا صحيحة:

```text
evidence = parsed JSON object
```

إذا فارغة أو تالفة:

```text
evidence = null
```

ولا تفشل Package كاملة.

> **سبق في Relationships:** الأدلة تشمل Reasons وOverlap ومؤشرات الاسم والKey.

هذا يسمى:

```text
Tolerant report generation
```

أي تقرير واحد لا ينهار بسبب Evidence قديمة تالفة.

---

# 35. Data Quality Report

`data-quality-report.json` تبنى من `Project.Datasets`.

لكل Dataset:

```text
datasetId
tableName
rowCount
columnCount
missingValuesCount
duplicateRowsCount
status
analyzedAt
```

الترتيب:

```text
tableName case-insensitive
```

مثال:

```json
[
  {
    "datasetId": 15,
    "tableName": "customers",
    "rowCount": 1000,
    "columnCount": 8,
    "missingValuesCount": 12,
    "duplicateRowsCount": 2,
    "status": "Analyzed",
    "analyzedAt": "..."
  }
]
```

## مصدر الأرقام

من Dataset Entity الحالية.

إذا Active cleaned version مطبقة بشكل صحيح على Dataset metadata، فالأرقام تعكس النسخة الحالية.

---

# 36. ما الذي لا يحتويه تقرير الجودة؟

التقرير الحالي Summary فقط.

لا يحتوي:

```text
Missing values by column
Numeric min/max/average
Most common values
Type distribution
Outliers
Cleaning operations
Version history
Quality confirmation metadata
Chart recommendations
```

هذه معلومات موجودة في Analysis/Cleaning features، لكنها غير مضمنة في Export report الحالية.

اسم:

```text
data-quality-report
```

قد يوحي بتقرير أوسع من المحتوى الحالي؛ لذلك من الأفضل فهم أنه:

```text
Dataset-level quality summary
```

---

# 37. ProjectExportPackageDto

Backend DTO:

```text
ProjectId
ProjectName
Status
GeneratedAt
Sql
Dbml
JsonSchema
RelationshipReportJson
DataQualityReportJson
```

> **سبق:** DTO تمنع إرسال Entities وNavigation properties مباشرة.

Frontend `ProjectExportPackage` تطابق هذه الحقول.

## لماذا Reports Strings وليست Objects؟

لأنها Artifacts جاهزة للتنزيل.

لو كانت Objects، Angular ستحتاج:

```text
JSON.stringify
```

أما الباك إند فيعيد النص النهائي المنسق مباشرة.

---

# 38. Status وGeneratedAt

## Design موجودة وصالحة

```text
Status = Database Package Ready
```

## لا توجد Design

```text
Status =
Upload datasets and generate a design to build a package
```

## GeneratedAt

تستخدم:

```text
DateTime.UtcNow
```

وقت بناء Response.

لا تعني بالضرورة:

- وقت إنشاء Design.
- وقت Validation.
- وقت حفظ ملف في Database.

هي:

```text
وقت توليد Package الحالية
```

---

# 39. Artifact Count

Frontend تحسب:

```ts
[
  sql,
  dbml,
  jsonSchema,
  relationshipReportJson,
  dataQualityReportJson
]
.filter(content => content.trim().length > 0)
.length
```

## Package جاهزة

غالبًا:

```text
5 artifacts
```

## بلا Design

قد تكون:

```text
1 artifact
```

لأن:

```text
relationship report = "[]"
data quality report = "[]"
```

حتى `"[]"` تعتبر non-empty.

في الواقع قد يصبح العدد 2 حتى لو لا توجد Datasets، لأن تقريري العلاقات والجودة Strings غير فارغة.

هذا يوضح أن Artifact count تقيس:

```text
Non-empty text fields
```

وليست بالضرورة Files مفيدة أو جاهزة.

---

# 40. Refresh Behavior

كل ضغط Refresh:

```text
GET package again
→ generators run again
→ reports rebuild
→ generatedAt changes
```

لا تستخدم Cache داخل Component.

## متى يفيد Refresh؟

- بعد تعديل Schema.
- بعد Validation.
- بعد قبول/حذف Relationship.
- بعد Re-analysis.
- بعد Cleaning.
- بعد تغيير Project data.

## ملاحظة

إذا Page بقيت مفتوحة بينما تغير المشروع في Tab أخرى، المحتوى لا يتحدث تلقائيًا حتى Refresh.

---

# 41. Export Readiness في Overview

Project Overview تحسب Status منفصلة:

```text
Upload datasets
Analyze datasets
Generate design
Ready
Ready without accepted relationships
```

## المنطق الحالي

```text
No datasets
→ Upload datasets

Any dataset status != Analyzed
→ Analyze datasets

No design
→ Generate design

Accepted relationship > 0
→ Ready

Otherwise
→ Ready without accepted relationships
```

## ملاحظة

هذا Readiness label لا يفحص كل شروط Export الفعلية مثل:

- Design validation errors.
- Stale source versions.
- Cleaning confirmation الدقيقة.
- Current Revision status.

لذلك هو مؤشر عام، وليس ضمانًا أن Export Endpoint ستنجح.

---

# 42. Validation Errors مقابل Warnings

## Errors

توقف Package:

```text
HTTP 422
```

## Warnings

Package تُولد عادي.

مثال:

```text
Table without PK
```

قد يولد SQL صالح PostgreSQL، لكنه تصميم ضعيف.

## لماذا Warnings لا تمنع؟

لأن بعض القرارات تعتمد على Context.

مثل:

- Staging table قد لا تحتاج PK.
- Nullable FK قد تكون مقصودة.
- TEXT قد تكون مناسبة.
- Isolated table قد تكون صحيحة.

---

# 43. Stale Schema: السلوك الحالي

> **مهم جدًا لأنه يوضح فرقًا بين Schema Validation وExport path الحالي**

في Schema Designer، `ValidateSchemaAsync` تفحص:

```text
IsStaleAsync
```

وتضيف Error إذا Design مبنية على Dataset Versions قديمة.

لكن `PrepareExportArtifactsAsync` الحالية تعمل:

```text
BuildSnapshot
→ DesignValidationService.Validate(snapshot)
```

و`DesignValidationService` لا تملك Repository أو Active Version information.

لذلك Export Package الحالية:

- تفحص أخطاء التصميم البنيوية.
- **لا تجري فحص Stale versions صريحًا داخل هذا المسار.**
- لا تشترط صراحة أن `Design.Status == Valid`.

هذا يعني نظريًا أن Design بنيوية صحيحة لكنها Draft أو Stale قد تنتج Package.

هذه فجوة حالية، ومسجلة ضمن التحسينات.

## السلوك الآمن المقترح

قبل التصدير يجب التحقق من:

```text
Design.Status == Valid
AND
not stale
AND
current revision was validated
```

---

# 44. Exports لا تخزن ملفات على السيرفر

لا توجد Entity اسمها مثل:

```text
ProjectExportFile
ExportPackageHistory
```

في المسار الحالي.

كل Request:

```text
generates strings in memory
→ sends JSON response
```

ثم المتصفح يصنع الملفات.

## النتائج

لا يوجد:

- Export history.
- Saved package ID.
- Re-download نسخة قديمة.
- Package checksum.
- Signed URL.
- Server-side ZIP.
- Expiration.

---

# 45. الفرق بين Export وDeployment

> **مفهوم مهم قبل الجلسة التالية**

## Export

```text
Generate files
→ user downloads them
```

لا تتصل بقاعدة بيانات خارجية.

لا تنفذ SQL.

## Deployment

```text
Generate deployment SQL
→ may connect to target PostgreSQL
→ create schema/tables
→ possibly seed rows
→ save deployment result/history
```

Exports آمنة من ناحية التنفيذ؛ هي Read-only generation.

Deployment عملية فعلية قد تغير Database target.

---

# 46. المسارات الكاملة

## فتح الصفحة

```text
/projects/5/exports
→ ngOnInit
→ validate projectId
→ WorkflowState projectId
→ GET exports/package
```

## Backend package

```text
ownership check
→ load project with datasets
→ build quality report
→ load design
→ no design:
   empty schema artifacts + reports
→ design exists:
   build snapshot
   validate structural design
   generate SQL/DBML/JSON
   load suggestions
   link accepted relationships
   serialize relationship report
→ return package
```

## Preview

```text
all artifacts already loaded
→ activePreview changes
→ previewText chooses string
→ no backend request
```

## Copy

```text
navigator.clipboard.writeText
→ copied state for 2 seconds
```

## Download

```text
content string
→ Blob
→ Object URL
→ temporary anchor
→ browser download
→ revoke URL
```

---

# 47. الحالات والأخطاء

## Frontend states

```text
loading
loaded package
error message
no package loaded
copied target
active preview
```

## HTTP Codes

| Code | المعنى |
|---:|---|
| 200 | Package جاهزة أو Empty-design package |
| 400 | Project ID أو Input غير صالح |
| 401 | JWT غير موجودة/صالحة |
| 403 | Project ليست للمستخدم |
| 404 | Project غير موجودة |
| 422 | Design validation errors تمنع Package |

## Frontend Errors

```text
Unable to load export package.
Unable to copy in this browser.
```

إذا Backend أرسلت Message:

```text
تستخدمها بدل الرسالة العامة
```

## لا يوجد Error مستقل للتنزيل

`Blob` download method لا تمسك Exceptions حاليًا.

---

# 48. الاختبار العملي

## Route وOwnership

- Project ID صحيح.
- ID غير صالح.
- Project غير موجودة.
- Project مستخدم آخر.
- JWT منتهية.
- Refresh.

## بلا Design

- Project بلا Datasets.
- Project بـDatasets بلا Design.
- Status الصحيحة.
- SQL/DBML/JSON فارغة.
- Reports موجودة.
- Artifact count الفعلي.

## Validation

- Duplicate table.
- Invalid identifier.
- Unsupported type.
- Nullable PK.
- Invalid default.
- FK target not key.
- FK type mismatch.
- Warning-only design تصدر.
- 422 تعرض Message.

## SQL

- Table واحدة.
- عدة Tables.
- Identity.
- Default.
- NOT NULL.
- Unique.
- Composite PK.
- FK.
- Index.
- Cascade.
- Set Null.
- No Action.
- Circular dependency.
- Table comment.
- Escaped apostrophe.
- BEGIN/COMMIT.

## DBML

- Project header.
- Safe identifier.
- Quoted identifier.
- PK.
- Unique.
- Not null.
- Increment.
- Default.
- Table note.
- Many-to-one marker.
- One-to-one marker.
- ملاحظة غياب On Delete.

## JSON

- `formatVersion = 1`.
- Tables.
- Columns.
- Relationships.
- Metadata.
- Null default محفوظ.
- Indented output.
- Revision الصحيحة.

## Relationship report

- Pending suggestion.
- Accepted suggestion.
- Rejected suggestion.
- Accepted linked relationship.
- Invalid Evidence JSON.
- Manual relationship غير مرتبطة Suggestion.
- Score/DecidedAt/CreatedAt.

## Quality report

- عدة Datasets.
- ترتيب Alphabetical.
- Missing.
- Duplicates.
- Status.
- AnalyzedAt null.
- بيانات Cleaned current metadata.

## Frontend

- Tabs.
- Preview file name.
- Copy success.
- Copy failure.
- Copied reset after 2 sec.
- Download each artifact.
- Download current.
- File names.
- MIME types.
- Object URL revoked.
- Package update after Refresh.

## Stale behavior

- Generate/validate Design.
- Apply new Cleaning Version.
- افتح Exports.
- تحقق من السلوك الحالي.
- سجل أن Endpoint تحتاج Stale gate أقوى.

---

# 49. ملخص الحفظ السريع

## Package

```text
One GET response
=
SQL
+ DBML
+ Design JSON
+ Relationship report
+ Quality report
```

## Frontend

```text
load once
→ switch preview locally
→ copy with Clipboard API
→ download with Blob
```

## Backend

```text
ProjectService
→ DesignService
→ snapshot
→ validation
→ generator resolver
→ SQL/DBML/JSON
→ reports
```

## SQL

```text
PostgreSQL DDL
tables
constraints
relationships
indexes
comments
transaction
```

## DBML

```text
dbdiagram-friendly
tables
column settings
relationship markers
```

## JSON

```text
ForgeDB-specific versioned design document
not official JSON Schema standard
```

## Reports

```text
Relationship report:
suggestions + decisions + linked accepted relationship

Quality report:
dataset-level counts and status
```

## مفاهيم جديدة

```text
Database package
Client-side file generation
Blob
Object URL
MIME type
Clipboard API
Generator resolver
Multiple formats from one snapshot
Tolerant report serialization
Application-specific JSON schema
```

## مفاهيم سبقت

```text
Signals
finalize
DTO
JWT ownership
Design validation
SQL generation
DBML
Relationships
Dataset quality metrics
Stale schema
```

---

# 50. تحسينات مؤجلة

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. منع Export إذا `Design.Status != Valid`.
2. فحص `IsStaleAsync` داخل `PrepareExportArtifactsAsync`.
3. ربط Package بـRevision التي تم Validation عليها.
4. عرض Validation Issues كاملة في صفحة Exports عند 422.
5. تعطيل Download للArtifact الفارغة.
6. تحسين Artifact count حتى يقيس Artifacts الجاهزة فعليًا.
7. استخدام MIME الصحيح في `Download Current`.
8. إضافة Download All كملف ZIP.
9. إنشاء أسماء ملفات تحتوي Project name وRevision.
10. إضافة checksum لكل Artifact.
11. حفظ Export history ووقت وRevision.
12. دعم إعادة تنزيل Package قديمة.
13. إضافة `README.md` داخل Package يشرح الملفات.
14. إضافة Migration SQL منفصلة عن Fresh CREATE SQL.
15. إضافة Seed data export اختياري.
16. توسيع Data Quality Report بتفاصيل الأعمدة والAnalysis.
17. إضافة Cleaning history report.
18. إضافة Manual relationships غير المرتبطة Suggestions إلى Relationship Report.
19. إضافة On Delete settings إلى DBML إذا الصيغة/الأداة تدعمها.
20. توضيح اسم `jsonSchema` إلى `designJson` لتجنب اللبس مع معيار JSON Schema.
21. إضافة JSON Schema standard export كFormat منفصلة إذا مطلوبة.
22. Streaming أو compressed response للPackages الكبيرة.
23. Server-side download endpoints للملفات الكبيرة.
24. Cache حسب `Design Revision + Dataset Version IDs`.
25. تحديث تلقائي أو تنبيه إذا تغيرت Revision في Tab أخرى.
26. التعامل مع Exceptions داخل FileDownloadService.
27. اختبار تكامل يثبت تطابق SQL Preview مع Export SQL.
28. اختبار Snapshot ثابت لكل Generator.
29. إظهار Design revision وstatus في صفحة Exports.
30. إضافة زر مباشر إلى Deployment بعد التأكد من Valid/Non-stale state.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. ما المقصود بـDatabase Package في ForgeDB.
2. لماذا Package ليست ZIP محفوظة على السيرفر.
3. كيف تجلب Angular كل Artifacts بطلب واحد.
4. كيف تعمل Preview بدون Requests إضافية.
5. كيف تعمل Clipboard API.
6. كيف يعمل Blob وObject URL والتنزيل.
7. كيف يتحقق Controller من Ownership.
8. لماذا Validation errors تعيد 422.
9. كيف تستخدم Generators نفس Design Snapshot.
10. ماذا يحتوي schema.sql.
11. كيف يعالج SQL Generator ترتيب الجداول والCycles.
12. ماذا يحتوي DBML وما معنى `>` و`-`.
13. لماذا `schema.json` ليست معيار JSON Schema الرسمي.
14. كيف يبنى Relationship Report.
15. ماذا يحتوي Data Quality Report وما الذي لا يحتويه.
16. الفرق بين Warnings وErrors في Export.
17. الفرق بين Export وDeployment.
18. ما فجوة Stale/Valid checks الحالية في Export path.
