# ForgeDB — دليل جلسة Data Cleaning الكامل

> **الجلسة رقم 05 — Data Cleaning**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم اقتراحات التنظيف، اختيار الاستراتيجية، المعاينة قبل التطبيق، العمليات الآمنة والخطِرة، تنظيف Python، إنشاء Dataset Versions، تاريخ العمليات، Undo وRestore، إعادة التحليل، وتأكيد الجودة قبل Schema.

---

## طريقة استخدام الدليل

- هذا الملف هو شرح الجلسة كاملًا، والشات للأسئلة.
- **سبق في Projects / Dataset Import / Data Analysis:** المفهوم مر سابقًا، وسأوضح استخدامه هنا.
- **مفهوم جديد:** يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة.

---

# المحتويات

1. الصورة العامة  
2. لماذا التنظيف بعد التحليل  
3. دورة العمل الكاملة  
4. الصفحات والملفات  
5. نموذج البيانات: Versioning وBatches  
6. DataCleaningComponent  
7. Scope والفلترة  
8. Suggestions وStrategies  
9. اختيار العمليات  
10. Safe وDestructive  
11. Preview قبل Apply  
12. Before وAfter  
13. Apply Cleaning  
14. Partial Success  
15. Fix All Safe  
16. History  
17. Undo  
18. Restore Version  
19. Re-analysis  
20. Quality Confirmation  
21. Schema Ready  
22. CleaningController  
23. CleaningService Summary  
24. إنشاء Raw Version  
25. بناء الاقتراحات  
26. Missing Values strategies  
27. Extra Spaces وCase  
28. Outliers وIQR  
29. Duplicates  
30. Numeric/Currency normalization  
31. Python Request  
32. Python CleaningService  
33. ترتيب العمليات  
34. عمليات Python المدعومة  
35. Preview calculation  
36. PersistVersionAsync  
37. حماية Active Version  
38. Cleaning Batch وOperation History  
39. Transactions  
40. Invalidate Quality  
41. Undo وRestore داخليًا  
42. ProjectCleaningState  
43. DTOs وEntities  
44. المسارات الكاملة  
45. الحالات والأخطاء  
46. الاختبار العملي  
47. ملخص الحفظ  
48. تحسينات مؤجلة

---

# 1. الصورة العامة

بعد التحليل، يعرف النظام مشاكل البيانات:

```text
Missing Values
Duplicate Rows
Extra Spaces
Inconsistent Case
Outliers
Numeric/Currency formatting
Type or date conversion problems
```

ثم دورة التنظيف:

```text
Analysis result
→ Build cleaning suggestions
→ User chooses strategies
→ Preview before/after
→ Confirm destructive operations
→ Apply cleaning batch
→ Create new Dataset Version
→ Mark analysis required
→ Re-run Analysis
→ Confirm Data Quality
→ Continue to Schema
```

أهم فكرة:

> التنظيف لا يعدل النسخة الأصلية مباشرة.  
> كل تطبيق ناجح ينشئ **Dataset Version جديدة**.

---

# 2. لماذا التنظيف بعد التحليل؟

> **سبق في Data Analysis:** التحليل يحسب Missing Values وDuplicates وColumn Profiles.

من دون Analysis، خدمة التنظيف لا تعرف:

- أي عمود يحتوي Missing Values.
- نوع العمود Numeric أو Text.
- عدد الصفوف المكررة.
- هل توجد قيم شاذة Outliers.
- ما الاستراتيجية المناسبة.

لذلك:

```text
Imported
→ Analyzed
→ Cleaning suggestions available
```

بعد تطبيق Cleaning:

```text
Cleaned - Analysis Required
```

لأن Metrics القديمة لم تعد تمثل المحتوى الجديد.

---

# 3. دورة العمل الكاملة

```text
Open Data Cleaning
    ↓
Load Summary + Suggestions + History
    ↓
Choose Project scope or Dataset
    ↓
Filter issues
    ↓
Choose one or more suggestions
    ↓
Choose strategy and parameters
    ↓
Preview
    ↓
Inspect before / after / warnings
    ↓
Confirm destructive action if required
    ↓
Apply
    ↓
Create Cleaning Batch
    ↓
Create Dataset Version
    ↓
Set it Active
    ↓
Invalidate old analysis and quality confirmation
    ↓
Re-run Analysis
    ↓
Confirm Quality
    ↓
Schema Ready
```

---

# 4. الصفحات والملفات

## Route

```text
/projects/:projectId/data-cleaning
```

## Frontend

```text
pages/data-cleaning/data-cleaning.component.ts
pages/data-cleaning/data-cleaning.component.html
pages/data-cleaning/data-cleaning.component.css
services/forge-api.service.ts
services/api.models.ts
services/workflow-state.service.ts
```

## Backend

```text
Controllers/CleaningController.cs
Services/CleaningService.cs
Services/Interfaces/ICleaningService.cs
Repositories/CleaningRepository.cs
Repositories/Interfaces/ICleaningRepository.cs
Services/CleaningSnapshotSerializer.cs
Clients/PythonAnalysisClient.cs
```

## Python

```text
python-analysis-service/services/cleaning_service.py
python-analysis-service/models/cleaning.py
python-analysis-service/app/main.py
```

## Entities

```text
Dataset
DatasetVersion
CleaningBatch
CleaningOperation
ProjectCleaningState
```

---

# 5. نموذج البيانات: Versioning وBatches

> **مفهوم جديد ومحوري**

## Dataset

تمثل المصدر المنطقي الحالي:

```text
customers
```

وتحتوي:

```text
ActiveVersionId
Versions
```

## DatasetVersion

نسخة كاملة من Rows وColumns في وقت معين.

مثال:

```text
Dataset: customers
├── v1 Raw Original
├── v2 Filled missing values
├── v3 Removed duplicates ← Active
└── v4 Restored v1 content
```

كل Version تحفظ:

```text
RowsJson
ColumnsJson
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
AnalysisResultJson
AnalyzedAt
ParentVersionId
CleaningBatchId
VersionNumber
IsRawOriginal
IsActive
OperationSummary
```

## CleaningBatch

مجموعة عمليات نفذها المستخدم في Apply واحد.

مثال:

```text
Batch: Apply 3 reviewed fixes
├── Fill missing age
├── Trim customer_name
└── Remove duplicates
```

تحفظ:

```text
CorrelationId
ProjectId
User
Status
OperationCount
RowsAffected
CellsAffected
FailureDetails
IsUndo
IsRestore
CreatedAt
CompletedAt
```

## CleaningOperation

سجل لكل عملية داخل Batch:

```text
OperationType
ColumnName
ParametersJson
SourceVersionId
ResultVersionId
Order
Status
IsDestructive
RowsAffected
CellsAffected
FailureMessage
```

---

# 6. DataCleaningComponent

الخدمات:

```ts
api
route
router
workflow
```

> **سبق في الجلسات السابقة:** Dependency Injection وSignals وRoute Parameters.

## HTML Dialog references

```ts
previewDialog
fixAllDialog
confirmDialog
```

تستخدم `viewChild<ElementRef<HTMLDialogElement>>`.

### previewDialog

تعرض Before/After قبل التطبيق.

### fixAllDialog

مراجعة الاقتراحات الآمنة.

### confirmDialog

تأكيد Undo أو Restore.

---

## Signals الأساسية

```text
loading
loadError
summary
suggestions
history
scope
railMode
issueType
columnFilter
search

selectedIds
strategyOverrides
customValues
duplicateColumns

preview
previewOperations
previewLoading
applyLoading
destructiveConfirmed

fixAllIds
feedback
selectedHistoryId
versions
confirmAction

reanalyzing
reanalysisCurrent
reanalysisTotal
reanalysisDataset
```

## Set داخل Signal

```ts
signal<Set<string>>(new Set())
```

> **مفهوم جديد صغير**

`Set` تخزن IDs بلا تكرار، ومناسبة للاختيارات المتعددة.

عند التحديث، الكود ينشئ نسخة:

```ts
const next = new Set(current);
```

ثم يضعها في Signal، حتى تلاحظ Angular أن المرجع تغير.

---

# 7. Scope والفلترة

```ts
type CleaningScope = 'project' | number;
```

- `project`: كل Datasets.
- رقم: Dataset محددة.

## RailMode

```ts
type RailMode = 'type' | 'dataset';
```

يسمح بالتنقل حسب:

- Issue type.
- Dataset.

## Filters

```text
issueType
columnFilter
search
scope
```

## filteredSuggestions

تطبق جميع الشروط:

```text
correct Dataset scope
correct issue type
correct column
search in type/dataset/column/description
```

## URL state

> **سبق في Dataset Import:** Query Parameters تحفظ حالة الصفحة.

تكتب:

```text
datasetId
issueType
column
```

باستخدام `replaceUrl: true`.

---

# 8. Suggestions وStrategies

## CleaningSuggestion

تمثل مشكلة واحدة قابلة للمراجعة.

```text
id
projectId
datasetId
versionId
datasetName
issueType
column
count
percentage
riskLabel
description
recommendedStrategy
availableStrategies
```

## CleaningStrategy

تمثل طريقة معالجة.

```text
key
label
operationType
parameters
isSafeRecommended
isDestructive
```

مثال Missing Numeric:

```text
Suggestion:
age has 20 missing values

Strategies:
- Fill median
- Fill mean
- Fill zero
- Custom value
- Delete affected rows
- Leave unchanged
```

## Strategy Override

الاقتراح لديه Recommended Strategy، لكن المستخدم يستطيع اختيار غيرها.

```ts
strategyOverrides: Record<suggestionId, strategyKey>
```

## Parameters

كل Strategy ترسل Parameters مختلفة:

```json
{
  "strategy": "median"
}
```

أو:

```json
{
  "action": "lowercase"
}
```

---

# 9. اختيار العمليات

## toggleSuggestion

تضيف أو تحذف Suggestion ID من `selectedIds`.

## toggleAllVisible

تتعامل فقط مع Suggestions التي تظهر بعد الفلاتر.

إذا كلها مختارة:

```text
unselect all visible
```

وإلا:

```text
select all visible
```

## selectedSuggestions

Computed تربط IDs بالعناصر الأصلية.

## buildOperation

تحول Suggestion + Strategy مختارة إلى Request:

```text
operationId
suggestionId
datasetId
operationType
column
parameters
```

إذا Strategy تحتاج Custom Value، تضيف:

```text
parameters.value
```

إذا Remove Duplicates والمستخدم كتب Columns مفصولة بفواصل:

```text
"id,email"
→ ["id", "email"]
```

---

# 10. Safe وDestructive

> **مفهوم جديد مهم**

## Safe Recommended

عملية Deterministic قليلة الخطورة، مثل:

```text
Trim spaces
Fill numeric missing with median
```

## Destructive

عملية تحذف معلومات:

```text
Delete rows
Remove duplicates
Delete column
Delete outlier rows
```

قد تكون صحيحة، لكنها غير قابلة للعكس داخل نفس Version؛ لذلك تحتاج Confirmation.

## Risk Label

الخدمة تولد مثل:

```text
High — destructive
Review — affects over 10%
Low — deterministic
```

## شرط التطبيق

إذا Preview تقول `destructive = true`:

```text
destructiveConfirmed must be true
```

وإلا `applyPreview()` لا تبدأ.

---

# 11. Preview قبل Apply

> **مفهوم جديد ومحوري**

Preview تنفذ العمليات على نسخة في الذاكرة فقط.

```http
POST /api/projects/{projectId}/cleaning/preview
```

Body:

```json
{
  "operations": [...]
}
```

## previewOperationsRequest

1. تمنع الطلب الفارغ.
2. تمنع طلبًا ثانيًا أثناء Loading.
3. ترسل Operations.
4. تخزن Response.
5. تخزن نفس Operations لاستخدامها في Apply.
6. تعيد `destructiveConfirmed = false`.
7. تفتح Dialog.

## لماذا تخزن previewOperations؟

حتى Apply تنفذ **نفس العمليات التي راجعها المستخدم**.

---

# 12. Before وAfter

Python تضيف رقمًا مؤقتًا لكل Row:

```text
__rowNumber
```

ثم:

1. تحفظ Original rows.
2. تنفذ العمليات.
3. تقارن Before وAfter حسب رقم الصف.
4. تختار الصفوف التي تغيرت.
5. تعيد أول 10 صفوف Preview.

كل عنصر:

```text
rowNumber
before
after
```

إذا Row حُذفت:

```text
before = row
after = null
```

إذا Row جديدة لم توجد — غير مستخدم حاليًا غالبًا — قد يكون العكس.

## previewColumns

الواجهة تجمع Keys من Before وAfter حتى تعرض Columns التي تغيرت أو أعيدت تسميتها.

---

# 13. Apply Cleaning

```http
POST /api/projects/{projectId}/cleaning/apply
```

Body:

```text
batchName
confirmDestructive
operations
```

## Frontend applyPreview

1. يتأكد Preview موجودة.
2. يتأكد Destructive Confirmed عند الحاجة.
3. يمنع ضغطًا متكررًا.
4. يرسل Apply.
5. يغلق Preview.
6. يعرض نتيجة Batch.
7. يعيد تحميل Workspace.
8. يمسح Selected Suggestions.

## Backend ApplyAsync

1. يتحقق من Project ownership.
2. يتحقق من Operations.
3. يضمن وجود Raw Versions.
4. يجمع Operations حسب Dataset.
5. يتحقق من ملكية كل Dataset.
6. يجلب Active Version.
7. ينفذ Preview في Python مرة أخرى.
8. يرفض Destructive إذا لم توجد Confirmation.
9. ينشئ CleaningBatch.
10. ينفذ Apply لكل Dataset.
11. يحفظ Version جديدة.
12. يسجل Operations.
13. يجمع النجاح والفشل.
14. يكمل Batch بالحالة النهائية.

## لماذا Preview مرتين؟

الـPreview الأولى للواجهة.

الـPreview داخل Apply للحماية من:

- Client معدلة يدويًا.
- تغيّر Active Version.
- نسيان تأكيد عملية خطرة.
- اختلاف Parameters المرسلة.

السيرفر لا يثق في قرار الواجهة وحدها.

---
# 14. Partial Success

إذا Batch تحتوي عمليات على عدة Datasets:

```text
customers succeeded
orders failed
products succeeded
```

الحالة تصبح:

```text
PartiallySucceeded
```

## Response

```text
batchId
correlationId
status
datasets[]
rowsAffected
cellsAffected
```

كل Dataset Result:

```text
success
versionId
versionNumber
rowsAffected
cellsAffected
error
```

## Frontend handleApplyResult

- لا توجد Failures → Success.
- توجد Failures → Warning مع أسماء Datasets الفاشلة.

## لماذا الفشل لا يلغي الناجح؟

التطبيق يعالج كل Dataset بشكل مستقل داخل Batch.

هذا يسمح:

- حفظ Versions الناجحة.
- تسجيل الفاشلة.
- إظهار تاريخ موحد.
- إعادة معالجة المشاكل لاحقًا.

لكن هذا يعني أن Batch قد تكون جزئية، وليست Transaction واحدة تغطي كل Project.

---

# 15. Fix All Safe

## safeSuggestions

```ts
filteredSuggestions.filter(
  suggestion =>
    suggestion.recommendedStrategy.isSafeRecommended
)
```

## openFixAllReview

- إذا لا توجد اقتراحات آمنة: Warning.
- وإلا تختار كل Safe IDs وتفتح Dialog.

## المستخدم يستطيع

- إزالة اقتراح من المجموعة.
- مراجعة المجموعة.
- Preview المجموعة المختارة.

## Backend ApplyRecommended

يوجد Endpoint:

```http
POST /api/projects/{projectId}/cleaning/apply-recommended
```

يأخذ IDs ويطبق فقط Suggestions التي:

```text
Recommended strategy is safe
AND ID selected or selection empty
```

الواجهة الحالية تستخدم مسار Preview ثم Apply للـsafe suggestions التي يراجعها المستخدم، بينما Endpoint يوفر مسارًا مباشرًا للـrecommended safe fixes.

---

# 16. History

```http
GET /api/projects/{projectId}/cleaning/history
```

يعيد آخر 100 Batch، الأحدث أولًا.

## CleaningHistoryEntry

```text
batchId
correlationId
name
user
createdAt
completedAt
status
isUndo
isRestore
operationCount
rowsAffected
cellsAffected
failureDetails
canUndo
operations
```

## showHistoryDetails

تفتح أو تغلق تفاصيل Batch حسب `selectedHistoryId`.

## Status classes

```text
Succeeded          → success
PartiallySucceeded → warning
Failed             → danger
other              → neutral
```

## CorrelationId

> **مفهوم جديد**

`Guid` يميز Batch عبر Logs وDatabase وResponses.

مثال:

```text
8c48f4a0-...
```

يفيد لتتبع عملية واحدة عندما تمر على عدة طبقات أو Datasets.

---

# 17. Undo

> **مفهوم جديد ومهم**

Undo لا يحذف Version الجديدة ولا يعدل History.

ينشئ **Batch Undo جديدة** و**Version جديدة** تحتوي نسخة من Source Version السابقة.

مثال:

```text
v1 Raw
→ v2 Fill missing
→ Undo v2
→ v3 copy of v1 content
```

`v3` هي Active، والتاريخ يبقى واضحًا.

## requestUndo

يفتح Confirmation فقط إذا `latestUndoable` موجودة.

## latestUndoable

آخر Batch يمكن Undo لها بشرط:

- ليست Undo.
- ليست Restore.
- أنتجت Result Versions.
- Result Versions ما زالت Active.

## لماذا الشرط الأخير؟

لو المستخدم طبق Cleaning أخرى بعد Batch:

```text
v1 → batch A → v2
v2 → batch B → v3 active
```

لا يمكن Undo batch A مباشرة؛ لأن v2 لم تعد Active، وقد يؤدي ذلك لتجاوز تغييرات لاحقة.

---

# 18. Restore Version

Restore يسمح باختيار Version قديمة محددة.

```http
POST /api/projects/{projectId}/cleaning/datasets/{datasetId}/restore
```

Body:

```json
{
  "versionId": 5
}
```

## requestRestore

لا تسمح باستعادة Version هي Active أصلًا.

## السلوك الداخلي

مثل Undo، لا تجعل Version القديمة Active مباشرة.

بل:

```text
Read selected old version
→ copy rows and columns
→ create new restore batch
→ create new version
→ set new version active
```

مثال:

```text
v1 Raw
v2 Cleaned
v3 More cleaned
Restore v1
→ v4 contains v1 data
```

هذا يحافظ على Audit Trail كامل.

---

# 19. Re-analysis

بعد كل Apply/Undo/Restore:

```text
Dataset.Status =
  Cleaned - Analysis Required
```

والـVersion الجديدة:

```text
AnalyzedAt = null
AnalysisResultJson = null
```

## rerunAnalysis

الواجهة تحلل جميع Datasets في Summary بالتسلسل:

```text
progressCurrent
progressTotal
reanalysisDataset
```

لكل Dataset:

```http
POST /api/datasets/{datasetId}/analyze
```

ثم:

- كلها نجحت → Success.
- بعضها فشل → Warning وأسماء الفاشلة.
- تعيد تحميل Workspace.

> **سبق في Data Analysis:** `firstValueFrom` وLoop التسلسلية والفشل الجزئي.

## لماذا إعادة التحليل ضرورية؟

لأن بعد التنظيف قد تتغير:

```text
Row count
Column count
Missing count
Duplicate count
Data types
Unique values
Outliers
Chart recommendations
Key candidates
Relationship hints
```

---

# 20. Quality Confirmation

```http
POST /api/projects/{projectId}/cleaning/confirm-quality
```

## شروط التأكيد

1. يوجد Active Version لكل Dataset.
2. كل Active Versions محللة.
3. توجد Cleaning Batch ناجحة/جزئية، **أو** لا توجد Suggestions أصلًا.
4. المستخدم يملك Project.

## حالة البيانات النظيفة أصلًا

مهم جدًا:

```text
No issues
→ no cleaning batch can exist
→ quality may still be confirmed
```

الخدمة لا تجبر المستخدم على عمل تعديل وهمي.

## confirmQuality()

في الواجهة:

- لا تعمل إلا إذا `canConfirmQuality`.
- ترسل الطلب.
- تعرض Success.
- تعيد تحميل Workspace.

---

# 21. Schema Ready

تأكيد الجودة لا يعتمد فقط على Boolean.

يخزن النظام Map:

```json
{
  "15": 3,
  "20": 2
}
```

المعنى:

```text
Dataset 15 confirmed at Version 3
Dataset 20 confirmed at Version 2
```

## IsSchemaReadyAsync

يقارن:

```text
current active version IDs
مع
confirmed version IDs
```

Schema Ready فقط إذا:

- يوجد Active Versions.
- العدد متساوٍ.
- كل Dataset Active Version تطابق المؤكدة.

## لو حدث Cleaning جديد

يتم مسح:

```text
QualityConfirmedAt
QualityConfirmedByUserId
ConfirmedVersionsJson
LastReanalyzedAt
```

فتصبح Schema غير جاهزة حتى إعادة التحليل والتأكيد.

## continueToSchema

ينتقل فقط إذا `schemaReady = true` إلى:

```text
/projects/{projectId}/schema-designer
```

---

# 22. CleaningController

```csharp
[ApiController]
[Authorize]
[Route("api/projects/{projectId:int}/cleaning")]
```

## Endpoints

| Method | Path | الوظيفة |
|---|---|---|
| GET | `/summary` | ملخص التنظيف |
| GET | `/suggestions` | الاقتراحات والفلاتر |
| POST | `/preview` | معاينة العمليات |
| POST | `/apply` | تطبيق Batch |
| POST | `/apply-recommended` | تطبيق الاقتراحات الآمنة |
| GET | `/history` | التاريخ |
| GET | `/datasets/{id}/versions` | Versions |
| GET | `/datasets/{id}/preview` | Active version preview |
| POST | `/undo-latest` | Undo |
| POST | `/datasets/{id}/restore` | Restore |
| POST | `/confirm-quality` | تأكيد الجودة |

## Execute<T>

> **مفهوم جديد صغير**

Controller تجمع Error mapping في Helper واحدة:

```text
ArgumentException       → 400
UnauthorizedAccess      → 403
KeyNotFound             → 404
InvalidOperation        → 409
HttpRequestException    → 502
```

## 409 Conflict

يستخدم عندما Request مفهومة لكن حالة النظام لا تسمح بالعملية.

أمثلة:

```text
Destructive operation without confirmation
No batch available to undo
Selected version already active
Re-analysis required before confirmation
Active version changed
```

---

# 23. CleaningService Summary

## GetSummaryAsync

المسار:

```text
Require owned project
→ Ensure raw versions
→ Get active versions
→ Build suggestions
→ Get history
→ Get cleaning state
→ compare active and confirmed versions
→ build project summary
```

## Summary Metrics

```text
totalDatasets
analyzedDatasets
unanalyzedDatasets
totalRows
totalColumns
totalIssues
rowsAffected
cellsAffected
missingValues
duplicateRows
lastAnalyzedAt
hasCleaningBatches
requiresReanalysis
canConfirmQuality
qualityConfirmed
schemaReady
datasets
issueCounts
```

## qualityConfirmed

ليس مجرد وجود `QualityConfirmedAt`.

يتأكد أيضًا أن Confirmed Versions تطابق Active Versions الحالية.

---

# 24. إنشاء Raw Version

`EnsureRawVersionsAsync` تضمن أن كل Dataset لديها Version 1.

إذا Dataset ليس لديها Versions:

```text
Create v1
IsRawOriginal = true
IsActive = true
RowsJson = current rows
ColumnsJson = current columns
Metrics = current metrics
Analysis = current analysis
CreatedAt = dataset.CreatedAt
```

ثم:

```text
Dataset.ActiveVersionId = v1.Id
```

## لماذا تنشأ عند فتح Cleaning؟

المشروع قد يحتوي Datasets أُنشئت قبل إضافة نظام Versioning.

هذه الدالة تعمل كـBackfill تدريجي.

## Concurrent requests

الواجهة تحمل Summary وSuggestions وHistory بالتوازي باستخدام `forkJoin`.

قد تصل عدة Requests أول مرة وتحاول إنشاء v1 نفسها.

Repository تمسك Unique Violation من PostgreSQL:

```text
request A creates v1
request B also tries
→ B gets unique violation
→ detaches losing entity
→ reads winner ID
→ continues normally
```

> **مفهوم جديد:** التعامل مع Race Condition على مستوى Database constraint.

---

# 25. بناء الاقتراحات

`BuildSuggestionsAsync` تقرأ `AnalysisResultJson` من كل Active Version.

إذا Version غير محللة:

```text
skip suggestions for that version
```

## مصادر الاقتراحات الحالية

من Analysis JSON:

- Missing Values لكل Column.
- Duplicate Rows.

ومن Rows/Columns Snapshot:

- Extra Spaces.
- Inconsistent Case.
- Numeric Outliers بـIQR.
- Currency/percentage markers.

الواجهة تحتوي Categories أوسع مثل:

```text
Data Type Issues
Invalid Dates
Other Issues
```

لكن الاقتراحات الفعلية تعتمد على ما تبنيه الخدمة من التحليل والبيانات الحالية.

## Suggestion ID

مبنية من:

```text
datasetId
versionId
issueType
column or row
```

مثال:

```text
15:3:missing-values:age
```

وجود Version ID يمنع استخدام Suggestion قديمة على Version جديدة.

---

# 26. Missing Values Strategies

## Numeric Columns

الخيارات:

```text
Median        safe recommended
Mean
Zero
Custom
Delete rows  destructive
Leave
```

الـRecommended الافتراضية:

```text
median
```

## Text/Other Columns

```text
Mode
Empty string
Custom
Forward fill
Backward fill
Delete rows
Leave
```

الـRecommended الافتراضية الحالية هي أول Strategy في القائمة:

```text
mode
```

لكن علامة `isSafeRecommended` تعتمد على تعريف Strategy في الخدمة.

## Median vs Mean

### Mean

```text
sum ÷ count
```

تتأثر بالقيم الشاذة.

### Median

القيمة الوسطى بعد الترتيب.

أكثر مقاومة للـOutliers، لذلك اختيرت كتوصية آمنة للأعمدة الرقمية.

## Forward Fill

يملأ Missing بآخر قيمة سابقة.

## Backward Fill

يملأ Missing بأقرب قيمة لاحقة.

هذه الطرق تعتمد على ترتيب Rows، لذلك يجب استخدامها فقط عندما ترتيب البيانات له معنى.

---

# 27. Extra Spaces وInconsistent Case

## Extra Spaces

تكتشف:

```text
leading spaces
trailing spaces
repeated whitespace
```

الاستراتيجيات:

```text
Trim and collapse spaces
Collapse repeated spaces
```

## Inconsistent Case

مثال:

```text
Riyadh
RIYADH
riyadh
```

تجمع القيم بعد Lowercase، ثم ترى إن كان الشكل الأصلي مختلفًا.

الخيارات:

```text
lowercase
uppercase
title case
```

## TryText وJsonElement

Rows المخزنة في Snapshots قد تُقرأ Values النصية كـ`JsonElement`.

الخدمة تتعامل مع:

```text
string
JsonElement String
```

حتى لا تضيع اقتراحات النصوص بعد Serialization/Deserialization.

---

# 28. Outliers وIQR

> **سبق ذكر IQR في Data Analysis بصورة عامة، وهنا استخدامه للتنظيف.**

## IQR

```text
Q1 = 25th percentile
Q3 = 75th percentile
IQR = Q3 - Q1
```

الحدود:

```text
Lower = Q1 - 1.5 × IQR
Upper = Q3 + 1.5 × IQR
```

القيم خارج الحدود تعتبر Outliers.

## شرط

يحتاج على الأقل 4 قيم رقمية.

## Strategies

```text
Cap to IQR bounds
Replace with median
Delete outlier rows
Keep unchanged
```

### Cap

القيمة الأقل من Lower تصبح Lower.

القيمة الأعلى من Upper تصبح Upper.

### Median

تستبدل Outlier بالـMedian.

### Delete

تحذف Row كاملة، لذلك Destructive.

## Multiplier

Python تقبل بين:

```text
0.5 and 5
```

والافتراضي:

```text
1.5
```

---

# 29. Duplicates

الاقتراح يبنى إذا Analysis فيها `duplicateRowsCount > 0`.

## Strategies

```text
Keep first
Keep last
```

ويمكن تحديد Subset من Columns.

مثال:

```text
email
```

يعني Row تعتبر Duplicate حسب Email فقط.

بدون Subset، تستخدم جميع Columns.

## لماذا Destructive؟

لأن Rows تُحذف.

## Python algorithm

- تبني Key من Values المحددة.
- تستخدم Set.
- تحفظ أول أو آخر Index حسب `keep`.
- تحذف بقية الصفوف.

---

# 30. Numeric/Currency normalization

تكتشف الخدمة النصوص التي تحتوي:

```text
$
€
£
¥
₹
SAR
USD
%
```

وتقترح:

```text
normalize_numeric
```

Parameters تشمل:

```text
removeThousands
decimalSeparator
currencySymbols
percentage
targetType
```

## أمثلة

```text
SAR 1,250.50 → 1250.5
25%          → 0.25
1.234,50     → 1234.5 عند اختيار decimal separator ","
```

## أهمية Locale Review

الشكل:

```text
1,234
```

قد يعني:

- ألف ومئتان وأربعة وثلاثون.
- أو 1.234 حسب Locale.

لذلك الاقتراح يطلب مراجعة صريحة، ولا يفترض Locale بلا قرار.

---
# 31. Python Request

.NET تبني `PythonCleaningRequestDto` من Active Version:

```text
datasetId
versionId
tableName
columns
rows
operations
```

كل Operation تتحول إلى:

```text
operationId
operationType
column
parameters
```

## Normalize Operation Type

.NET تحول:

```text
Trim
Lowercase
```

مثال:

```text
Fill_Missing
→ fill_missing
```

## Parameters

إذا لا توجد Parameters:

```json
{}
```

وإلا تحول `JsonElement` إلى Dictionary.

## لماذا يرسل Version ID؟

حتى Python Response تعيد `sourceVersionId`، والباك إند يعرف أن النتيجة مبنية على Version محددة.

لكن الحماية النهائية من تغير Active Version تتم في Repository قبل الحفظ.

---

# 32. Python CleaningService

FastAPI تعرض:

```http
POST /cleaning/preview
POST /cleaning/apply
```

كلاهما يستدعي:

```python
cleaning_service.execute(request)
```

## ملاحظة مهمة

Python تنفذ نفس Engine للـPreview والـApply.

الفرق ليس داخل Python؛ الفرق أن:

- Preview Response تُعرض فقط.
- Apply Response يحفظها .NET كVersion جديدة.

## لا يوجد .NET fallback للتنظيف

> **اختلاف مهم عن Data Analysis**

في Analysis:

```text
Python failure
→ .NET fallback
```

في Cleaning:

```text
Python failure
→ HttpRequestException
→ 502 Cleaning execution unavailable
```

السبب أن عمليات التنظيف كثيرة وحساسة، ولا توجد حاليًا نسخة .NET مكافئة بالكامل.

---

# 33. ترتيب العمليات

> **مفهوم جديد ومهم**

إذا أرسل المستخدم عدة Operations، Python لا تعتمد فقط على ترتيب اختيار المستخدم.

لديها Priorities:

```text
10 rename_column
20 text_normalize
30 normalize_numeric
40 convert_type
41 parse_date
50 fill_missing
60 handle_outliers
70 remove_duplicates
80 delete_rows
81 delete_rows_condition
90 delete_column
```

## لماذا؟

ترتيب العمليات يغير النتيجة.

مثال:

```text
Normalize numeric
ثم
Handle outliers
```

أفضل من محاولة حساب Outliers على قيم مثل:

```text
"SAR 1,000"
```

مثال آخر:

```text
Rename column
قبل
Operation تعتمد على اسم العمود الجديد
```

## الحفاظ على الترتيب داخل نفس Priority

Python تستخدم:

```text
priority
ثم original index
```

فتبقي ترتيب المستخدم للعمليات من النوع نفسه.

## executionOrder

Response تعيد IDs بالترتيب الفعلي الذي نُفذ.

---

# 34. عمليات Python المدعومة

## rename_column

- يتحقق من اسم جديد صالح.
- يمنع اسمًا مكررًا.
- يغير Key في كل Row.
- يغير اسم Column.
- يحسب Affected Rows/Cells.

## text_normalize

Actions:

```text
trim
collapse_spaces
lowercase
uppercase
title_case
replace_exact
find_replace
```

## normalize_numeric

- إزالة Currency symbols معروفة.
- إزالة Thousands separators.
- تحديد Decimal separator.
- تحويل Percentage.
- تحويل إلى integer أو decimal.
- تسجيل Conversion Failures.

## convert_type

Targets:

```text
integer
decimal
string
boolean
datetime
```

Invalid actions:

```text
leave
null
```

## parse_date

Formats:

```text
iso
yyyy-mm-dd
dd/mm/yyyy
mm/dd/yyyy
yyyy-mm-dd hh:mm:ss
dd-mm-yyyy
mm-dd-yyyy
```

Invalid actions:

```text
leave
null
replace
delete
```

## fill_missing

```text
custom
mean
median
zero
empty
mode
forward_fill
backward_fill
delete_rows
leave
```

## handle_outliers

```text
keep
cap
median
delete
```

## remove_duplicates

```text
keep first
keep last
subset columns
```

## delete_rows

يحذف Rows حسب `rowNumbers`.

## delete_rows_condition

Operators:

```text
equals
not_equals
contains
greater_than
less_than
is_missing
```

## delete_column

- يمنع حذف آخر Column في Dataset.
- يحذف القيمة من كل Row.
- يزيل Column definition.
- Destructive دائمًا.

---

# 35. Preview Calculation

داخل Python:

1. تعمل Deep Copy للـRows.
2. تضيف `__rowNumber`.
3. تنفذ Operations على Copy.
4. تبني Map Before وAfter.
5. تجد أرقام Rows المتغيرة.
6. تعيد أول 10 Changed Rows.
7. تجمع Metrics.

## Response

```text
datasetId
sourceVersionId
executionOrder
columns
resultRows
previewRows
operationResults
affectedRows
affectedCells
rowsRemoved
columnsRemoved
columnsRenamed
conversionFailures
warnings
destructive
```

## affectedRows

عدد Rows المختلفة بين Original وResult.

## affectedCells

مجموع Cells التي أعلنت Operations أنها عدلتها.

## rowsRemoved

```text
original count - result count
```

## Conversion Failures

تحتوي:

```text
rowNumber
column
value
reason
```

هذه لا تعني دائمًا فشل العملية كاملة؛ قد تعني أن بعض القيم تُركت أو تحولت إلى Null حسب Strategy.

## Warnings

تجمع Warnings من كل Operation وتزيل التكرار مع الحفاظ على الترتيب.

---

# 36. PersistVersionAsync

> **هذه أهم دالة Repository في الفيتشر**

المسار:

```text
Start transaction
→ load Dataset + Versions
→ verify source version is still active
→ deactivate current active versions
→ calculate next version number
→ calculate new missing/duplicates
→ create DatasetVersion
→ save version
→ create CleaningOperation records
→ set Dataset.ActiveVersionId
→ update Dataset metrics/status
→ invalidate quality state
→ save
→ commit
```

## Version Number

```text
max existing version number + 1
```

## ParentVersionId

تشير إلى Version التي انطلقت منها العملية.

مثال:

```text
v3.ParentVersionId = v2.Id
```

وبذلك يمكن تتبع شجرة النسخ.

## Snapshot

تحفظ:

```text
RowsJson
ColumnsJson
```

من نتيجة Python كاملة، لا فرق Rows فقط.

هذا يسهل Restore، لكنه يستهلك Storage أكبر.

## Analysis reset

Version الجديدة لا تأخذ Analysis القديمة.

Dataset تصبح:

```text
Status = Cleaned - Analysis Required
AnalysisResultJson = null
AnalyzedAt = null
```

---

# 37. حماية Active Version

قبل الحفظ:

```csharp
if (dataset.ActiveVersionId != sourceVersionId)
```

ترمي:

```text
The active dataset version changed.
Refresh and preview again.
```

> **مفهوم جديد: Optimistic Concurrency Check مبسط**

مثال:

```text
User A previews v2
User B applies cleaning and creates v3
User A tries to apply old preview based on v2
→ rejected
```

بدون هذا الفحص، User A قد ينشئ Version مبنية على بيانات قديمة ويتجاوز تغييرات User B.

## لماذا Preview يجب أن تعاد؟

لأن Before/After التي شاهدها المستخدم لم تعد مبنية على Active data.

---

# 38. Cleaning Batch وOperation History

## CreateBatchAsync

تنشئ:

```text
Status = Running
CorrelationId = new Guid
CreatedAt = UtcNow
IsUndo / IsRestore flags
```

## أثناء النجاح

لكل Operation تسجل:

```text
SourceVersionId
ResultVersionId
Order
OperationType
Column
ParametersJson
Status = Succeeded
IsDestructive
RowsAffected
CellsAffected
```

## أثناء الفشل

`AddFailedOperationsAsync` تسجل:

```text
Status = Failed
FailureMessage
ResultVersionId = null
```

## CompleteBatchAsync

تحدث:

```text
Status
RowsAffected
CellsAffected
OperationCount
FailureDetailsJson
CompletedAt
```

## Batch Status

```text
Succeeded
PartiallySucceeded
Failed
```

---

# 39. Transactions

> **سبق في Dataset Import، وهنا استخدامها أعمق.**

`PersistVersionAsync` تفتح Transaction عند Relational Database.

الهدف أن هذه الخطوات تكون Atomic:

```text
deactivate old version
create new version
create operation logs
update dataset active version
reset analysis
invalidate quality
```

إذا فشل أي جزء، لا نريد:

- Version جديدة بلا Active link.
- Active link بلا Operation history.
- Quality confirmed على Version تغيرت.
- Old version deactivated بلا بديل.

## حدود Transaction

كل Dataset تُحفظ بشكل مستقل داخل Batch.

لذلك يمكن أن:

```text
Dataset A transaction commits
Dataset B fails
```

فتكون Batch `PartiallySucceeded`.

---

# 40. Invalidate Quality

كل Cleaning/Undo/Restore جديدة تستدعي:

```text
InvalidateStateTrackedAsync
```

وتحدث:

```text
LastCleaningBatchId = current batch
QualityConfirmedAt = null
QualityConfirmedByUserId = null
ConfirmedVersionsJson = null
LastReanalyzedAt = null
UpdatedAt = now
```

## لماذا؟

لأن تأكيد الجودة كان على محتوى Versions قديمة.

أي Version جديدة تعني أن الموافقة السابقة لم تعد صالحة.

---

# 41. Undo وRestore داخليًا

## CopyVersionsAsync

تستخدمها العمليتان.

1. تجلب Target Version.
2. تفك `ColumnsJson` و`RowsJson`.
3. تبني Operation اصطناعية:
   - `undo_batch`
   - أو `restore_version`
4. تبني PythonCleaningResponseDto داخل .NET مباشرة من Snapshot.
5. تستدعي `PersistVersionAsync`.
6. تنشئ Version جديدة.
7. تكمل Batch.

## لماذا لا تستدعي Python؟

Undo/Restore لا تحتاج Transformations؛ هي نسخ Snapshot موجودة.

## Affected counts

تحسب بشكل تقريبي واسع:

```text
max(active rows, target rows)
max(active rows, target rows)
× max(active columns, target columns)
```

لأن العملية تستبدل Snapshot كاملة.

---

# 42. ProjectCleaningState

Entity واحدة لكل Project.

```text
ProjectId
LastCleaningBatchId
LastReanalyzedAt
QualityConfirmedAt
QualityConfirmedByUserId
ConfirmedVersionsJson
UpdatedAt
```

## ConfirmQualityAsync Repository

- تنشئ State إذا غير موجودة.
- تحفظ وقت ومستخدم التأكيد.
- تحفظ Map Dataset → Active Version.
- تحدث `LastReanalyzedAt`.
- تحفظ.

## Schema readiness ليست Boolean ثابتة

تُحسب بالمقارنة بين:

```text
ConfirmedVersionsJson
و
Datasets.ActiveVersionId
```

هذا يمنع بقاء Schema Ready بعد تغيير Dataset.

---

# 43. DTOs وEntities

> **سبق في الجلسات السابقة:** DTO للعقد وEntity لقاعدة البيانات.

## ProjectCleaningSummary

تجمع حالة Project كاملة.

## CleaningSuggestion

المشكلة + Strategies.

## CleaningOperationRequest

```text
operationId
suggestionId
datasetId
operationType
column
parameters
```

## CleaningPreviewResponse

نتيجة مؤقتة لا تحفظ.

## CleaningApplyResponse

Batch ونتائج Datasets.

## CleaningHistory

Batches وOperations.

## DatasetVersion DTO

```text
id
datasetId
parentVersionId
versionNumber
isRawOriginal
isActive
rowCount
columnCount
operationSummary
createdAt
analyzedAt
createdBy
```

## QualityConfirmation

```text
projectId
qualityConfirmed
schemaReady
confirmedAt
confirmedVersions
```

---

# 44. المسارات الكاملة

## فتح Workspace

```text
/projects/5/data-cleaning
→ read route/query filters
→ forkJoin:
   summary
   suggestions
   history
→ ensure raw versions
→ display issues
```

## Preview Suggestion

```text
choose suggestion
→ choose strategy
→ build operation
→ POST cleaning/preview
→ ownership check
→ active version snapshot
→ Python execute on copy
→ before/after response
→ open dialog
```

## Apply

```text
review preview
→ confirm destructive if needed
→ POST cleaning/apply
→ preview again server-side
→ create batch
→ Python apply per dataset
→ transaction
→ create new version
→ operation history
→ set active
→ reset analysis
→ invalidate quality
→ complete batch
→ reload workspace
```

## Re-analysis

```text
new active versions
→ analyze each dataset
→ save AnalysisResultJson in version
→ summary no longer requires reanalysis
```

## Confirm Quality

```text
all active versions analyzed
→ cleaning batch exists OR no issues
→ save confirmed version map
→ compare active map
→ schemaReady = true
```

## Undo

```text
latest undoable batch
→ verify its result versions still active
→ copy source snapshots
→ create Undo batch + new versions
```

## Restore

```text
choose old version
→ copy snapshot
→ create Restore batch + new version
```

---

# 45. الحالات والأخطاء

## Cleaning statuses

### Dataset

```text
Analyzed
Cleaned - Analysis Required
```

### Batch

```text
Running
Succeeded
PartiallySucceeded
Failed
```

### Version

```text
Raw Original
Cleaned
Active / Inactive
Analyzed / Requires Analysis
```

## HTTP Codes

| Code | الاستخدام |
|---:|---|
| 200 | كل Cleaning endpoints الناجحة |
| 400 | Request أو Operations غير صالحة |
| 401 | Authentication مفقودة |
| 403 | Project/Dataset ليست للمستخدم |
| 404 | Version أو Resource غير موجودة |
| 409 | حالة النظام تمنع العملية |
| 422 | FastAPI/Pydantic Validation |
| 502 | Python Cleaning service لم تكمل الطلب |

## أمثلة 409

```text
Destructive not confirmed
No undoable batch
Version already active
Active version changed
Quality cannot be confirmed
```

## حد Operations

```text
1 to 100 operations per request
```

Python كذلك تحد Requests إلى:

```text
100,000 rows
at least one column
unique column names
```

---

# 46. الاختبار العملي

## Workspace

- Project بلا Datasets.
- Project بـDataset واحدة.
- عدة Datasets.
- Filter حسب Type.
- Filter حسب Column.
- Search.
- Dataset Query Parameter.
- Issue Type Query Parameter.
- Raw Versions تُنشأ أول مرة.
- عدة Endpoints تصل بالتوازي أول مرة.

## Missing Values

- Numeric Median.
- Mean.
- Zero.
- Custom.
- Delete rows.
- Text Mode.
- Forward fill.
- Backward fill.
- لا توجد Present Values للـMean/Mode.

## Text

- Leading/trailing spaces.
- Repeated spaces.
- Lower/Upper/Title.
- Find/replace.
- Non-string values لا تتغير.

## Numeric

- Currency symbols.
- Thousands separators.
- Decimal comma.
- Percentage.
- Integer conversion مع قيمة كسرية.
- Conversion failures.

## Dates

- ISO.
- dd/mm/yyyy.
- Invalid date مع Leave.
- Null.
- Replace.
- Delete.

## Outliers

- أقل من 4 قيم.
- IQR Cap.
- Median replacement.
- Delete.
- Multiplier خارج 0.5–5.

## Duplicates

- Keep first.
- Keep last.
- All columns.
- Subset columns.
- Unknown column.

## Destructive safety

- Preview destructive.
- Apply بدون Confirmation.
- Apply مع Confirmation.
- Delete final column مرفوض.

## Versioning

- v1 Raw.
- Apply ينشئ v2.
- Apply ثاني ينشئ v3.
- ParentVersion صحيح.
- Version واحدة فقط Active.
- Analysis reset.
- Metrics updated.

## Concurrency

- Preview v2 ثم Version تتغير إلى v3.
- Apply القديمة تعيد 409.
- Concurrent raw version creation.

## History

- Success.
- Partial.
- Failed.
- Operation details.
- Failure message.
- CorrelationId.
- آخر 100 فقط.

## Undo/Restore

- Undo latest وهي Active.
- Undo بعد Batch أخرى يجب أن يرفض.
- Restore Version inactive.
- Restore Active version يرفض.
- Undo/Restore تنشئ Version جديدة.

## Quality

- لا يسمح قبل Re-analysis.
- يسمح بعد Re-analysis.
- Data نظيفة بلا Batch.
- Cleaning جديدة تلغي Confirmation.
- Confirmed versions تطابق Active.
- Continue to Schema فقط عند Ready.

## Python unavailable

- Preview تعيد 502.
- Apply تعيد 502 أو Dataset failure حسب موضع الفشل.
- لا يوجد .NET fallback.

---

# 47. ملخص الحفظ السريع

## الدورة

```text
Analyze
→ Suggest
→ Select strategy
→ Preview
→ Confirm destructive
→ Apply batch
→ New version
→ Re-analyze
→ Confirm quality
→ Schema
```

## التخزين

```text
Dataset = logical current source
DatasetVersion = full snapshot
CleaningBatch = one user apply action
CleaningOperation = each transformation
ProjectCleaningState = quality approval state
```

## الأمان

```text
JWT ownership
server-side preview
destructive confirmation
active version concurrency check
transaction
quality invalidation
```

## Python

```text
sort operations by priority
deep copy rows
execute transformations
calculate before/after
return result rows and metrics
```

## مفاهيم جديدة

```text
Versioned datasets
Cleaning batch
Operation audit trail
Safe vs destructive
Before/after preview
Correlation ID
Optimistic concurrency check
Quality confirmation by exact version map
Undo as new version
Restore as new version
Operation priority
Partial success across datasets
```

## مفاهيم سبقت

```text
Signals and computed
Set and Record state
Route/query parameters
forkJoin
firstValueFrom
Python FastAPI
Pydantic
DTO vs Entity
Transactions
JWT ownership
Active Version
Re-analysis
```

---

# 48. تحسينات مؤجلة لما بعد الفهم

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. إضافة .NET fallback لبعض عمليات التنظيف الأساسية أو Health check قبل Preview.
2. جعل Preview tokenized بحيث Apply تثبت أنها تطبق نفس Preview المعروضة.
3. إضافة Row/Version checksum للحماية الأقوى من تغير البيانات.
4. Transaction موحدة اختيارية لكل Batch عبر عدة Datasets إذا تطلبت Atomicity كاملة.
5. توضيح الفرق بين Safe وNon-destructive؛ ليس كل Non-destructive موصى به تلقائيًا.
6. حساب Data Quality Score بدل `null`.
7. توليد Suggestions أوضح لـData Type Issues وInvalid Dates.
8. دعم Manual Operations من UI مثل Rename/Delete Column وConditional Delete.
9. Pagination لتاريخ أكثر من 100 Batch.
10. مقارنة Version-to-Version كاملة.
11. ضغط RowsJson/ColumnsJson أو تخزين Snapshot أكثر كفاءة.
12. سياسة Retention للـVersions القديمة.
13. إظهار Conversion Failures بشكل تفصيلي في UI.
14. إظهار Execution Order قبل Apply.
15. توحيد Affected Rows/Cells semantics بين العمليات.
16. دعم Redo.
17. منع عمليات متعارضة على نفس Column قبل إرسالها.
18. Idempotency key لمنع Apply مكرر عند مشاكل الشبكة.
19. Logging وربط CorrelationId بين .NET وPython.
20. Tests للـrollback عند فشل منتصف `PersistVersionAsync`.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. لماذا التنظيف يحتاج Analysis أولًا.
2. لماذا لا يعدل النظام Raw Dataset مباشرة.
3. الفرق بين Dataset وDatasetVersion.
4. الفرق بين Batch وOperation.
5. كيف تبنى Suggestions وStrategies.
6. الفرق بين Safe وDestructive.
7. كيف تعمل Before/After Preview.
8. لماذا يعيد الباك إند Preview قبل Apply.
9. كيف تنفذ Python العمليات بترتيب محدد.
10. كيف تنشأ Version جديدة داخل Transaction.
11. كيف يمنع النظام Apply على Version قديمة.
12. كيف يعمل Partial Success.
13. لماذا Undo وRestore تنشئ Versions جديدة.
14. لماذا يجب إعادة التحليل.
15. كيف يعتمد Schema Ready على Version IDs المؤكدة.
16. لماذا لا يوجد حاليًا Fallback للتنظيف عند توقف Python.
