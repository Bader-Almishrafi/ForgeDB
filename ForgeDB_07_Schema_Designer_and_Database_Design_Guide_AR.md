# ForgeDB — دليل جلسة Schema Designer & Database Design الكامل

> **الجلسة رقم 07 — Schema Designer / Database Design**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم تحويل الـDatasets المؤكدة إلى تصميم قاعدة بيانات PostgreSQL، تعديل الجداول والأعمدة والقيود، حفظ Draft، توليد SQL، Validation، Revision و`If-Match`، واكتشاف أن الـSchema أصبحت قديمة بعد تغير Dataset Versions.

---

## طريقة استخدام الدليل

- هذا الملف هو شرح الجلسة كاملًا، والشات للأسئلة.
- **سبق في الجلسات السابقة:** سأذكر المفهوم ثم أشرح استخدامه هنا.
- **مفهوم جديد:** يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة.

---

# المحتويات

1. الصورة العامة  
2. مكان Schema Designer في Workflow  
3. الفرق بين Dataset وDesignModel  
4. الفرق بين DatasetColumn وDesignColumn  
5. شرط Schema Ready  
6. الصفحة والمسارات  
7. الملفات والطبقات  
8. DesignModel وTables وColumns  
9. Source Dataset Versions  
10. ProjectSchemaDesignerComponent  
11. Signals وComputed  
12. Local Draft مقابل Persisted Design  
13. Dirty State  
14. تحميل Workspace  
15. Generate Schema  
16. ماذا يحدث عند Regenerate  
17. توليد أسماء الجداول والأعمدة  
18. تحويل أنواع التحليل إلى PostgreSQL  
19. خصائص العمود القابلة للتعديل  
20. PostgreSQL Identifiers  
21. أنواع البيانات المدعومة  
22. VARCHAR Length  
23. Nullable  
24. Primary Key  
25. Unique  
26. Default Value  
27. Auto Increment / Identity  
28. Client-side Draft Validation  
29. Save Draft  
30. Backend Save Validation  
31. Draft وValid وInvalid  
32. Validate Schema  
33. Errors وWarnings  
34. Table Validation Rules  
35. Column Validation Rules  
36. Relationship Validation Rules  
37. Stale Schema  
38. SourceVersionsJson  
39. canContinue  
40. Tabs: Tables / SQL / Constraints  
41. Live SQL Preview  
42. Backend SQL Verification  
43. SQL Generation Structure  
44. Table Ordering  
45. Circular Dependencies  
46. Identifier Quoting  
47. Foreign Keys وIndexes  
48. Design Revision وIf-Match  
49. Concurrency Conflict Recovery  
50. Unsaved Changes Guard  
51. DesignController  
52. DesignService  
53. DesignRepository  
54. DTOs وEntities  
55. Origin: Generated / User / Accepted Suggestion  
56. حدود الواجهة الحالية مقابل Design API  
57. المسارات الكاملة  
58. الحالات والأخطاء  
59. الاختبار العملي  
60. ملخص الحفظ  
61. تحسينات مؤجلة

---

# 1. الصورة العامة

Schema Designer تحول البيانات الديناميكية المستوردة إلى **تصميم قاعدة بيانات حقيقي**.

قبل هذه المرحلة، ForgeDB يخزن البيانات بهذا الشكل:

```text
Dataset
DatasetColumn
DatasetRow JSON
```

بعد توليد الـSchema، يصبح لدينا نموذج تصميم:

```text
DesignModel
├── DesignTable
│   └── DesignColumn
└── DesignRelationship
```

مثال:

```text
Dataset:
customers.csv

Generated Design:
customers
├── id          INTEGER
├── name        TEXT
├── email       TEXT
└── created_at  TIMESTAMP
```

ثم المستخدم يحدد:

```text
Primary Key
Unique
Nullable / NOT NULL
Default
Auto Increment
PostgreSQL data type
Final names
```

---

# 2. مكان Schema Designer في Workflow

الترتيب الفعلي في المشروع الحالي:

```text
Import
→ Analysis
→ Cleaning
→ Re-analysis
→ Confirm Quality
→ Generate Schema
→ Edit and Validate Schema
→ Review Relationships
→ Revalidate after relationship changes
→ ER Diagram
→ Export / Deployment
```

مهم:

> العلاقات تحتاج Tables وColumns محفوظة داخل DesignModel، لذلك توليد الـSchema يسبق قبول العلاقات.

بعد إضافة أو تعديل Relationships، Design تعود إلى `Draft` وتحتاج Validation جديدة.

---

# 3. الفرق بين Dataset وDesignModel

> **سبق في Dataset Import:** Dataset تمثل مصدر بيانات واحدًا داخل المشروع.

## Dataset

تمثل البيانات الحالية:

```text
Rows
Columns
Detected types
Missing values
Duplicates
Active version
Analysis result
```

هي مصدر معلومات، وليست تصميم PostgreSQL نهائيًا.

## DesignModel

تمثل مخطط قاعدة البيانات الذي سيستخدم في:

```text
SQL
DBML
ER Diagram
Export
Deployment
```

تحتوي:

```text
Revision
Status
SourceVersionsJson
Tables
Relationships
GeneratedAt
ValidatedAt
```

## العلاقة

```text
Confirmed active Dataset Versions
→ Generate
→ DesignModel
```

DesignModel لا تستبدل Dataset؛ هي **تصميم مبني عليها**.

---

# 4. الفرق بين DatasetColumn وDesignColumn

## DatasetColumn

Profile ناتج عن Import/Analysis:

```text
ColumnName
DetectedDataType
MissingValuesCount
UniqueValuesCount
IsNullable
SampleValues
```

## DesignColumn

قرار قاعدة بيانات:

```text
Name
SqlType
IsNullable
IsPrimaryKey
IsUnique
DefaultValue
IsAutoIncrement
Ordinal
SourceColumnName
Origin
```

مثال:

```text
DatasetColumn:
customer_id
detected type = integer

DesignColumn:
customer_id
SqlType = BIGINT or INTEGER chosen for design
Primary Key = true
Nullable = false
Auto Increment = true
```

DatasetColumn تصف البيانات.  
DesignColumn تصف ما ستصبح عليه في PostgreSQL.

---

# 5. شرط Schema Ready

> **سبق في Data Cleaning:** تأكيد الجودة مرتبط بأرقام Active Version الدقيقة.

الصفحة تقرأ:

```text
ProjectCleaningSummary.schemaReady
```

إذا `false`:

```text
Generate Schema button disabled
```

وتعرض:

```text
Confirmed cleaned data is required
```

## الشروط الأساسية

- كل Dataset لديها Active Version.
- Active Versions محللة.
- الجودة مؤكدة.
- Confirmed Version IDs تطابق Active Version IDs الحالية.

إذا تغيرت Version بعد التأكيد:

```text
schemaReady = false
```

ويجب:

```text
Re-analysis
→ Confirm Quality again
```

---

# 6. الصفحة والمسارات

Route:

```text
/projects/:projectId/schema-designer
```

Component:

```text
ProjectSchemaDesignerComponent
```

وعليها:

```text
unsavedChangesGuard
```

## الصفحة تعرض

- اسم Project.
- Status.
- Source metadata.
- عدد Tables وColumns.
- Generated date.
- Generate/Regenerate.
- Save Draft.
- Validate Schema.
- Tables tab.
- SQL Preview tab.
- Constraints tab.
- Validation issues.
- Continue to Relationships.

---

# 7. الملفات والطبقات

## Frontend

```text
pages/project-schema-designer/project-schema-designer.component.ts
pages/project-schema-designer/project-schema-designer.component.html
pages/project-schema-designer/project-schema-designer.component.css
services/design-api.service.ts
services/forge-api.service.ts
services/api.models.ts
services/unsaved-changes.guard.ts
services/workflow-state.service.ts
app.routes.ts
```

## Backend

```text
Controllers/DesignController.cs
Services/DesignService.cs
Services/Interfaces/IDesignService.cs
Repositories/DesignRepository.cs
Repositories/Interfaces/IDesignRepository.cs
Services/DatasetHeuristics.cs
Services/Validation/SchemaColumnRules.cs
Services/Validation/DesignValidationService.cs
Services/Validation/DesignRelationshipRules.cs
Services/Generators/*
```

## Entities

```text
DesignModel
DesignTable
DesignColumn
DesignRelationship
```

## المسار العام

> **سبق في الجلسات السابقة:**  
> `Component → API Service → Controller → Service → Repository → PostgreSQL`.

هنا:

```text
ProjectSchemaDesignerComponent
→ DesignApiService
→ DesignController
→ DesignService
├── DatasetRepository
├── CleaningRepository
├── DesignValidationService
├── Schema Generator Resolver
└── DesignRepository
→ PostgreSQL
```

---

# 8. DesignModel وTables وColumns

## DesignModel

```text
Id
ProjectId
Revision
LayoutJson
Status
SourceVersionsJson
GeneratedAt
ValidatedAt
LastModifiedByUserId
CreatedAt
UpdatedAt
Tables
Relationships
```

Status:

```text
Draft
Invalid
Valid
```

## DesignTable

```text
Id
DesignModelId
Name
Comment
SourceDatasetId
SourceDatasetVersionId
Origin
Columns
```

## DesignColumn

```text
Id
DesignTableId
Name
SqlType
IsNullable
IsPrimaryKey
IsUnique
DefaultValue
IsAutoIncrement
Ordinal
SourceColumnName
Origin
```

## DesignRelationship

> **سبق في Relationships:** العلاقة الحقيقية المحفوظة التي تدخل في SQL وER Diagram.

---

# 9. Source Dataset Versions

> **مفهوم محوري مرتبط بـData Cleaning**

كل Generated Table تحفظ:

```text
SourceDatasetId
SourceDatasetVersionId
```

وDesignModel تحفظ Map كاملة:

```json
{
  "15": 3,
  "20": 2
}
```

المعنى:

```text
Dataset 15 generated from Version 3
Dataset 20 generated from Version 2
```

هذا يسمح للنظام باكتشاف:

```text
هل الـSchema ما زالت مبنية على Active Versions الحالية؟
```

---

# 10. ProjectSchemaDesignerComponent

الكلاس:

```ts
implements OnInit, UnsavedChangesAware
```

مسؤولياته:

1. تحميل Project/Cleaning/Schema.
2. منع Generate قبل Schema Ready.
3. توليد Schema.
4. إدارة Draft محلية.
5. Client validation.
6. حفظ Draft.
7. Backend validation.
8. بناء Live SQL.
9. مقارنة Live SQL مع Backend.
10. منع الخروج بتعديلات غير محفوظة.
11. الانتقال إلى Relationships.

## الخدمات

```text
DesignApiService
ForgeApiService
ActivatedRoute
Router
WorkflowStateService
```

---

# 11. Signals وComputed

> **سبق:** Signals وComputed شُرحت في Projects.

## Signals

```text
design
cleaning
projectName
loading
generating
saving
validating
sqlLoading

selectedTableId
activeTab
tableNames
columnDrafts

feedback
copied
leaveDialogOpen
showAllIssues
conflict
```

## Computed

```text
draftTables
selectedTable
tableCount
columnCount
draftErrors
hasDraftErrors
dirty
blockingIssues
warningIssues
visibleIssues
hiddenIssueCount
canContinue
liveSql
relationshipSummary
```

---

# 12. Local Draft مقابل Persisted Design

> **مفهوم جديد مهم**

`design()` هي النسخة القادمة من الباك إند.

لكن التعديلات لا تُكتب مباشرة داخلها.

الصفحة تستخدم:

```text
tableNames: Record<tableId, editedName>
columnDrafts: Record<columnId, editedProperties>
```

ثم `draftTables` تدمج:

```text
Persisted design
+
Local edits
```

## لماذا؟

- Cancel/Leave بدون Save لا يغير البيانات الأصلية.
- يسهل اكتشاف `dirty`.
- يمكن عرض Live SQL قبل Save.
- يمكن مقارنة Draft بالنسخة المحفوظة.
- يقلل تعديل Object أصلية قادمة من API.

---

# 13. Dirty State

`dirty` تقارن:

## Tables

```text
draft table name
vs
persisted table name
```

## Columns

```text
name
sqlType
nullable
primaryKey
unique
default
autoIncrement
```

إذا أي قيمة مختلفة:

```text
dirty = true
```

النتائج:

- يظهر `Unsaved schema edits`.
- Save Draft يتفعل.
- Validate تتعطل.
- Generate/Regenerate ترفض.
- SQL backend verification لا تعمل.
- Guard تمنع الخروج بلا تأكيد.

---

# 14. تحميل Workspace

`loadWorkspace()` تستخدم:

> **سبق في Data Analysis:** `forkJoin`.

ترسل بالتوازي:

```text
GET Project
GET Cleaning Summary
GET Schema
```

ثم:

```text
projectName = project.name
cleaning = summary
applyDesign(schema)
```

إذا لا توجد Schema:

```text
getSchema returns null / no content
```

فتظهر Empty State.

## لماذا تحمل Cleaning Summary هنا؟

حتى تعرف:

```text
schemaReady
```

قبل السماح بالتوليد.

---

# 15. Generate Schema

Endpoint:

```http
POST /api/projects/{projectId}/schema/generate
```

إذا توجد Design حالية، يرسل:

```http
If-Match: currentRevision
```

## Frontend شروط

- لا توجد Dirty edits.
- Cleaning Summary تقول Schema Ready.
- إذا توجد Schema، يطلب Confirmation لأن Regenerate تستبدل Draft الحالية.

## Backend شروط

1. Project للمستخدم.
2. Cleaning `IsSchemaReadyAsync = true`.
3. توجد confirmed Datasets.
4. Revision صحيحة عند Regenerate.

## النتيجة

```text
one DesignTable per confirmed Dataset
one DesignColumn per DatasetColumn
Status = Draft
ValidatedAt = null
SourceVersions recorded
```

---

# 16. ماذا يحدث عند Regenerate؟

في مسار `GenerateSchemaAsync` الحالي:

```text
Design.Relationships.Clear()
Design.Tables.Clear()
Revision += 1
ApplyGeneration from current confirmed versions
```

يعني Regenerate تعيد بناء التصميم من Active confirmed Dataset Versions.

لذلك الواجهة تحذر:

```text
Persisted relationships will need to be reviewed again.
```

## لماذا تمسح العلاقات؟

لأن IDs والجداول والأعمدة الجديدة قد تختلف، والعلاقات القديمة قد تشير إلى Endpoints لم تعد موجودة.

## ملاحظة

يوجد أيضًا Generic Design Generate API يدعم:

```text
merge
replace
```

لكن صفحة Schema Designer الحالية تستخدم Schema Generate الموجه للـconfirmed cleaned versions، وليس واجهة اختيار `merge/replace`.

---
# 17. توليد أسماء الجداول والأعمدة

الخدمة تستخدم `DatasetHeuristics`.

## NormalizeIdentifier

تقوم بـ:

```text
Trim
Lowercase
Replace invalid characters with _
Collapse repeated _
Remove leading/trailing _
Use fallback if empty
Prefix t_ if starts with digit
```

مثال:

```text
"Customer Orders 2026"
→ customer_orders_2026
```

```text
"123 Sales"
→ t_123_sales
```

## MakeUniqueIdentifier

إذا الاسم مستخدم:

```text
customers
customers_2
customers_3
```

## مصدر الاسم

### Table

```text
Dataset.TableName
```

### Column

```text
DatasetColumn.ColumnName
```

ويُحفظ الاسم الأصلي في:

```text
DesignColumn.SourceColumnName
```

حتى لو عدله المستخدم لاحقًا.

---

# 18. تحويل أنواع التحليل إلى PostgreSQL

`ResolveDetectedDataType` تستخدم أولًا:

```text
AnalysisResultJson column detectedDataType
```

إذا غير موجود:

```text
DatasetColumn.DetectedDataType
```

إذا كلاهما غير موجود:

```text
string
```

## MapToSqlType

| النوع المكتشف | PostgreSQL Type الأولي |
|---|---|
| `integer` | `INTEGER` |
| `decimal` | `NUMERIC` |
| `double` | `NUMERIC` |
| `float` | `NUMERIC` |
| `boolean` | `BOOLEAN` |
| `date` | `TIMESTAMP` |
| `datetime` | `TIMESTAMP` |
| `string` | `TEXT` |
| `text` | `TEXT` |
| غير معروف | `TEXT` |

هذه **قيم أولية**، ويمكن للمستخدم تعديلها قبل Validation.

## nullability

التوليد ينقل:

```text
DatasetColumn.IsNullable
→ DesignColumn.IsNullable
```

## Constraints

التوليد الحالي يبدأ:

```text
IsPrimaryKey = false
IsUnique = false
DefaultValue = null
IsAutoIncrement = false
```

أي أن المستخدم يراجع ويحدد Constraints بنفسه.

---

# 19. خصائص العمود القابلة للتعديل

الواجهة تسمح لكل Column بتعديل:

```text
Column Name
Data Type
Nullable
Primary Key
Unique
Default Value
Auto Increment
```

ولكل Table:

```text
Table Name
```

## لا تُعدل في الصفحة الحالية

- SourceDatasetId.
- SourceDatasetVersionId.
- Origin.
- Ordinal.
- Relationships endpoints.
- Comments.
- إضافة/حذف الجداول والأعمدة مباشرة من هذه الصفحة.

بعض العمليات الأوسع موجودة في Design API، لكن ليست كلها معروضة في Schema Designer الحالية.

---

# 20. PostgreSQL Identifiers

> **مفهوم جديد مهم**

اسم Table أو Column يجب أن:

```text
يبدأ بحرف أو _
يحتوي أحرفًا وأرقامًا و_
لا يزيد عن 63 حرفًا
لا يكون PostgreSQL reserved keyword
```

Regex:

```text
^[A-Za-z_][A-Za-z0-9_]{0,62}$
```

## أمثلة صالحة

```text
customers
customer_orders
_private_table
orders2026
```

## أمثلة غير صالحة

```text
123orders
customer-orders
customer orders
select
table
```

## Reserved Words

الواجهة والباك إند يمنعان كلمات مثل:

```text
select
table
column
primary
references
group
order
where
user
```

## لماذا 63 حرفًا؟

PostgreSQL لها حد عملي لأسماء identifiers هو 63 bytes في الإعداد الافتراضي.

---

# 21. أنواع البيانات المدعومة

القائمة الحالية:

```text
SMALLINT
INTEGER
BIGINT
NUMERIC
DECIMAL
REAL
DOUBLE PRECISION
BOOLEAN
VARCHAR(n)
TEXT
DATE
TIMESTAMP
TIMESTAMPTZ
UUID
```

## Normalization في الباك إند

```text
TIMESTAMP WITH TIME ZONE
→ TIMESTAMPTZ
```

```text
CHARACTER VARYING
→ VARCHAR
```

المسافات المتكررة تُوحّد، والنوع يتحول Uppercase.

## Allow-list

> **مفهوم أمني مهم**

النظام لا يسمح بإدخال SQL type عشوائية.

فقط الأنواع الموجودة في Allow-list تمر.

الهدف:

- منع SQL injection عبر type.
- ضمان أن Generator وValidation يفهمان النوع.
- جعل SQL Preview وDeployment متوقعين.

---

# 22. VARCHAR Length

الواجهة تعرض:

```text
VARCHAR
+
length input
```

لكن القيمة المخزنة:

```text
VARCHAR(255)
```

## Default

```text
255
```

## الحدود

```text
1
إلى
10,485,760
```

إذا Length غير صالحة:

```text
Draft Error
```

## الفرق عن TEXT

### VARCHAR(n)

حد أقصى واضح لطول النص.

### TEXT

غير محدود عمليًا، ولذلك Validation تضيف Warning:

```text
unbounded-text-type
```

الـWarning لا تمنع Validation من النجاح.

---

# 23. Nullable

`IsNullable = true` يعني:

```sql
column_name TYPE
```

بدون `NOT NULL`.

`false` يعني:

```sql
column_name TYPE NOT NULL
```

## القيود

لا يمكن جعل Column Nullable إذا:

```text
Primary Key
أو
Auto Increment Identity
```

الواجهة تعطل Checkbox، والباك إند يعيد التحقق.

---

# 24. Primary Key

> **مفهوم قواعد بيانات مهم**

Primary Key:

- تميز كل Row.
- لا تقبل Null.
- تفرض Uniqueness.
- قد تكون Column واحدة أو عدة Columns.

## في الواجهة

يمكن اختيار أكثر من Column في Table كـPrimary Key.

SQL الناتج:

```sql
PRIMARY KEY (column_a, column_b)
```

وهذا يسمى:

```text
Composite Primary Key
```

## عند تفعيل PK

الواجهة تلقائيًا تجعل:

```text
isPrimaryKey = true
isNullable = false
isUnique = false
```

لماذا `isUnique = false`؟

لأن PK تفرض Uniqueness أصلًا، فلا حاجة لـUnique إضافية على نفس Column.

---

# 25. Unique

`UNIQUE` تمنع تكرار القيمة.

مثال:

```sql
email TEXT UNIQUE
```

## الفرق عن PK

- Table يمكن أن تحتوي عدة Unique constraints.
- عادة لديها Primary Key واحدة فقط، وقد تكون Composite.
- Unique قد تسمح بـNull حسب PostgreSQL semantics.
- PK دائمًا NOT NULL.

## في العلاقات

> **سبق في Relationships:** Target Foreign Key يجب أن تكون PK أو Unique.

---

# 26. Default Value

> **مفهوم جديد مهم وأمني**

Default تستخدم إذا Insert لم يرسل قيمة.

مثال:

```sql
status TEXT DEFAULT 'active'
```

## الأنواع المدعومة

### Integer

```text
0
-5
123
```

ويفحص Range حسب:

```text
SMALLINT
INTEGER
BIGINT
```

### Numeric

```text
0
-12.5
1.2e3
```

### Boolean

```text
true
false
```

### Text/VARCHAR

يجب Single-quoted:

```text
'active'
```

والأبستروف داخل النص يُكرر:

```text
'O''Reilly'
```

### DATE

```text
'2026-07-12'
```

ويتحقق أنها Date حقيقية.

### TIMESTAMP/TIMESTAMPTZ

```text
CURRENT_TIMESTAMP
```

أو:

```text
'2026-07-12T14:30:00Z'
```

### UUID

Quoted UUID فقط:

```text
'550e8400-e29b-41d4-a716-446655440000'
```

Functions عشوائية مثل `gen_random_uuid()` غير مفعلة حاليًا.

## حماية Expression

يمنع:

```text
;
--
/*
*/
line breaks
```

والطول الأقصى:

```text
512 characters
```

هذه Allow-list/validation تمنع إدخال SQL statements داخل Default.

---

# 27. Auto Increment / Identity

PostgreSQL الحديثة تستخدم:

```sql
GENERATED BY DEFAULT AS IDENTITY
```

وليس اعتمادًا ضروريًا على `SERIAL`.

## الأنواع المدعومة

```text
SMALLINT
INTEGER
BIGINT
```

## عند التفعيل

```text
isAutoIncrement = true
isNullable = false
```

## ممنوع مع Default

Identity تولد القيمة، لذلك لا يسمح أيضًا بـ:

```text
DEFAULT ...
```

## تغيير النوع

إذا كانت Identity مفعلة، ثم المستخدم اختار Type غير متوافق:

```text
Auto Increment disabled
```

وتظهر Warning.

---

# 28. Client-side Draft Validation

> **سبق:** Frontend Validation لتحسين تجربة المستخدم، والباك إند يعيد التحقق.

الواجهة تفحص:

## Table

```text
required name
≤ 63
identifier pattern
not reserved
no duplicate table names
```

## Column

```text
valid name
no duplicate in same table
supported type
valid VARCHAR length
PK not nullable
identity compatible type
identity not nullable
identity no default
default valid for type
```

## hasDraftErrors

تكون `true` إذا توجد Errors في Table أو Column.

النتيجة:

- Save Draft disabled.
- Continue disabled.
- رسالة Fix schema errors.

---

# 29. Save Draft

Endpoint:

```http
PATCH /api/projects/{projectId}/schema/draft
If-Match: {revision}
```

الواجهة ترسل جميع Tables وColumns الحالية:

```json
{
  "tables": [
    {
      "id": 1,
      "name": "customers"
    }
  ],
  "columns": [
    {
      "id": 10,
      "name": "id",
      "dataType": "INTEGER",
      "isNullable": false,
      "isPrimaryKey": true,
      "isUnique": false,
      "defaultValue": null,
      "isAutoIncrement": true
    }
  ]
}
```

## شروط Frontend

- Design موجودة.
- Dirty.
- ليست Saving.
- لا Draft Errors.

## النجاح

```text
apply persisted design
clear dirty state
show Draft saved
```

## بعد Save

Design تبقى أو تصبح:

```text
Draft
```

ويجب تشغيل Validation.

---

# 30. Backend Save Validation

`SaveSchemaDraftAsync` تعمل:

1. تتحقق من Whitelist.
2. تجلب Design tracked.
3. تتحقق Revision.
4. تتأكد IDs تنتمي للSchema.
5. تتحقق أسماء Tables.
6. تتحقق أسماء Columns.
7. Normalize SQL types.
8. تتحقق PK/Nullable.
9. تتحقق Identity.
10. Normalize Default.
11. تطبق القيم.
12. تمنع Duplicate names.
13. تجعل Status = Draft.
14. تمسح ValidatedAt.
15. تسجل LastModifiedByUserId.
16. تحفظ وتزيد Revision.
17. تعيد Workspace محدثة.

## Rename Whitelist

Request لا يسمح بإرسال Fields غير معروفة أو غير مسموحة.

كما يمنع تكرار نفس Table/Column ID داخل Request.

---

# 31. Draft وValid وInvalid

## Draft

التصميم:

- مولد حديثًا.
- أو تم تعديله.
- أو تغيرت Relationships.
- ولم تُعتمد Validation على النسخة الحالية.

## Valid

Validation الحالية لا تحتوي Blocking Errors، والـSchema ليست Stale.

## Invalid

توجد Validation Error واحدة على الأقل.

## Warnings

Warnings لا تجعل Status Invalid.

مثال:

```text
Table بدون Primary Key
```

حاليًا Warning وليست Error.

---

# 32. Validate Schema

Endpoint:

```http
POST /api/projects/{projectId}/schema/validate
If-Match: {revision}
```

## Frontend شروط

- Design موجودة.
- لا Dirty edits.
- ليست Validating.

إذا يوجد Local Draft غير محفوظ:

```text
Save Draft first
```

## Backend

1. تجلب Design.
2. تتحقق Revision.
3. تفحص Staleness.
4. تبني Validation Issues.
5. إذا توجد Error:
   ```text
   Status = Invalid
   ```
6. وإلا:
   ```text
   Status = Valid
   ```
7. تسجل `ValidatedAt`.
8. تسجل المستخدم.
9. تحفظ مع Revision جديدة.
10. تعيد Workspace كاملة.

---
# 33. Errors وWarnings

## Error

تمنع:

```text
Status = Valid
canContinue = true
```

## Warning

تنبه، لكنها لا تمنع الاستمرار إذا لا توجد Errors.

## Frontend grouping

```text
blockingIssues
warningIssues
visibleIssues
hiddenIssueCount
```

افتراضيًا تعرض:

```text
كل Errors
+
أول 4 Warnings
```

ويمكن `Show all`.

## focusIssue

إذا Issue مرتبطة بـTable:

```text
select table
switch to Tables tab
```

حتى يصل المستخدم لمكان المشكلة بسرعة.

---

# 34. Table Validation Rules

## Duplicate table name

```text
Error
```

المقارنة غير حساسة لحالة الأحرف:

```text
Customers
customers
```

تعتبر Duplicate.

## Invalid identifier

```text
Error
```

## Zero-column table

```text
Error
```

## No Primary Key

```text
Warning
```

## No PK or Unique

```text
Warning
```

## Isolated table

Table لا تدخل في أي Relationship:

```text
Warning
```

## Generated name differs from source

إذا المستخدم غير الاسم:

```text
Warning
```

هذا ليس خطأ؛ فقط توثيق أن الاسم النهائي مختلف عن Source.

---

# 35. Column Validation Rules

## Duplicate Column name

داخل نفس Table:

```text
Error
```

## Invalid identifier

```text
Error
```

## Unsupported SQL type

```text
Error
```

## Nullable Primary Key

```text
Error
```

## Identity type غير مدعوم

```text
Error
```

## Nullable Identity

```text
Error
```

## Identity + Default

```text
Error
```

## Invalid Default

```text
Error
```

## TEXT

```text
Warning
```

لأنه Unbounded، وليس لأنه غير صالح.

## Renamed from source

```text
Warning
```

---

# 36. Relationship Validation Rules

> **سبق في Relationships:** Source FK → Target PK/Unique.

Validation تفحص:

## Endpoint missing

Relationship تشير إلى Column حُذفت:

```text
Error
```

## Target ليست PK أو Unique

```text
Error
```

## Type mismatch

```text
Error
```

مثال:

```text
INTEGER → TEXT
```

## Nullable Foreign Key

```text
Warning
```

لا يمنع التصميم، لكنه يعني أن العلاقة Optional.

## ملاحظة

تغيير Type أو PK/Unique داخل Schema Designer قد يجعل Relationship قديمة غير صالحة، لذلك يجب Validate بعد التعديل.

---

# 37. Stale Schema

> **مفهوم جديد ومحوري**

Schema تصبح Stale إذا Active confirmed Dataset Versions الحالية لا تطابق Versions التي بُنيت منها.

مثال:

```text
Schema generated from:
customers v3
orders v2

Cleaning creates:
customers v4 active
orders v2 active
```

النتيجة:

```text
Schema is stale
```

حتى لو اسم Columns لم يتغير؛ النظام لا يفترض أن التصميم ما زال صحيحًا.

## UI

تعرض Banner:

```text
Schema source versions are stale.
Regenerate before validation.
```

## Validation Issue

```text
code = stale-cleaned-versions
severity = error
```

---

# 38. SourceVersionsJson

DesignModel تحفظ:

```json
{
  "datasetId": "versionId"
}
```

وكل DesignTable تحفظ SourceVersion أيضًا.

## IsStaleAsync

تقارن:

```text
active versions count
vs
schema source versions count
```

ثم لكل Dataset:

```text
activeVersionId == schemaVersionId
```

أي اختلاف:

```text
stale = true
```

## لماذا المقارنة بالID وليس التاريخ؟

Version ID تحدد Snapshot بعينها بوضوح، بينما التاريخ قد يتساوى أو يتأثر بالدقة.

---

# 39. canContinue

Frontend:

```text
design.canContinue
AND not dirty
AND no draft errors
```

Backend `canContinue` تكون true فقط إذا:

```text
Status = Valid
not stale
no validation errors
```

## النتيجة

لا يستطيع المستخدم الذهاب إلى Relationships إذا:

- Schema غير محفوظة.
- توجد Client errors.
- Validation لم تنجح.
- Schema Stale.
- توجد Backend blocking errors.

---

# 40. Tabs: Tables / SQL / Constraints

## Tables

تعديل:

```text
Table name
Column name
Type
Nullable
PK
Unique
Default
Identity
```

## SQL Preview

تعرض SQL مبنية من Draft المحلية.

حتى قبل Save، يرى المستخدم أثر التعديل.

## Constraints

تعرض:

```text
Validation issues
Relationship summary
PK/Unique/Nullable/Defaults/Identity context
```

## Keyboard navigation

Tabs تدعم:

```text
ArrowRight
ArrowLeft
```

وتلف من آخر Tab إلى الأولى والعكس.

هذه Accessibility behavior.

---

# 41. Live SQL Preview

`liveSql` Computed تستخدم:

```text
draftTables
+
persisted relationships
```

كل تعديل Local يعيد توليد SQL تلقائيًا.

## الفائدة

يرى المستخدم فورًا:

```text
VARCHAR length
NOT NULL
UNIQUE
PRIMARY KEY
DEFAULT
IDENTITY
Foreign Keys
Indexes
```

## ملاحظة مهمة

Live SQL للعرض، وليست المصدر النهائي المعتمد.

Backend Generator هي Source of Truth للتصدير والنشر.

---

# 42. Backend SQL Verification

زر Refresh/Verify Backend SQL يعمل فقط إذا:

```text
Design موجودة
not dirty
```

يرسل:

```http
GET /api/projects/{projectId}/schema/sql
```

ثم يقارن:

```text
normalized backend SQL
vs
normalized live SQL
```

## Normalization

توحّد Line endings:

```text
CRLF
CR
LF
```

لأن اختلاف نظام التشغيل لا يعني اختلاف SQL.

## النتائج

### Match

```text
SQL verified
```

### Different

```text
SQL preview mismatch
Reload schema before continuing
```

هذا يحمي من Drift بين Frontend preview وBackend generator.

---

# 43. SQL Generation Structure

Live SQL تبدأ:

```sql
BEGIN;
```

ثم:

```sql
CREATE TABLE ...
```

وفي النهاية:

```sql
COMMIT;
```

## Column definition

قد تحتوي:

```text
name
type
identity
default
NOT NULL
UNIQUE
```

مثال:

```sql
id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL
```

## Primary Key

تضاف كTable constraint:

```sql
PRIMARY KEY (id)
```

أو Composite:

```sql
PRIMARY KEY (order_id, line_number)
```

---

# 44. Table Ordering

> **مفهوم جديد: Dependency ordering / Topological sort**

إذا Table تعتمد على أخرى بـForeign Key، الأفضل إنشاء Target أولًا.

مثال:

```text
orders → customers
```

الترتيب:

```text
CREATE customers
CREATE orders with FK to customers
```

`orderTables()` تبني Dependencies ثم تستخدم DFS.

## States

```text
unvisited
visiting
visited
```

إذا وجدت Node في حالة `visiting` مرة ثانية:

```text
cycle detected
```

---

# 45. Circular Dependencies

مثال:

```text
table_a references table_b
table_b references table_a
```

لا يمكن بسهولة وضع كل Foreign Keys داخل `CREATE TABLE` بالترتيب.

## الحل الحالي

1. تنشئ كل Tables بلا Foreign Keys.
2. بعدها تستخدم:

```sql
ALTER TABLE ...
ADD CONSTRAINT ...
FOREIGN KEY ...
```

هذا يسمح بحل Cycles.

## Constraint names

مثل:

```text
fk_orders_customer_id
```

وإذا تكرر الاسم:

```text
fk_orders_customer_id_2
```

---

# 46. Identifier Quoting

Generator لا تضع Quotes إذا الاسم آمن:

```text
customers
customer_id
```

لكن إذا احتاج:

```text
"CustomerOrders"
```

أو يحتوي حالة خاصة.

Quotes الداخلية تُهرب:

```text
"
→ ""
```

## لماذا الأفضل استخدام identifiers بسيطة؟

لأن:

```text
lowercase_snake_case
```

تقلل الحاجة للQuotes وتجنب مشاكل Case sensitivity.

---

# 47. Foreign Keys وIndexes

لكل Persisted Relationship:

```sql
FOREIGN KEY (source_column)
REFERENCES target_table(target_column)
ON DELETE ...
```

## On Delete

> **سبق في Relationships.**

```text
no-action → NO ACTION
cascade   → CASCADE
set-null  → SET NULL
```

## Index

الـLive generator تنشئ Index على Source FK:

```sql
CREATE INDEX ix_orders_customer_id
ON orders(customer_id);
```

الهدف تحسين:

- Joins.
- Lookup حسب FK.
- بعض عمليات Delete/Update على Target.

## ملاحظة

العلاقات المقبولة أو اليدوية تظهر هنا؛ Suggestions المعلقة لا تدخل SQL.

---

# 48. Design Revision وIf-Match

> **سبق في Relationships، وهنا نفس العقد لكل Schema mutation.**

كل Design لها:

```text
Revision
```

عند:

```text
Generate over existing
Save Draft
Validate
Relationship changes
```

يرسل العميل:

```http
If-Match: revision
```

## Fresh Generate

لا توجد Design سابقة، لذلك لا يوجد Revision مطلوب.

## Existing Design

أي Mutation تحتاج Revision الحالية.

## بعد Save

Revision تزيد.

لذلك Response الجديدة يجب أن تستبدل النسخة القديمة في الواجهة.

---

# 49. Concurrency Conflict Recovery

إذا Tab أو Session أخرى عدلت الـSchema:

```text
server revision != client If-Match
```

Response:

```text
409 Conflict
```

Frontend:

```text
conflict = true
feedback = Schema changed elsewhere
```

وتعرض زر:

```text
Reload Latest Version
```

## reloadAfterConflict

- تمسح Conflict state.
- تحمل Workspace من جديد.
- تتخلص من Local edits القديمة.

## لماذا لا تدمج تلقائيًا؟

لأن Auto merge في Schema قد ينتج:

- Constraints متضاربة.
- Names مكررة.
- Type changes خطرة.
- تعديل فوق Source versions مختلفة.

المستخدم يعيد تطبيق التغييرات يدويًا على أحدث Revision.

---

# 50. Unsaved Changes Guard

> **سبق في Project Create.**

إذا `dirty = true` وحاول المستخدم الخروج:

```text
canDeactivate
→ open dialog
→ stay or leave
```

وتدعم:

```text
Angular navigation
Browser refresh
Tab close
Escape
Focus management
```

إذا الانتقال بعد Validation مقصود:

```text
allowNavigation = true
```

ثم:

```text
navigate to relationships
```

---

# 51. DesignController

## GET Schema

```http
GET /api/projects/{projectId}/schema
```

- يفحص الملكية.
- لا توجد Schema → `204 No Content`.
- توجد → `200`.

## Generate Schema

```http
POST /api/projects/{projectId}/schema/generate
```

- Ownership.
- Optional If-Match.
- Service تتحقق Schema Ready.
- Fresh أو Regenerate.

## Save Draft

```http
PATCH /api/projects/{projectId}/schema/draft
```

- Required If-Match.
- يحفظ Editable properties.

## Validate Schema

```http
POST /api/projects/{projectId}/schema/validate
```

- Required If-Match.
- يحسب Validation.

## SQL Preview

```http
GET /api/projects/{projectId}/schema/sql
```

- يعيد Backend generated SQL.

## Generic Design API

أيضًا توجد Endpoints لـ:

```text
Create/update/delete tables
Create/update/delete columns
Reorder columns
Create/update/delete relationships
Update layout
Preview formats
Validation issues
```

كل Mutations تستخدم If-Match.

---

# 52. DesignService

Dependencies:

```text
IDesignRepository
IDatasetRepository
IDesignSchemaGeneratorResolver
IDesignValidationService
ICleaningRepository
```

## GenerateSchemaAsync

```text
require schema ready
→ get active versions
→ build sourceVersions map
→ get datasets with columns
→ load or create design
→ clear old tables/relationships on regenerate
→ ApplyGeneration
→ Draft
→ save source versions
→ save/reload
→ build schema response
```

## SaveSchemaDraftAsync

```text
validate whitelist
→ check revision
→ update tables
→ update columns
→ validate and normalize types/defaults
→ ensure unique names
→ Draft
→ save
→ return workspace
```

## ValidateSchemaAsync

```text
check revision
→ detect stale
→ validate snapshot
→ Valid or Invalid
→ save validated timestamp
→ return workspace
```

## GetSchemaSqlAsync

```text
load design
→ build snapshot
→ generator resolver Generate("sql")
```

---

# 53. DesignRepository

> **سبق:** Repository وEF Core.

مسؤوليتها:

- تحميل Design كاملة.
- Loading مع Tables/Columns/Relationships.
- Tracking أو AsNoTracking حسب العملية.
- Add.
- SaveChanges.
- Transactions.
- إيجاد Design ID من Table/Column/Relationship IDs.
- Clear tracking عند concurrency conflicts.

## Full Design Graph

```text
DesignModel
├── Tables
│   └── Columns
└── Relationships
    ├── FromColumn
    └── ToColumn
```

الـService تحتاج Graph كاملة لـ:

- Validation.
- SQL generation.
- Duplicate checks.
- CRUD.
- Relationship mapping.

---

# 54. DTOs وEntities

> **سبق:** Entity لقاعدة البيانات وDTO لعقد API.

## DesignModelResponse

تتضمن:

```text
id
projectId
revision
status
source
generatedAt
validatedAt
isStale
canContinue
tables
relationships
validationIssues
sqlPreview
```

## DesignTable Response

تضيف معلومات Source للعرض:

```text
sourceDatasetId
sourceDatasetVersionId
sourceName
rowCount
columns
```

## DesignColumn Response

```text
id
name
sqlType
nullable
primaryKey
unique
default
autoIncrement
ordinal
sourceColumnName
origin
```

## SaveDesignDraftRequest

محدودة إلى Properties المسموحة.

---

# 55. Origin: Generated / User / Accepted Suggestion

الثوابت:

```text
generated
user
accepted-suggestion
```

## Generated

أنشأها النظام من Dataset.

## User

أنشأها المستخدم يدويًا عبر Design API.

## Accepted Suggestion

Relationship جاءت من قبول Suggestion.

## لماذا Origin مهمة؟

- التوثيق.
- Regeneration policies.
- معرفة ما أنشأه النظام وما أضافه المستخدم.
- حماية العناصر اليدوية في بعض Generic merge/replace flows.

## Schema Generate الحالية

Regenerate الموجهة للconfirmed versions تعيد بناء Tables وRelationships، لذلك يجب مراجعة العناصر بعد التوليد.

---

# 56. حدود الواجهة الحالية مقابل Design API

## واجهة Schema Designer الحالية

تدعم:

```text
rename tables
rename columns
change SQL types
nullable
primary key
unique
default
identity
save
validate
SQL preview
```

## Design API الأوسع

تدعم أيضًا:

```text
create table
update table comment
delete table
create column
delete column
reorder columns
create/update/delete relationship
update layout
```

وجود Endpoint لا يعني أن Schema Designer الحالية توفر زرًا لها.

هذا فرق مهم عند قراءة المشروع:

```text
Backend capability
≠
Current page capability
```

---

# 57. المسارات الكاملة

## فتح الصفحة

```text
/projects/5/schema-designer
→ read projectId
→ forkJoin:
   project
   cleaning summary
   schema
→ schemaReady false:
   show gate
→ no design:
   show Generate
→ design exists:
   apply persisted design to local drafts
```

## Generate

```text
click Generate
→ POST schema/generate
→ ownership
→ schema-ready check
→ active versions map
→ datasets and columns
→ normalize names
→ map detected types
→ create DesignModel/Tables/Columns
→ Draft
→ save
→ return workspace
```

## Edit

```text
change local table/column properties
→ draftTables recompute
→ dirty true
→ client validation
→ live SQL updates
```

## Save

```text
fix client errors
→ PATCH schema/draft + If-Match
→ backend validation and normalization
→ revision check
→ save
→ Draft
→ return latest design
→ dirty false
```

## Validate

```text
no local edits
→ POST schema/validate + If-Match
→ stale check
→ validation engine
→ Valid or Invalid
→ revision bump
→ return issues/canContinue
```

## Continue

```text
canContinue true
→ allowNavigation
→ /projects/{id}/relationships
```

## Cleaning changes later

```text
new active dataset version
→ schema source map no longer matches
→ isStale true
→ validation error
→ regenerate required
```

---

# 58. الحالات والأخطاء

## Status

```text
Draft
Invalid
Valid
```

## HTTP Codes

| Code | الاستخدام |
|---:|---|
| 200 | Get/Generate/Save/Validate ناجح |
| 204 | لا توجد Schema |
| 400 | Names/Types/Defaults/Request غير صالحة |
| 401 | JWT غير صالحة |
| 403 | Project/Design ليست للمستخدم |
| 404 | Project أو Schema غير موجودة |
| 409 | Revision قديمة أو Schema ليست جاهزة أو conflict |
| 428 | Mutation تحتاج If-Match |

## رسائل مهمة

```text
Confirm cleaned versions before generating
Save or discard edits first
Fix schema errors
Save Draft first
Schema changed elsewhere
Schema source versions are stale
No confirmed datasets
Unsupported PostgreSQL type
Invalid default
Duplicate table/column name
```

---

# 59. الاختبار العملي

## Gate

- Project بلا Datasets.
- Datasets لم تُحلل.
- Cleaning applied ولم يُعد التحليل.
- Quality غير مؤكدة.
- schemaReady true.
- Cleaning جديدة بعد Confirmation.

## Generation

- Fresh generate بلا If-Match.
- Regenerate بـRevision صحيحة.
- Regenerate بـRevision قديمة.
- One table per Dataset.
- SourceVersion IDs صحيحة.
- Names غير صالحة تتحول.
- Duplicate normalized names تأخذ suffix.
- Detected types تُحول.
- Relationships القديمة تُمسح في Regenerate.

## Names

- فارغ.
- يبدأ برقم.
- يحتوي Space/Hyphen.
- Reserved word.
- أكثر من 63.
- Duplicate tables مع اختلاف Case.
- Duplicate columns.

## Data types

- كل الأنواع المدعومة.
- VARCHAR(1).
- VARCHAR(255).
- Max VARCHAR.
- صفر.
- أكبر من Max.
- Type غير مدعومة.
- TIMESTAMP WITH TIME ZONE normalization.

## PK/Unique/Nullable

- PK تجعل NOT NULL.
- Composite PK.
- Unique.
- PK وUnique لا تتكرر.
- Nullable FK warning.
- Table بلا PK warning.
- Table بلا Unique warning.

## Defaults

- Integer ranges.
- Numeric.
- Boolean.
- Quoted text.
- Apostrophe escaped.
- Real/invalid Date.
- CURRENT_TIMESTAMP.
- Invalid timestamp.
- UUID.
- Semicolon/comment/newline.
- Default + Identity conflict.

## Identity

- SMALLINT.
- INTEGER.
- BIGINT.
- TEXT مرفوض.
- Change type disables Identity.
- Identity forces NOT NULL.
- Identity with Default مرفوض.

## Save/Validation

- Save Dirty valid draft.
- Save بلا Dirty.
- Validate مع Dirty.
- Valid design.
- Invalid design.
- Warning-only design.
- Revision increments.
- Last modified user.
- Conflict and Reload.

## SQL Preview

- NOT NULL.
- UNIQUE.
- DEFAULT.
- IDENTITY.
- Composite PK.
- FK.
- ON DELETE.
- Index.
- Dependency order.
- Circular FK uses ALTER TABLE.
- Local/backend match.
- Line ending differences ignored.
- Actual mismatch detected.

## Guard

- Leave with no edits.
- Leave with edits.
- Stay.
- Leave.
- Browser refresh.
- Successful Continue bypasses warning.

---

# 60. ملخص الحفظ السريع

## التحول

```text
Confirmed Dataset Versions
→ DesignModel
→ DesignTables
→ DesignColumns
→ Validation
→ Relationships
→ ER/SQL/Deployment
```

## الفرق

```text
DatasetColumn = data profile
DesignColumn = database decision
```

## Generate

```text
source names
→ normalized identifiers
analysis type
→ PostgreSQL type
nullability copied
constraints left for user
```

## Editable

```text
name
type
nullable
PK
unique
default
identity
```

## Status

```text
Generate/Edit → Draft
Validate with errors → Invalid
Validate without errors → Valid
```

## Stale

```text
Schema source version IDs
!=
Current active confirmed version IDs
→ regenerate
```

## Concurrency

```text
Revision
+ If-Match
+ 409 conflict
+ Reload latest
```

## مفاهيم جديدة

```text
DesignModel
Dataset vs Design
PostgreSQL identifiers
SQL type allow-list
default expression validation
identity columns
composite primary key
stale schema
source version map
topological table ordering
circular foreign keys
live SQL vs backend source of truth
```

## مفاهيم سبقت

```text
Signals/computed
forkJoin
DTO vs Entity
Repository
JWT ownership
Schema Ready
Dataset Versions
Relationships
If-Match
Optimistic concurrency
Unsaved changes guard
```

---

# 61. تحسينات مؤجلة لما بعد الفهم

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. إضافة Create/Delete/Reorder Tables وColumns إلى الواجهة الحالية إذا كانت مطلوبة.
2. دعم NUMERIC precision/scale مثل `NUMERIC(12,2)`.
3. دعم VARCHAR presets مع UX أوضح.
4. Profile/type compatibility validation ضد القيم الفعلية قبل تغيير النوع.
5. اقتراح PK تلقائيًا من Key Candidates مع قبول صريح.
6. اقتراح Unique من Cardinality بدل تركها يدويًا بالكامل.
7. فحص `SET NULL` مقابل Nullable في Client draft قبل Relationships.
8. دعم Default functions آمنة مثل UUID generation بقائمة Allow-list.
9. عرض Diff قبل Regenerate.
10. الحفاظ الاختياري على Manual Tables/Columns في Schema regeneration.
11. Migration preview بدل CREATE-only SQL.
12. دعم CHECK constraints.
13. دعم Index editing.
14. دعم Composite Unique constraints.
15. توحيد Live SQL generator مع Backend عبر Shared generated contract لتقليل Drift.
16. عرض Backend SQL مباشرة بدل إعادة تنفيذ Generator كاملة في Frontend.
17. ETag قياسي بدل Revision integer فقط.
18. Auto-merge محدود للتعديلات غير المتعارضة.
19. Audit history لكل Schema revision.
20. Integration tests لتطابق Frontend وBackend SQL generators.
21. Validation rule تكتشف Source values غير المتوافقة مع النوع المختار.
22. Warning أو Error واضح عند Table بلا PK حسب متطلبات المشروع.
23. Preview للبيانات بعد type conversion قبل Deployment.
24. تحسين Regenerate حتى لا تمسح Relationships التي يمكن ربطها بأمان.
25. Schema version snapshots للرجوع إلى Draft سابقة.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. الفرق بين Dataset وDesignModel.
2. الفرق بين DatasetColumn وDesignColumn.
3. لماذا Schema Ready شرط للتوليد.
4. كيف تحفظ الـSchema أرقام Source Versions.
5. كيف يولد النظام أسماء PostgreSQL آمنة.
6. كيف يحول الأنواع المكتشفة إلى SQL Types.
7. لماذا Constraints لا تُختار تلقائيًا بالكامل.
8. الفرق بين PK وUnique وNullable.
9. كيف تعمل Identity Columns.
10. كيف تتحقق Default Values بأمان.
11. الفرق بين Local Draft وPersisted Design.
12. كيف تعمل Dirty State وSave Draft.
13. كيف تعمل Validation والفرق بين Error وWarning.
14. متى تصبح Schema Stale.
15. كيف يعمل Live SQL.
16. لماذا يوجد Backend SQL Verification.
17. كيف يرتب النظام Tables ويح处理 Circular FKs.
18. كيف تعمل Revision وIf-Match.
19. كيف تمنع Guard ضياع التعديلات.
20. ما الذي تدعمه الصفحة الحالية وما الموجود فقط في Design API.
