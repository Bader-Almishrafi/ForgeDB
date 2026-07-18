# ForgeDB — دليل جلسة Data Analysis الكامل

> **الجلسة رقم 04 — Data Analysis**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم تشغيل التحليل من Angular إلى .NET ثم Python، طريقة بناء النتائج، الـfallback إلى .NET، تحليل المشروع كاملًا أو Dataset واحدة، وعرض الجودة والرسوم والتوصيات.

---

## طريقة استخدام الدليل

- هذا الملف هو الشرح الكامل، والشات للأسئلة.
- **سبق في Projects** أو **سبق في Dataset Import**: المفهوم مر سابقًا، وسأراجع استخدامه هنا.
- **مفهوم جديد**: يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة، حسب الاتفاق.

---

# المحتويات

1. الصورة العامة  
2. ما الفرق بين Import وAnalysis  
3. الصفحات والمسارات  
4. الملفات والطبقات  
5. شكل التحليل الكامل  
6. AnalyzeDataComponent  
7. Scope: مشروع كامل أو Dataset واحدة  
8. تحميل Workspace ونتائج التحليل  
9. forkJoin وmergeMap والتوازي المحدود  
10. runAnalysis  
11. firstValueFrom وasync/await  
12. الفشل الجزئي وإعادة المحاولة  
13. النتائج والملخصات  
14. Column Analysis  
15. Data Quality وIssues  
16. Visualizations وECharts  
17. Chart Recommendations  
18. DatasetsController  
19. DatasetImportService  
20. بناء طلب Python  
21. PythonAnalysisClient  
22. FastAPI Service  
23. Pydantic Validation  
24. Python AnalysisService  
25. اكتشاف نوع البيانات  
26. Numeric Statistics  
27. Most Common Values وCardinality  
28. Missing Values وDuplicate Rows  
29. Relationship Suggestions  
30. .NET Fallback  
31. DatasetAnalysisBuilder  
32. دمج Python مع .NET  
33. Key Candidates وDate Ranges وRelationship Hints  
34. حفظ نتائج التحليل  
35. DTOs وContracts  
36. Status وDataset Versions  
37. المسارات الكاملة  
38. الأخطاء والاختبار  
39. ملخص الحفظ  
40. تحسينات مؤجلة

---

# 1. الصورة العامة

التحليل يبدأ بعد استيراد Dataset.

```text
Dataset imported
→ User runs analysis
→ .NET loads rows and columns
→ .NET calls Python FastAPI
→ Python profiles the data
→ .NET enriches and normalizes the result
→ Result saved in PostgreSQL
→ Angular displays quality, columns and charts
```

التحليل ينتج:

- عدد الصفوف والأعمدة.
- Missing Values.
- Duplicate Rows.
- نوع كل عمود.
- Unique Values.
- Sample Values.
- Numeric Statistics.
- Most Common Values.
- توزيع أنواع الأعمدة.
- Key Candidates.
- Date Ranges.
- Relationship Hints.
- Chart Recommendations.

---

# 2. الفرق بين Import وAnalysis

> **سبق في Dataset Import:** الاستيراد يقرأ المصدر ويحفظ Dataset وColumns وRows.

## Import

هدفه:

```text
تحويل CSV / Excel / API
إلى بيانات محفوظة قابلة للعمل
```

وينتج Metrics أولية مثل:

```text
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
Status = Imported
```

## Analysis

هدفه:

```text
فهم البيانات بشكل أعمق
```

ويضيف:

```text
Column profiles
Numeric statistics
Top values
Detailed type distribution
Chart recommendations
Key candidates
Date ranges
Relationship hints
Status = Analyzed
AnalyzedAt
```

الاستيراد شرط قبل التحليل؛ لا توجد Rows لتحليلها قبل الحفظ.

---

# 3. الصفحات والمسارات

المسارات الرئيسية:

```text
/projects/:projectId/analysis
/datasets/:datasetId/analyze
```

كلاهما يستخدم `AnalyzeDataComponent`.

## Project route

```text
/projects/5/analysis
```

يفتح تحليل جميع Datasets في Project، أو يسمح باختيار Dataset محددة.

## Dataset route

```text
/datasets/17/analyze
```

يفتح Dataset محددة، وقد يأخذ Project context من:

```text
?returnProject=5
```

## Tabs

```ts
type AnalysisTab =
  | 'overview'
  | 'columns'
  | 'quality'
  | 'visualizations'
  | 'issues';
```

- Overview: ملخص عام.
- Column Analysis: تفاصيل الأعمدة.
- Data Quality: مؤشرات الجودة.
- Visualizations: الرسوم والتوصيات.
- Issues: قائمة المشاكل.

---

# 4. الملفات والطبقات

## Frontend

```text
pages/analyze-data/analyze-data.component.ts
pages/analyze-data/analyze-data.component.html
pages/analyze-data/analysis-chart.component.ts
pages/analyze-data/analysis-chart.component.html
services/forge-api.service.ts
services/api.models.ts
services/workflow-state.service.ts
```

## Backend

```text
Controllers/DatasetsController.cs
Services/DatasetImportService.cs
Services/DatasetAnalysisBuilder.cs
Clients/PythonAnalysisClient.cs
Clients/IPythonAnalysisClient.cs
Repositories/DatasetRepository.cs
Program.cs
```

## Python

```text
python-analysis-service/app/main.py
python-analysis-service/services/analysis_service.py
python-analysis-service/models/analysis_request.py
python-analysis-service/models/analysis_response.py
```

## المسار الطبقي

> **سبق في Projects وDataset Import:**  
> `Component → API Service → Controller → Service → Repository`.

التحليل يضيف Microservice:

```text
AnalyzeDataComponent
→ ForgeApiService
→ DatasetsController
→ DatasetImportService
→ PythonAnalysisClient
→ HTTP
→ FastAPI /analyze
→ AnalysisService.py
→ Python response
→ DatasetAnalysisBuilder
→ DatasetRepository
→ PostgreSQL
```

---

# 5. شكل التحليل الكامل

```text
Angular chooses targets
        ↓
POST /api/datasets/{id}/analyze
        ↓
Controller checks JWT ownership
        ↓
DatasetImportService loads full Dataset
        ↓
Build Python request
        ↓
POST http://localhost:8001/analyze
        ↓
Python profiles columns and rows
        ↓
.NET maps and enriches response
        ↓
Save AnalysisResultJson + metrics
        ↓
Return DatasetAnalysisResponse
        ↓
Angular updates UI
```

إذا Python فشلت:

```text
Python timeout/error
→ log warning
→ return null
→ DatasetAnalysisBuilder.Build in .NET
→ analysis still completes
```

هذا يسمى **Graceful Fallback**.

---

# 6. AnalyzeDataComponent

هذا Component يدير تحليل Dataset واحدة أو Project كاملة.

## أنواع مهمة

```ts
type AnalysisScope = 'project' | number;
```

- `'project'`: جميع Datasets.
- رقم: Dataset ID محددة.

```ts
interface AnalysisLoadResult {
  dataset: DatasetResponse;
  analysis: DatasetAnalysisResponse | null;
  error: string;
}
```

نتيجة تحميل Analysis محفوظة.

```ts
interface AnalysisFailure {
  datasetId: number;
  datasetName: string;
  message: string;
}
```

تستخدم للفشل الجزئي.

## Signals الأساسية

```text
project
datasets
analyses
scope
activeTab
loading
resultsLoading
loadError
running
progressCurrent
progressTotal
progressDataset
executionFailures
resultLoadFailures
feedback
```

## analyses

```ts
signal<Record<number, DatasetAnalysisResponse>>({})
```

> **مفهوم جديد**

بدل Array، تخزن النتائج كـMap حسب Dataset ID:

```ts
{
  15: analysisOfCustomers,
  20: analysisOfOrders
}
```

الوصول يصبح:

```ts
this.analyses()[dataset.id]
```

وهذا أسرع وأوضح من البحث في Array كل مرة.

---

# 7. Scope: مشروع كامل أو Dataset واحدة

## selectedDataset

إذا `scope` رقم، تبحث عن Dataset المطابقة.

## scopeDatasets

```text
Dataset محددة → [selectedDataset]
Project scope → all datasets
```

## scopeAnalyses

تفلتر نتائج التحليل لتطابق Datasets الحالية في Scope.

## selectProjectScope()

- يمنع التغيير أثناء Run.
- يضع `scope = project`.
- يمسح اختيار Column.
- يعيد Filters.
- يمسح Dataset من WorkflowState.
- يحدث URL.

## selectDataset(dataset)

- يمنع التغيير أثناء Run.
- يضع `scope = dataset.id`.
- يحفظ Dataset في WorkflowState.
- يحدث URL بـ`datasetId`.

> **سبق في Dataset Import:** Query Parameters تحفظ حالة الاختيار في URL.

---

# 8. تحميل Workspace ونتائج التحليل

## ngOnInit

يحاول تحديد Project ID من عدة مصادر:

```text
1. projectId من Route
2. returnProject من Query
3. WorkflowState.projectId
```

ثم:

- Project موجود → `loadProjectWorkspace`.
- Dataset route فقط → `loadStandaloneDataset`.
- لا يوجد Context → العودة إلى Projects.

## loadProjectWorkspace

تستخدم `loadVersion`.

```ts
const version = ++this.loadVersion;
```

> **مفهوم جديد**

كل عملية تحميل تأخذ رقم نسخة.  
إذا بدأت عملية أحدث، تتجاهل نتيجة القديمة:

```text
load version 1 starts
load version 2 starts
version 1 finishes later
→ ignored
```

هذا يمنع Race Condition في تحديث الصفحة.

## loadStandaloneDataset

إذا لا يوجد Project context، تحمل Analysis مباشرة وتبني `DatasetResponse` مؤقتة من بيانات التحليل.

هذه الحالة تعرض المعلومات الأساسية، لكن لا تملك معلومات المصدر الكاملة.

---

# 9. forkJoin وmergeMap والتوازي المحدود

## forkJoin

> **مفهوم جديد**

في `loadProjectWorkspace`:

```ts
forkJoin({
  project: api.getProject(projectId),
  datasets: api.getProjectDatasets(projectId)
})
```

يرسل الطلبين معًا وينتظر نجاحهما الاثنين.

النتيجة:

```ts
{
  project,
  datasets
}
```

مناسب لأن الطلبين مستقلان.

إذا أحدهما فشل، يفشل `forkJoin` كاملة.

## mergeMap

تحميل Analysis المحفوظة:

```ts
from(analyzedDatasets).pipe(
  mergeMap(
    dataset => getDatasetAnalysis(dataset.id),
    4
  ),
  toArray()
)
```

> **مفهوم جديد**

`mergeMap` يسمح بالتوازي.

الرقم `4` يعني:

```text
Maximum 4 requests at the same time
```

بدل إرسال 50 طلبًا معًا أو تنفيذها واحدًا واحدًا.

## الفرق عن concatMap

> **سبق في Projects:** `concatMap` رفعت الملفات بالترتيب واحدة بعد الأخرى.

```text
concatMap → concurrency 1, preserves sequence
mergeMap  → concurrency multiple, faster
```

تحميل نتائج مستقلة مناسب لـ`mergeMap`.

---

# 10. runAnalysis

هذه أهم دالة في الواجهة.

## شروط البداية

لا تبدأ إذا:

- Analysis تعمل حاليًا.
- Scope لا يحتوي Datasets.
- لا توجد Targets.

## التهيئة

```text
running = true
feedback = null
progressCurrent = 0
progressTotal = target count
executionFailures = []
```

## Loop

```ts
for (let index = 0; index < targets.length; index++)
```

تحلل Datasets بالتسلسل.

لكل Dataset:

1. تحدث Progress.
2. تعرض اسم Dataset الحالية.
3. تستدعي Endpoint.
4. تضيف النتيجة إلى `analyses`.
5. تغير Status المحلية إلى `Analyzed`.
6. عند الخطأ تسجل Failure وتكمل.

## لماذا Loop تسلسلية؟

حتى:

- Progress واضح.
- لا تضغط Python service بطلبات كثيرة.
- تعرف Dataset الحالية.
- الفشل لا يوقف البقية.

## بعد الانتهاء

إذا توجد نجاحات، تعيد تحميل النتائج المحفوظة من الباك إند.

ثم Feedback:

- كلها نجحت → Success.
- بعض نجح وبعض فشل → Warning.
- كلها فشلت → Error.

---
# 11. firstValueFrom وasync/await

> **مفهوم جديد**

Angular HttpClient يعيد Observable، لكن `runAnalysis()` مكتوبة كـ`async`.

```ts
const response = await firstValueFrom(
  api.analyzeDataset(...)
);
```

`firstValueFrom` تحول أول قيمة من Observable إلى Promise.

هذا يسمح باستخدام:

```ts
try
catch
await
```

داخل Loop.

مناسب هنا لأن HTTP Observable ترسل Response واحدة ثم تنتهي.

---

# 12. الفشل الجزئي وإعادة المحاولة

يوجد نوعان من الفشل:

## executionFailures

تحليل جديد فشل أثناء `runAnalysis`.

## resultLoadFailures

Dataset حالتها Analyzed، لكن تحميل نتيجتها المحفوظة فشل.

## analysisTargets()

إذا Project Scope:

1. تجمع IDs الفاشلة.
2. تختار:
   - الفاشلة.
   - أو التي لا توجد لها Analysis محملة.
3. إذا لا توجد Pending، تختار كل Datasets لإعادة التحليل الكامل.

لذلك زر Retry لا يعيد الناجح بلا حاجة.

## runButtonLabel

يتغير حسب الحالة:

```text
Run Project Analysis
Run Analysis
Retry Failed Analysis
Re-run Project Analysis
Re-run Analysis
Analyzing 2 of 5
```

---

# 13. النتائج والملخصات

## summary

Computed تجمع النتائج الحالية:

```text
totalDatasets
analyzedDatasets
notAnalyzedDatasets
totalRows
totalColumns
analyzedRows
analyzedCells
missingValues
missingPercentage
duplicateRows
duplicatePercentage
issueCount
typeCounts
numericColumns
textColumns
dateColumns
booleanColumns
lastAnalyzedAt
```

## missingPercentage

```text
missing values
÷ analyzed cells
× 100
```

و:

```text
analyzed cells = rows × columns
```

## duplicatePercentage

```text
duplicate rows
÷ analyzed rows
× 100
```

## typeCategory

تجمع أسماء أنواع مختلفة في Categories:

```text
int, decimal, float → numeric
date, time          → date
bool                → boolean
string, text, char  → text
```

هذا مهم لأن Python أو .NET قد تعيد أسماء متقاربة.

---

# 14. Column Analysis

كل Column تتحول إلى `AnalysisColumnRow`.

تحتوي:

```text
Dataset ID and name
Source name
Column profile
Missing percentage
Non-null count
Cardinality
Issue count
```

## nonNullCount

```text
rowCount - missingValuesCount
```

## Cardinality Percentage

> **مفهوم جديد**

```text
uniqueValuesCount
÷ nonNullCount
× 100
```

مثال:

```text
100 non-null values
100 unique
→ cardinality = 100%
```

غالبًا قد يكون العمود ID.

مثال:

```text
100 rows
3 unique statuses
→ cardinality = 3%
```

غالبًا Categorical.

## Filters

- Search by Column/Dataset.
- Dataset filter.
- Data type filter.
- With issues.
- Without missing.
- Sort by missing/issues/name.

## Pagination

`pageSize = 25`.

```text
filteredColumns
→ columnPageCount
→ pagedColumns
```

كل تغيير Filter يعيد Page إلى 1.

---

# 15. Data Quality وIssues

## issues

يولد Issue لكل:

- Dataset فيها Duplicate Rows.
- Column فيها Missing Values.

كل Issue تحتوي:

```text
key
datasetId
datasetName
type
column
count
percentage
description
```

## ترتيب Issues

الأعلى Count أولًا، ثم الاسم.

## highestImpactIssue

أول Issue بعد الترتيب.

## datasetsNeedingAttention

يحسب عدد Dataset IDs المختلفة في Issues باستخدام `Set`.

## impactedColumns

أعلى 8 Columns في Missing Values.

## ملاحظة مهمة

الواجهة حاليًا تعتبر Issues الأساسية:

```text
Missing values
Duplicate rows
```

لكن التحليل ينتج معلومات أوسع مثل Type وCardinality وNumeric Stats.

---

# 16. Visualizations وECharts

الواجهة تستخدم:

```text
Apache ECharts
ngx-echarts
```

والـComponent المشتركة:

```text
AnalysisChartComponent
```

## AnalysisChartComponent Inputs

```text
title
description
scope
option
loading
emptyMessage
accessibleSummary
height
```

## لماذا Component مستقلة؟

- توحيد شكل الرسوم.
- توحيد Loading وEmpty states.
- إعادة الاستخدام.
- فصل بناء Chart options عن HTML.

## Modules المسجلة

```text
BarChart
PieChart
GaugeChart
Grid
Legend
Tooltip
ARIA
CanvasRenderer
```

## ARIA

> **مفهوم جديد صغير**

`AriaComponent` و`accessibleSummary` تساعد مستخدمي قارئ الشاشة على فهم الرسم دون الاعتماد على الصورة فقط.

---

# 17. الرسوم والتوصيات

الصفحة تبني:

## Rows by source

Bar chart تقارن عدد الصفوف.

## Column type distribution

Donut chart:

```text
Numeric
Text
Date
Boolean
Other
```

## Missing values by Dataset

Bar chart.

## Analysis coverage

Gauge:

```text
Analyzed datasets ÷ total datasets × 100
```

## Issues by type

Missing vs Duplicates.

## Duplicate rows by Dataset

Bar chart.

## Top missing columns

أكثر الأعمدة تأثرًا.

## Comparison chart

المستخدم يختار:

```text
Rows
Columns
Missing
Duplicates
```

ويختار:

```text
Ascending/Descending
Top 5 / Top 10 / All
Horizontal/Vertical
```

## Chart Recommendations

كل Analysis قد تعيد توصيات:

```text
chartType
title
xColumn
yColumn
reason
previewData
```

الواجهة لا تعرض توصية بلا `previewData`.

ثم تحول Preview points إلى ECharts option.

---

# 18. DatasetsController

> **سبق في Dataset Import:** Controller، JWT Ownership، Status Codes.

## Analyze Endpoint

```http
POST /api/datasets/{datasetId}/analyze
```

Request:

```json
{
  "analysisType": "profile"
}
```

المسار:

1. `EnsureDatasetOwnedAsync`.
2. `DatasetImportService.AnalyzeDatasetAsync`.
3. نجاح → `200 OK`.
4. Input خطأ → `400`.
5. ليس المالك → `403`.
6. Dataset غير موجودة → `404`.

## GetAnalysis Endpoint

```http
GET /api/datasets/{datasetId}/analysis
```

يستخدم لفتح النتائج المحفوظة دون إعادة تشغيل التحليل.

## GetProfile

```http
GET /api/datasets/{datasetId}/profile
```

يفوض حاليًا إلى `GetAnalysis`.

---

# 19. DatasetImportService

## AnalyzeDatasetAsync

المسار:

```text
Validate datasetId
→ load Dataset with all rows and columns
→ Dataset exists?
→ analyzedAt = UtcNow
→ Try Python analysis
→ if Python unavailable, .NET fallback
→ SaveAnalysisResultAsync
→ return response
```

الكود المنطقي:

```text
analysis =
  Python result
  ?? .NET result
```

## لماذا تحمل كل Rows وColumns؟

لأن التحليل يحتاج القيم الفعلية لكل عمود، لا Metadata فقط.

> **سبق في Dataset Import:** Repository لديها Query خفيفة للـPreview وQuery كاملة للتحليل.

---

# 20. بناء طلب Python

`BuildPythonAnalysisRequest(dataset)` يحول Entity إلى Contract مناسبة لـFastAPI.

Request:

```text
DatasetId
TableName
Columns
Rows
```

كل Column:

```text
Name
DataType
```

Rows:

- مرتبة حسب `RowNumber`.
- `RowData` تتحول من JSON String إلى Dictionaries.

## لماذا لا نرسل Entity مباشرة؟

> **سبق في Projects:** DTO تفصل Database Model عن API Contract.

Python لا تحتاج:

```text
Project navigation
Versions collection
EF tracking
CreatedAt
```

تحتاج فقط البيانات اللازمة للتحليل.

---

# 21. PythonAnalysisClient

> **مفهوم جديد: Typed HTTP Client بين خدمات داخلية**

في `Program.cs`:

```text
BaseUrl = PythonAnalysis:BaseUrl
Default = http://localhost:8001
Timeout = PythonAnalysis:TimeoutSeconds
Default = 10 seconds
```

`.NET` يسجل:

```csharp
AddHttpClient<IPythonAnalysisClient, PythonAnalysisClient>()
```

## AnalyzeDatasetAsync

ترسل:

```http
POST {BaseUrl}/analyze
Content-Type: application/json
```

باستخدام:

```csharp
PostAsJsonAsync
```

## إذا Status ليست ناجحة

تقرأ Response Body وترمي `HttpRequestException`.

Body تُقص إلى 500 حرف حتى لا تضع Response ضخمة في Error log.

## إذا Response Body فارغة

ترمي:

```text
InvalidOperationException
```

---

# 22. FastAPI Service

`app/main.py` ينشئ:

```python
app = FastAPI(
    title="ForgeDB Python Analysis Service",
    version="0.1.0",
)
```

## Health

```http
GET /health
```

يرجع:

```json
{
  "status": "healthy",
  "service": "ForgeDB Python Analysis Service"
}
```

## Analyze

```http
POST /analyze
```

```python
return analysis_service.analyze(request)
```

## Cleaning

نفس الخدمة تستضيف:

```text
/cleaning/preview
/cleaning/apply
```

وسيتم شرحها في جلسة Data Cleaning.

---

# 23. Pydantic Validation

> **مفهوم جديد**

Pydantic هي طبقة Models وValidation في FastAPI، شبيهة بجزء من DTO validation في ASP.NET.

## ColumnInput

```text
name required
dataType optional
```

- الاسم الفارغ يرفض.
- الاسم يعمل له Trim.
- dataType تتحول Lowercase.

## AnalyzeRequest

```text
datasetId > 0
tableName required
columns required
rows list
```

## model_validator

يتأكد من:

- يوجد عمود واحد على الأقل.
- لا توجد أسماء Columns مكررة دون حساسية لحالة الأحرف.

إذا Validation فشلت، FastAPI تعيد عادة `422`.

---

# 24. Python AnalysisService

الدالة الرئيسية:

```python
def analyze(request)
```

تنفذ:

```text
Profile each column
Count missing values
Count duplicate rows
Suggest relationships
Recommend charts
Build AnalyzeResponse
```

## _profile_column

لكل Column:

1. تجمع Raw Values.
2. تفصل Present Values عن Missing.
3. تكتشف النوع.
4. تعمل Normalize للقيم.
5. تحسب Unique Values.
6. تأخذ Sample Values.
7. تحسب Numeric Stats عند النوع الرقمي.
8. تحسب Top Values عند النصوص.

---

# 25. اكتشاف نوع البيانات

> **سبق بشكل أولي في Dataset Import؛ هنا التحليل يعيد فحص النوع بعمق أكبر.**

الترتيب في Python:

```text
integer
decimal
boolean
datetime
declared type or string
```

## Integer

يرفض Boolean لأن Python تعتبر `bool` نوعًا قريبًا من `int`.

## Decimal

يستخدم `Decimal` لدقة أفضل من Float أثناء الفحص.

## Boolean

يقبل:

```text
true
false
yes
no
1
0
```

## Datetime

يستخدم ISO format ويدعم `Z` بتحويلها إلى `+00:00`.

## Declared Type

إذا القيم غير حاسمة، يستخدم Type القادمة من Dataset Import إن كانت معروفة.

---

# 26. Numeric Statistics

للعمود الرقمي:

```text
min
max
average
```

## Average

```text
sum(numbers) ÷ count(numbers)
```

تستخدم `Decimal` أثناء الحساب ثم تحول النتيجة إلى:

- `int` إذا بلا كسور.
- `float` إذا بها كسور.

في .NET، يضاف أيضًا:

```text
count = rowCount - missingCount
```

---

# 27. Most Common Values وCardinality

## Most Common Values

للنصوص، Python تستخدم `Counter`.

ترتب حسب:

1. Count تنازليًا.
2. Value أبجديًا عند التعادل.

ثم تأخذ أعلى 5.

مثال:

```text
Active   80
Pending  15
Closed    5
```

## Sample Values

أول 5 قيم مختلفة مع الحفاظ على ترتيب أول ظهور.

## Cardinality

الواجهة تحسب:

```text
unique / non-null × 100
```

- عالية جدًا → مرشح Key.
- منخفضة → Categorical مناسبة للـBar/Pie.
- ليست قاعدة نهائية؛ مجرد مؤشر.

---

# 28. Missing Values وDuplicate Rows

## Missing

Python تعتبر Missing إذا:

```text
None
أو String فارغة/مسافات
```

## Duplicate Row Rule

في .NET موثق كالتالي:

```text
Exact full-row match across all stored columns.
```

أي أن الصف مكرر فقط إذا تطابقت كل القيم في جميع الأعمدة بعد Normalization المستخدمة.

Python تبني Tuple للقيم حسب ترتيب Columns وتستخدم `set`.

أول ظهور أصلي، وكل ظهور تالٍ يزيد Duplicate count.

---

# 29. Relationship Suggestions

Python تقترح Relationships حسب أسماء الأعمدة.

## id

```text
confidence = 0.4
Primary-key style identifier
```

## ends with _id

مثال:

```text
customer_id
→ customers.id
confidence = 0.7
```

## contains id

اقتراح أضعف:

```text
confidence = 0.55
```

هذه Heuristics وليست قرارات نهائية.

تحليل العلاقات الكامل يأتي في جلسة Relationships.

---
# 30. .NET Fallback

> **مفهوم جديد ومهم جدًا**

داخل `TryAnalyzeWithPythonAsync`:

```text
call Python
→ success: map Python result
→ timeout/service failure: log warning
→ return null
```

ثم:

```csharp
pythonResult
?? DatasetAnalysisBuilder.Build(...)
```

## متى يعمل Fallback؟

عند أخطاء مثل:

```text
HttpRequestException
JsonException
InvalidOperationException
NotSupportedException
Timeout from Python service
```

إذا المستخدم نفسه ألغى Request عبر CancellationToken، لا يعاملها كعطل Python عادي.

## لماذا هذا التصميم جيد؟

- النظام لا يتوقف بالكامل إذا Python لم تعمل.
- المستخدم يحصل على Analysis أساسية.
- Logs توضح أن Fallback استخدمت.
- يمكن تشغيل Backend محليًا حتى لو خدمة Python غير جاهزة.

## الفرق

Python هي المسار المفضل.  
.NET ليست Mock؛ لديها Analyzer كامل بديل.

---

# 31. DatasetAnalysisBuilder

هذه Class داخلية Static في .NET.

## Build(dataset)

تبني Analysis بالكامل من Rows وColumns المحفوظة:

```text
Order columns and rows
→ deserialize JSON rows
→ analyze every column
→ count duplicates
→ sum missing values
→ build type distribution
→ recommend charts
→ enrich result
```

إذا Dataset لا تحتوي Columns أو Rows، ترمي ArgumentException.

## AnalyzeColumn

لكل عمود:

```text
Normalize missing
→ observe values
→ detect type
→ missing count
→ unique count
→ sample values
→ numeric stats
→ most common values
```

## ColumnStats

تحافظ على:

```text
value counts
sample values
numeric values
allIntegers
allDecimals
allBooleans
allDateTimes
```

ثم تنتج Profile.

---

# 32. دمج Python مع .NET

`BuildFromPython` لا تثق في Response Python وحدها بشكل أعمى.

## الخطوات

1. تبني Baseline كاملة بـ.NET.
2. تحول Columns الأساسية إلى Dictionary.
3. تحول Python Columns إلى Dictionary.
4. لكل Column:
   - تستخدم Python إذا موجودة.
   - تستخدم Baseline إذا Python لم ترجعها.
5. إذا Python لم ترجع أي Columns، تستخدم Baseline كلها.
6. تستخدم Python Chart Recommendations.
7. إذا لا توجد توصيات Python، تستخدم توصيات .NET.
8. تضيف Preview Data من Rows المحفوظة.
9. تبني Response النهائية.

## لماذا Baseline أولًا؟

لضمان وجود Result كاملة حتى لو Python Response ناقصة جزئيًا.

هذا نمط:

```text
Preferred external result
+ trusted local fallback/enrichment
```

---

# 33. Key Candidates وDate Ranges وRelationship Hints

هذه Enrichment تنفذ في .NET بعد التحليل.

## Key Candidates

العمود يحتاج غالبًا:

```text
Unique across rows
No missing values
Key-like name or enough sample size
```

أسماء Key-like تشمل Tokens مثل:

```text
id
key
code
ref
no
num
number
uuid
guid
```

Confidence تبدأ من `0.3` ثم تزيد:

```text
+0.35 key-like name
+0.35 unique
+0.15 complete
```

الحد الأعلى `0.99`، وتعرض Candidates من `0.6` فما فوق.

هذا ترشيح وليس إنشاء Primary Key تلقائيًا.

## Date Ranges

لكل Date/Datetime Column:

```text
parse dates
→ sort
→ min date
→ max date
```

وتعيد بصيغة:

```text
yyyy-MM-dd
```

## Relationship Candidate Hints

تختار Columns:

- اسمها Key-like.
- أو Unique وComplete.

ثم تضيف Hint تستخدم لاحقًا في Relationship Discovery.

---

# 34. Chart Recommendation Enrichment

.NET تقترح Charts حسب أنواع الأعمدة.

## Date + Numeric

```text
Line chart
```

## Categorical

```text
Bar chart
```

## Numeric

```text
Histogram
```

## Two Numeric

```text
Scatter
```

الحد الأقصى 6 توصيات بعد إزالة التكرار.

## Preview Data

التوصية وحدها لا تكفي؛ لذلك `AddPreviewData` تبني نقاطًا فعلية.

### Line trend

- تجمع القيم حسب التاريخ/Label.
- تجمع Numeric values.
- ترتب بالتاريخ.
- تأخذ أول 8 نقاط.

### Categorical bar

- تجمع Counts.
- ترتب الأعلى.
- تأخذ Top 5.

### Histogram

- إذا Distinct values ≤ 5: تعرض Counts لكل قيمة.
- وإلا تنشئ 5 Buckets بين Min وMax.

### Fallback preview

إذا لم تنجح الطريقة:

- تستخدم Most Common Values.
- أو Min/Avg/Max للعمود الرقمي.

---

# 35. حفظ نتائج التحليل

`DatasetRepository.SaveAnalysisResultAsync` يحدث:

```text
Dataset.AnalysisResultJson
Dataset.MissingValuesCount
Dataset.DuplicateRowsCount
Dataset.AnalyzedAt
Dataset.Status = Analyzed
```

إذا توجد ActiveVersion:

```text
ActiveVersion.AnalysisResultJson
ActiveVersion.MissingValuesCount
ActiveVersion.DuplicateRowsCount
ActiveVersion.AnalyzedAt
```

ثم:

```text
SaveChangesAsync
```

## لماذا تحفظ JSON؟

لأن Analysis Result تحتوي Structure كبيرة ومتغيرة:

```text
columns
stats
distributions
```

حفظ JSON يسمح بإعادة تحميلها دون إعادة تحليل كل مرة.

لكن Metrics الأساسية تحفظ أيضًا كColumns مستقلة لسهولة القراءة والفلترة.

---

# 36. DTOs وContracts

> **سبق في Projects وDataset Import:** DTO تفصل الطبقات والخدمات.

## Frontend DatasetAnalysisResponse

```text
datasetId
tableName
status
analysisResult
chartRecommendations
keyCandidates
dateRanges
relationshipCandidateHints
analyzedAt
datasetVersionId
datasetVersionNumber
isCleanedVersion
```

## DatasetAnalysisResult

```text
rowCount
columnCount
missingValuesCount
duplicateRowsCount
duplicateRowRule
columns
columnTypeDistribution
```

## ColumnAnalysis

```text
columnName
detectedDataType
missingValuesCount
uniqueValuesCount
isNullable
sampleValues
numericStats
mostCommonValues
```

## Python AnalyzeRequest

```text
datasetId
tableName
columns
rows
```

## Python AnalyzeResponse

```text
rowCount
columnCount
missingValuesCount
duplicateRowsCount
columns
relationshipSuggestions
chartRecommendations
```

.NET Response أغنى من Python Response؛ لأن .NET تضيف Enrichment وربط Dataset Version.

---

# 37. Status وDataset Versions

> **سبق في Dataset Import:** Active Dataset Version شُرحت بشكل مبدئي.

بعد Analysis:

```text
Status = Analyzed
```

Response قد تحتوي:

```text
datasetVersionId
datasetVersionNumber
isCleanedVersion
```

إذا التحليل يعمل على نسخة تنظيف نشطة:

```text
isCleanedVersion = true
```

هذا يسمح للواجهة بمعرفة أن النتيجة تخص Cleaned Version، وليس Raw Original.

بعد Cleaning جديدة قد تصبح الحالة:

```text
Cleaned - Analysis Required
```

ويجب تشغيل Analysis مرة أخرى.

---

# 38. المسارات الكاملة

## فتح Project Analysis

```text
/projects/5/analysis
→ ngOnInit
→ forkJoin(project, datasets)
→ choose project or dataset scope
→ find datasets with status Analyzed
→ load saved analyses with mergeMap concurrency 4
→ build summaries and charts
```

## تحليل Dataset واحدة

```text
Select dataset
→ runAnalysis
→ POST /api/datasets/{id}/analyze
→ ownership check
→ load rows and columns
→ build Python request
→ POST Python /analyze
→ Python profiles data
→ .NET baseline/enrichment
→ save JSON and metrics
→ return response
→ update Angular signals
```

## تحليل Project كاملة

```text
scope = project
→ analysisTargets
→ loop through datasets
→ analyze one by one
→ keep successes
→ collect failures
→ reload saved successful results
→ show full/partial/failure feedback
```

## Python Failure

```text
Python timeout/error
→ logger warning
→ .NET DatasetAnalysisBuilder.Build
→ save result
→ user still receives Analysis
```

---

# 39. الأخطاء والحالات

## Frontend حالات

```text
loading workspace
loading saved results
running analysis
partial execution failure
saved result load failure
success
warning
error
```

## HTTP Codes

| Code | المعنى |
|---:|---|
| 200 | Analysis أو GetAnalysis نجح |
| 400 | Dataset ID أو البيانات غير صالحة |
| 401 | JWT غير موجودة/صالحة |
| 403 | Dataset ليست للمستخدم |
| 404 | Dataset غير موجودة |
| 422 | FastAPI Request validation فشلت |
| 500/502 | Service failure محتمل، وغالبًا .NET تحاول fallback |
| 504 | Python timeout قبل fallback داخليًا |

ملاحظة: المستخدم قد لا يرى خطأ Python إذا نجح Fallback؛ يظهر التحليل طبيعيًا، ويظهر التحذير في Backend logs.

---

# 40. الاختبار العملي

## تشغيل الخدمات

### PostgreSQL

```bash
docker compose up -d postgres
```

### Python

من `python-analysis-service` وبعد تفعيل البيئة:

```bash
uvicorn app.main:app --reload --port 8001
```

بحسب طريقة الـmodule الحالية قد يحتاج تشغيل من جذر الخدمة مع `PYTHONPATH` المناسب.

### Backend

```bash
dotnet run --project backend/ForgeDB.API/ForgeDB.API.csproj
```

### Frontend

```bash
cd frontend/angular-app
npx ng serve
```

## Tests أساسية

### Workspace

- Project بلا Datasets.
- Project بعدة Datasets.
- Dataset Scope.
- Project Scope.
- Route Dataset ID.
- Query Dataset ID.
- Standalone Dataset.

### تشغيل Analysis

- Dataset صحيحة.
- Project كاملة.
- إعادة تشغيل.
- Dataset بلا Rows.
- Dataset بلا Columns.
- مستخدم آخر.
- الضغط مرتين.
- Progress.

### Partial Failure

- واحدة تنجح وواحدة تفشل.
- كلها تفشل.
- Retry يفحص الفاشلة فقط.
- Saved analysis لا تحمل.

### Python

- Python شغالة.
- Python متوقفة.
- Python Timeout.
- Python Response غير صالحة.
- Python Response ناقصة Columns.
- Python بلا Chart Recommendations.
- التأكد أن .NET fallback تعمل.

### Data Profile

- Integer.
- Decimal.
- Boolean.
- Datetime.
- String.
- كل القيم Missing.
- Mixed types.
- Unique column.
- Missing values.
- Duplicates.
- Top values.
- Numeric min/max/average.

### Visualizations

- Empty data.
- Dark/Light theme.
- Horizontal/Vertical.
- Top 5/10/All.
- Accessible summary.
- Chart recommendations لها Preview.

---

# 41. ملخص الحفظ السريع

## المسار

```text
Angular
→ .NET Controller
→ DatasetImportService
→ Python FastAPI
→ .NET enrichment
→ Repository save
→ Angular visualizations
```

## Python

```text
Profile columns
Count missing
Count duplicates
Numeric stats
Top values
Relationship heuristics
Chart recommendations
```

## .NET

```text
Fallback analyzer
Merge Python with baseline
Key candidates
Date ranges
Relationship hints
Chart preview data
Save analysis JSON
```

## مفاهيم جديدة

```text
Analysis Scope
Record keyed by ID
loadVersion against race conditions
forkJoin
mergeMap concurrency
firstValueFrom
partial retry targets
typed internal HttpClient
FastAPI
Pydantic
microservice fallback
cardinality
chart recommendation enrichment
histogram buckets
```

## مفاهيم سبقت

```text
Signals and computed
Route/query parameters
WorkflowState
finalize
DTO vs Entity
Controller → Service → Repository
JWT ownership
CancellationToken
Active Dataset Version
```

---

# 42. تحسينات مؤجلة لما بعد الفهم

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. إرسال Analysis Project كاملة للباك إند بدل Loop من Angular إذا احتجنا Transaction/Job موحد.
2. Background jobs للـDatasets الكبيرة.
3. Server-side progress وJob status.
4. Cancel Analysis.
5. Distinguish visibly between Python result و.NET fallback result.
6. حفظ Analyzer version داخل النتيجة.
7. إضافة Standard Deviation وMedian وPercentiles.
8. دعم Outlier detection مثل IQR.
9. تحسين Boolean parsing ليكون موحدًا بين Python و.NET.
10. توحيد Type inference rules بين Import وPython و.NET.
11. استخدام Streaming أو Sampling للـDatasets الكبيرة بدل إرسال كل Rows إلى Python.
12. إضافة Correlation analysis للأعمدة الرقمية.
13. جعل Chart Recommendations تدعم Scatter وLine فعليًا في Renderer، وليس تحويل كل Preview إلى Bar فقط.
14. Endpoint واحد لتحميل Analyses متعددة بدل N requests.
15. Integration tests تثبت Python fallback.
16. إظهار سبب فشل كل Dataset بشكل أوضح في UI.
17. مراقبة Python health قبل بدء Run.
18. حماية أكبر من بيانات ضخمة في JSON بين .NET وPython.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. الفرق بين Import وAnalysis.
2. كيف تحلل الصفحة Project أو Dataset واحدة.
3. لماذا تستخدم `forkJoin` و`mergeMap`.
4. لماذا `runAnalysis` تستخدم `firstValueFrom`.
5. كيف يعمل Partial Failure وRetry.
6. كيف يرسل .NET البيانات إلى Python.
7. كيف تتحقق Pydantic من Request.
8. كيف تحسب Python أنواع الأعمدة والإحصائيات.
9. كيف يعمل .NET fallback.
10. كيف تدمج .NET نتيجة Python مع Baseline.
11. كيف تُبنى Key Candidates وDate Ranges.
12. كيف تُبنى Chart Recommendations وPreview Data.
13. كيف تحفظ Analysis في PostgreSQL.
14. كيف ترتبط Analysis بـDataset Version.
