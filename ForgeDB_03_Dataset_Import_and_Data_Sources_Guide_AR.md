# ForgeDB — دليل جلسة Dataset Import & Data Sources الكامل

> **الجلسة رقم 03 — Dataset Import & Data Sources**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم إدارة مصادر البيانات بعد إنشاء المشروع: العرض، الاختيار، CSV، Excel، API، المعاينة، الاستبدال، الحذف، وطريقة التخزين في PostgreSQL.

---

## طريقة استخدام الدليل

- الملف هو الشرح الكامل، والشات للأسئلة.
- **سبق في Projects:** يعني أن المفهوم مر سابقًا، وسأراجع استخدامه هنا.
- **مفهوم جديد:** يعني أنه يحتاج تركيزًا أكبر.
- لا يوجد قسم أسئلة مقابلة في هذا الملف.

---

# 1. الصورة العامة

بعد إنشاء Project، يضيف المستخدم البيانات من:

```text
CSV
Excel (.xlsx)
JSON API
```

المسار:

```text
Validate source
→ Read records
→ Extract columns
→ Normalize rows
→ Count rows and columns
→ Detect missing values
→ Detect duplicates
→ Infer column types
→ Save Dataset + Columns + Rows
→ Preview / Analysis / Cleaning
```

---

# 2. الفرق بين Project وDataset

> **سبق في Projects:** Project هي مساحة العمل المرتبطة بالمستخدم.

```text
Project: Sales Database
├── Dataset: customers.csv
├── Dataset: orders.xlsx
└── Dataset: products API
```

كل Dataset تمثل مصدرًا واحدًا، ولها:

```text
TableName
SourceType
SourceName
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
Status
Columns
Rows
Analysis
Versions
```

العلاقة:

```text
Project 1 ─────── * Datasets
```

---

# 3. واجهة Data Sources

المساران:

```text
/projects/:projectId/datasets
/projects/:projectId/upload
```

كلاهما يفتح `DataSourcesComponent`.

الصفحة تعرض:

- اسم ووصف المشروع.
- عدد مصادر البيانات.
- مجموع الصفوف والأعمدة.
- عدد Datasets المحللة.
- البحث والاختيار.
- Overview وPreview وQuality.
- Add Data Source.
- Replace وDelete.
- Analyze.

الأنواع:

```ts
type WorkspaceMode = 'selected' | 'all';
type DatasetTab = 'overview' | 'preview' | 'quality';
type UploadSource = 'csv' | 'excel' | 'api';
```

---

# 4. الملفات والطبقات

## Frontend

```text
pages/data-sources/data-sources.component.ts
pages/data-sources/data-sources.component.html
services/forge-api.service.ts
services/api.models.ts
services/workflow-state.service.ts
app.routes.ts
```

## Backend

```text
Controllers/DatasetsController.cs
Services/DatasetImportService.cs
Services/Interfaces/IDatasetImportService.cs
Repositories/DatasetRepository.cs
Repositories/Interfaces/IDatasetRepository.cs
Services/Importing/ExcelWorkbookReader.cs
Services/Importing/ApiJsonImportService.cs
Services/Importing/ApiJsonClient.cs
Services/Importing/ApiUrlSecurity.cs
```

## Models

```text
DatasetUploadDto
DatasetResponseDto
DatasetPreviewDto
Dataset
DatasetColumn
DatasetRow
DatasetVersion
```

> **سبق في Projects:**  
> `Component → API Service → Controller → Service → Repository → PostgreSQL`.

هنا تضاف طبقات متخصصة:

```text
DatasetImportService
├── CSV parser
├── ExcelWorkbookReader
└── ApiJsonImportService
    └── ApiJsonClient
        └── ApiUrlSecurity
```

---

# 5. نموذج تخزين Dataset

> **مفهوم جديد ومهم جدًا**

ForgeDB لا ينشئ جدول PostgreSQL جديدًا لكل CSV وقت الاستيراد. يستخدم:

```text
datasets
dataset_columns
dataset_rows
```

## datasets

Metadata للمصدر:

```text
Id
ProjectId
TableName
SourceType
SourceName
SourceUrl
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
Status
AnalysisResultJson
CreatedAt
AnalyzedAt
ActiveVersionId
```

## dataset_columns

```text
DatasetId
ColumnName
DetectedDataType
MissingValuesCount
UniqueValuesCount
IsNullable
SampleValues
```

## dataset_rows

```text
DatasetId
RowNumber
RowData
CreatedAt
```

`RowData` مخزنة كـJSON:

```json
{
  "id": "1",
  "name": "Ahmed",
  "age": "26"
}
```

السبب: شكل الملفات ديناميكي وغير معروف مسبقًا. لذلك التخزين هو:

```text
Dataset metadata
+ Dynamic columns
+ Rows as JSON
```

ثم لاحقًا يولد النظام Schema مناسبة.

---

# 6. تهيئة DataSourcesComponent

> **سبق في Projects:** Component و`inject()` وSignals.

الخدمات:

```ts
api
route
router
workflow
destroyRef
```

## ActivatedRoute

> **مفهوم جديد**

تقرأ القيم من URL:

```text
/projects/5/datasets?datasetId=17
```

- `projectId = 5`: Route Parameter.
- `datasetId = 17`: Query Parameter.

## DestroyRef

يستخدم لإيقاف RxJS subscriptions عند مغادرة الصفحة.

## Subjects

```ts
private readonly previewRequests = new Subject<number>();
private readonly analysisRequests = new Subject<number>();
```

هذه قنوات تقول:

```text
Load preview for Dataset 15
Load analysis for Dataset 15
```

---

# 7. Signals وComputed

> **سبق في Projects:** `signal()` للحالة و`computed()` للقيم المشتقة.

أهم Signals:

```text
project
datasets
selectedDatasetId
projectLoading / datasetsLoading
projectError / datasetsError
search
mode
activeTab
preview / previewLoading / previewError
analysis / qualityLoading / qualityError
uploadOpen / uploadSource / uploadFile / uploading
excelPreview
apiUrl / apiArrayPath / apiConnection / apiPreview
replaceOpen / replaceFile / replacing
confirmingDeleteDataset / deletingDataset
```

أهم Computed:

- `selectedDataset`: تجد Dataset حسب ID.
- `selectedIndex`: موقعها داخل القائمة.
- `filteredDatasets`: البحث في `tableName` و`sourceName`.
- `analyzedCount`: عدد المحلل.
- `totalRows` و`totalColumns`: المجاميع.
- `previewRows`: أول 10 صفوف للعرض.
- `canImportUpload`: هل زر Import مسموح؟
- `qualityIssues`: تحويل Analysis إلى Missing/Duplicate issues.

---

# 8. Subject وswitchMap

> **مفهوم جديد، مع أن switchMap مر في Projects.**

في Projects استخدمنا `switchMap` لبدء Import بعد Create. هنا يستخدم لإلغاء الطلب القديم عند اختيار Dataset جديدة.

```text
Select Dataset 1
→ Preview request 1 starts

Select Dataset 2 quickly
→ Preview request 2 starts
→ old subscription is cancelled
```

الهدف: منع ظهور Preview قديمة تحت Dataset الجديدة.

`catchError` داخل Pipeline يحول الخطأ إلى قيمة بدل إنهاء Subject بالكامل.

`takeUntilDestroyed(destroyRef)`:

> **سبق في Projects List.**

يلغي الاشتراك عند مغادرة الصفحة، فيمنع Memory Leaks وتحديث Component تم تدميرها.

---
# 9. Route وQuery Parameters

في `ngOnInit()`:

```ts
projectId = Number(
  route.snapshot.paramMap.get('projectId')
);
```

URL:

```text
/projects/12/datasets
```

يعطي `projectId = 12`.

إذا ID غير صالح، يرجع المستخدم إلى `/projects`.

بعدها:

```text
workflow.setProjectId(projectId)
loadProject()
loadDatasets()
```

## Query Parameter

عند اختيار Dataset يصبح الرابط:

```text
/projects/12/datasets?datasetId=30
```

الفوائد:

- Refresh يحافظ على الاختيار.
- يمكن مشاركة الرابط.
- الصفحة تستعيد Dataset المطلوبة.

`replaceUrl: true` يمنع إضافة History entry جديدة مع كل اختيار.

---

# 10. تحميل واختيار Dataset

## loadProject()

```text
loading = true
GET /api/projects/{projectId}
success → project Signal + WorkflowState
error → projectError
finalize → loading = false
```

> **سبق في Projects:** `finalize` تعمل عند النجاح أو الفشل.

## loadDatasets(preferredId?)

```text
GET /api/projects/{projectId}/datasets
→ datasets Signal
→ restoreSelection()
```

`preferredId` تستخدم بعد Upload أو Replace لاختيار Dataset الناتجة.

## selectDataset(dataset)

1. يتأكد أنها موجودة بالقائمة.
2. يحفظ ID.
3. يحفظ Dataset في WorkflowState.
4. يمسح Preview وAnalysis القديمة.
5. يغير Mode إلى `selected`.
6. يكتب `datasetId` في URL.
7. يرسل ID إلى `previewRequests`.
8. إذا الحالة `Analyzed` يرسل ID إلى `analysisRequests`.

## restoreSelection

ترتيب الأولوية:

```text
1. preferredId
2. datasetId من URL
3. selectedDatasetId الحالية
4. WorkflowState.datasetId
5. أول Dataset
```

إذا القائمة فارغة:

```text
clear selection
clear workflow dataset
clear preview/analysis
remove datasetId from URL
```

إذا URL يطلب Dataset غير موجودة في المشروع، تظهر Notice وتختار Dataset صالحة.

---

# 11. Tabs والمعاينة والجودة

## selectTab(tab)

تغير Tab ثم تستدعي `loadActiveTab()`.

- `preview` → تطلب Preview.
- `quality` → تطلب Analysis إذا Dataset محللة.

## refreshPreview / refreshQuality

تعيد إرسال ID للقناة المناسبة.

## analyze()

يحفظ Dataset في WorkflowState ثم ينتقل:

```text
/datasets/{datasetId}/analyze
```

ويرسل:

```text
returnProject
returnTo=data-sources
```

تفاصيل التحليل تأتي في جلسة Analysis.

## Quality calculations في الصفحة

- `qualityIssues`: Missing Values حسب العمود + Duplicate Rows.
- `nullPercentage`:  
  `missingValues / (rowCount × columnCount) × 100`
- `issuePercentage`:  
  `issueCount / rowCount × 100`

هذه حسابات عرض؛ التحليل الحقيقي يأتي من الباك إند.

---

# 12. CSV في الواجهة

## اختيار الملف

`onFileSelected()` يأخذ أول File، يرسلها إلى `acceptFile()` ثم يمسح Input.

## Drag and Drop

> **سبق في Project Create.**

- يمنع المتصفح من فتح الملف.
- يظهر Highlight.
- يدعم ملفًا واحدًا هنا.

إذا تم إسقاط عدة ملفات:

```text
Upload one file at a time.
```

## acceptFile()

للـCSV يتحقق من:

```text
.csv extension
non-empty
isCsvFile(file)
```

ثم يخزنها في `uploadFile`.

## importUpload()

1. يتأكد من `canImportUpload`.
2. يفعّل `uploading`.
3. ينشئ `FormData`.
4. يضيف الملف وMetadata.
5. يولد Table Name.
6. يرسل Upload.
7. عند النجاح يغلق نافذة الرفع.
8. يحفظ Dataset في WorkflowState.
9. يعيد تحميل القائمة ويختار Dataset الجديدة.

Table Name تنظف إلى أحرف وأرقام و`_`، أو تصبح `dataset` إذا انتهى الاسم فارغًا.

---

# 13. Excel في الواجهة

عند قبول `.xlsx`:

```ts
loadExcelPreview();
```

## لماذا Preview؟

Workbook قد تحتوي:

```text
Customers
Orders
Products
```

فيجب اختيار Worksheet واحدة.

## Preview Request

```text
file
worksheetName اختياري
```

Endpoint:

```text
POST /api/datasets/excel/preview
```

إذا توجد عدة Sheets، يختار المستخدم واحدة ثم يعاد Preview.

عند Import النهائي يرسل:

```text
file
sourceType=excel
sourceName
worksheetName
tableName=fileBase_worksheet
```

---

# 14. API في الواجهة

الحقول:

```text
apiUrl
apiArrayPath
```

مثال:

```json
{
  "result": {
    "customers": [
      { "id": 1, "name": "Ahmed" }
    ]
  }
}
```

Array Path:

```text
result.customers
```

## Test

```text
POST /api/datasets/api/test
```

يعيد:

- Status Code.
- Content Type.
- Response bytes.
- Record count.
- Final URL.

ولا يحفظ Dataset.

## Preview

```text
POST /api/datasets/api/preview
```

يعيد Columns وRows نموذجية ولا يحفظ.

## Import

```text
POST /api/projects/{projectId}/datasets/api
```

يشترط URL وPreview ناجحة، ثم يحفظ Dataset.

عند تغيير URL أو Array Path تُمسح النتائج السابقة لأنها تخص Request قديمة.

---

# 15. FormData وIFormFile

> **مر سريعًا في Projects، وهنا الشرح الكامل.**

## JSON Request

مناسب للبيانات النصية:

```json
{ "name": "Project" }
```

## multipart/form-data

مناسب لإرسال File وحقول نصية معًا:

```ts
const formData = new FormData();
formData.append('file', file);
formData.append('sourceType', 'csv');
formData.append('sourceName', file.name);
formData.append('tableName', tableName);
```

ASP.NET يستقبل:

```csharp
[FromForm] DatasetUploadDto request
```

والملف:

```csharp
IFormFile File
```

لا نحدد `Content-Type` يدويًا في Angular؛ المتصفح يضيف `boundary` اللازمة.

---

# 16. Replace وDelete

## Replace

المستخدم يختار CSV جديدة لـDataset موجودة:

```text
POST /api/datasets/{datasetId}/replace
```

بعد النجاح:

- نفس Dataset ID تبقى.
- المحتوى يتغير.
- الحالة تصبح `Imported`.
- يجب إعادة التحليل.

الباك إند يمسح الأشياء المبنية على المحتوى القديم:

```text
Relationship Suggestions
Cleaning Operations
Dataset Versions
Old Columns
Old Rows
Old Analysis
AnalyzedAt
ActiveVersionId
```

السبب: نتائج البيانات القديمة لم تعد صحيحة.

## Delete

```text
DELETE /api/datasets/{datasetId}
```

- يفتح Confirmation.
- يمنع الضغط المكرر.
- النجاح `204 No Content`.
- يعيد تحميل القائمة.
- يختار Dataset أخرى أو يمسح الاختيار إذا كانت الأخيرة.

---

# 17. ForgeApiService Endpoints

> **سبق في Projects:** ForgeApiService تعرف URL وHTTP Method وType، وComponent تدير Workflow.

| Angular method | Endpoint | الوظيفة |
|---|---|---|
| `getProjectDatasets` | `GET /api/projects/{projectId}/datasets` | القائمة |
| `getDatasetPreview` | `GET /api/datasets/{datasetId}/preview` | Preview |
| `uploadDataset` | `POST /api/projects/{projectId}/datasets/upload` | CSV/Excel |
| `previewExcel` | `POST /api/datasets/excel/preview` | Workbook preview |
| `testApiConnection` | `POST /api/datasets/api/test` | API test |
| `previewApi` | `POST /api/datasets/api/preview` | JSON preview |
| `importApi` | `POST /api/projects/{projectId}/datasets/api` | API import |
| `replaceDataset` | `POST /api/datasets/{datasetId}/replace` | Replace |
| `deleteDataset` | `DELETE /api/datasets/{datasetId}` | Delete |
| `getDatasetAnalysis` | `GET /api/datasets/{datasetId}/analysis` | Quality |
| `analyzeDataset` | `POST /api/datasets/{datasetId}/analyze` | Analysis |

---
# 18. DatasetsController

```csharp
[ApiController]
[Authorize]
[Route("api")]
```

## حد الملفات

```csharp
MaximumImportRequestBytes = 10 * 1024 * 1024;
```

ويطبق بـ:

```csharp
[RequestSizeLimit(...)]
```

على Excel Preview وUpload وReplace.

> **مفهوم جديد:** حد Request يحمي الخادم من ملفات ضخمة تستهلك الذاكرة والوقت.

## أهم العمليات

### PreviewExcel

- `[FromForm]`.
- لا تحفظ Dataset.
- Input غير صالح → `400`.

### TestApiConnection / PreviewApi

تمسك `ApiImportException` وتعيد Status Code وError Code مناسبين.

### Upload / ImportApi

1. تفحص ملكية Project.
2. تستدعي DatasetImportService.
3. تعيد `201 Created`.

### Replace

1. تفحص ملكية Dataset.
2. نجاح → `200`.
3. غير موجود → `404`.

### Delete

- نجاح → `204`.
- غير موجود → `404`.

### GetByProject / GetPreview

تفحص الملكية قبل إرسال البيانات.

## الملكية

> **سبق في Projects:** `[Authorize]` للجلسة وOwnership للصلاحية.

Dataset لا تحتوي User ID مباشرة، لذلك:

```text
Dataset
→ ProjectId
→ Project
→ UserId
→ compare with JWT userId
```

تغيير ID في URL لا يعطي المستخدم صلاحية.

---

# 19. DatasetImportService

الخدمة المركزية للاستيراد.

Dependencies:

```text
IDatasetRepository
IPythonAnalysisClient
ILogger
IExcelWorkbookReader
IApiJsonImportService
```

## UploadDatasetAsync

```text
Validate projectId
→ Project exists?
→ Validate request
→ Resolve source type
→ Resolve table name
→ Parse CSV/Excel
→ Resolve source name
→ Build Dataset entity
→ Repository.AddAsync
→ MapToResponse
```

Entity تحتوي:

```text
ProjectId
TableName
SourceType
SourceName
SourceUrl
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
Status = Imported
CreatedAt
Columns collection
Rows collection
```

عند `AddAsync(dataset)` تحفظ EF Core الـGraph كاملًا.

## PreviewExcelAsync

تعيد:

```text
File name
Worksheets
Selected worksheet
Row/column counts
Columns
First 10 rows
```

ولا تنادي Repository.

## TestApiConnectionAsync

تجلب API وتعيد معلومات تشخيصية.

## PreviewApiAsync

تحول JSON إلى شكل Tabular للمعاينة بلا حفظ.

## ImportApiAsync

تجلب JSON، تبني Columns وRows، ثم تحفظ Dataset.

## GetProjectDatasetsAsync

تجلب Metadata فقط دون Rows الثقيلة.

## GetDatasetPreviewAsync

تجلب:

```text
Dataset + Columns + first 50 Rows
```

ثم تحول `RowData` من JSON String إلى Dictionary.

## ReplaceDatasetAsync

تقرأ المصدر الجديد ثم ترسل Columns وRows إلى Repository لاستبدال المحتوى.

---

# 20. كيف يقرأ CSV

> **مفهوم جديد ومهم.**

لا يكفي `split(',')`؛ لأن القيمة قد تحتوي فاصلة:

```csv
id,name,address
1,Ahmed,"Riyadh, Saudi Arabia"
```

## ValidateCsvFile

- File موجودة.
- غير فارغة.
- لا تتجاوز 10 MB.
- الامتداد `.csv`.

## ParseCsvAsync

1. يفتح Stream.
2. يتجاوز الأسطر الفارغة.
3. أول سطر غير فارغ هو Header.
4. يحلل Headers.
5. يقرأ Rows.
6. يتحقق أن عدد Values يساوي Headers.
7. يحول الفراغ إلى `null`.
8. يحدث إحصائيات الأعمدة.
9. يحول Row إلى JSON.
10. يكشف Duplicate.
11. يبني `DatasetRow`.

## Headers

- يزيل BOM من أول Header.
- يعمل Trim للأسماء.
- يمنع Header فارغة.
- يمنع Headers مكررة.

## BOM

علامة مخفية قد تبدأ بها ملفات UTF-8:

```text
﻿
```

بدون إزالتها قد يصبح الاسم `﻿id` بدل `id`.

## Quotes

Parser يتتبع هل هو داخل Quotes.

```csv
"Riyadh, Saudi Arabia"
```

الفاصلة هنا ليست فاصل Column.

Escaped quote:

```csv
"He said ""hello"""
```

تصبح:

```text
He said "hello"
```

Quote غير مغلقة تسبب Error.

## الحفاظ على Raw Values

القيم لا تُنظف بـTrim أو تغيير Case وقت الاستيراد.  
التنظيف يأتي في Data Cleaning حتى يكون Versioned ويمكن تتبع التغيير.

---

# 21. كيف يقرأ Excel

المسؤول:

```text
ExcelWorkbookReader
```

ويستخدم `ExcelDataReader`.

## الحدود

```text
File:    10 MB
Rows:    100,000
Columns: 500
Cells:   2,000,000
```

حد الخلايا مهم لأن Workbook قد تكون صغيرة بالحجم لكنها ضخمة في عدد الخلايا.

## ReadAsync

1. `ValidateFile`.
2. ينسخ الملف إلى `MemoryStream`.
3. يفتح OpenXML Reader.
4. يمر على Worksheets باستخدام `NextResult`.
5. يتجاهل Sheets الفارغة.
6. يختار Sheet المطلوبة.

إذا لا يوجد اسم Sheet:

- Sheet واحدة → يختارها.
- عدة Sheets → يعيد القائمة ويترك المستخدم يختار.

## ReadNonEmptyRows

- يفحص Cancellation.
- يراقب حدود Rows/Columns/Cells.
- يحول القيم إلى نص.
- يحذف الخلايا الفارغة في نهاية Row.
- يتجاهل Row الفارغة بالكامل.

## NormalizeHeaders

Excel متسامح أكثر من CSV:

- Header فارغة → `column_1`.
- Header مكررة → `name_2`, `name_3`.

## NormalizeCell

- `null`/`DBNull` → null.
- DateTime → ISO 8601.
- الأرقام → `InvariantCulture`.
- النص الفارغ → null.

---

# 22. كيف يستورد JSON API

المسؤول:

```text
ApiJsonImportService
```

## FetchAsync

```text
Validate request
→ Normalize Array Path
→ ApiJsonClient.GetAsync
→ Parse JSON
→ Resolve Array
→ Normalize Records
```

## إعدادات JSON

```text
Trailing commas: disallowed
Comments: disallowed
Max depth: 64
```

Invalid JSON → `422 invalid_json`.

## ResolveArray

إذا Array Path موجود:

```text
result.customers
```

يمشي بين Properties، ويجب أن تنتهي بـArray.

بدون Path يحاول:

1. Root نفسها Array.
2. Property اسمها `data` وهي Array.
3. توجد Array واحدة فقط في Root Object.
4. غير ذلك يطلب Array Path.

## NormalizeRecords

الشروط:

- Array غير فارغة.
- ≤ 100,000 Records.
- كل عنصر Object.
- يوجد Field واحد على الأقل.
- ≤ 500 Columns.
- ≤ 2,000,000 Cells.

## اتحاد الأعمدة

```json
[
  { "id": 1, "name": "A" },
  { "id": 2, "email": "b@example.com" }
]
```

Columns:

```text
id
name
email
```

القيمة غير الموجودة في Record تصبح `null`.

## NormalizeValue

- null → null.
- String → String.
- Number/Boolean/Object/Array → Raw JSON text.

## Array Path validation

- طول ≤ 200.
- عمق ≤ 10.
- Dot-separated.
- أحرف وأرقام و`_` و`-` فقط.

---

# 23. SSRF Protection

> **مفهوم جديد وأمني مهم جدًا**

SSRF = Server-Side Request Forgery.

لأن السيرفر يتصل بعنوان يدخله المستخدم، قد يحاول شخص الوصول إلى خدمات داخلية:

```text
localhost
127.0.0.1
10.x.x.x
192.168.x.x
169.254.169.254
cloud metadata
internal admin services
```

## ApiUrlSecurity

يسمح فقط بـ:

```text
http
https
```

ويمنع:

- URL غير مطلقة.
- Credentials داخل URL.
- localhost.
- Private networks.
- Loopback.
- Link-local.
- Metadata hosts.
- Reserved ranges.
- Multicast.

## DNS check

حتى Domain عامة قد تحل إلى Private IP؛ لذلك يحل DNS ثم يفحص كل IP.

## Redirect check

كل Redirect يعاد فحص عنوانه.  
هذا يمنع Public URL تحول المستخدم إلى Internal URL.

## ApiJsonClient limits

- Timeout محدود.
- Redirect count محدود.
- يقبل JSON Content-Type فقط.
- يفحص `Content-Length`.
- يقرأ Stream على Chunks 16 KB.
- يوقف التنزيل إذا تجاوز Maximum Response Bytes.

الأخطاء المحتملة:

```text
blocked_address
timeout
connection_error
dns_error
http_error
non_json
response_too_large
```

---

# 24. اكتشاف أنواع الأعمدة والجودة

كل عمود لديه `ColumnImportStats`.

## الأنواع

```text
boolean
integer
decimal
datetime
string
```

مع كل Value يفحص:

```text
هل كل القيم Boolean؟
هل كل القيم Integer؟
هل كل القيم Decimal؟
هل كل القيم DateTime؟
```

الأولوية:

```text
boolean → integer → decimal → datetime → string
```

إذا كل القيم Missing، النوع `string`.

## InvariantCulture

> **مفهوم جديد صغير**

يمنع اختلاف اكتشاف الأرقام والتواريخ حسب لغة جهاز السيرفر.

## Missing Values

القيمة الفارغة أو المسافات تعتبر Missing وتتحول إلى `null`.

يحفظ:

```text
Column.MissingValuesCount
Column.IsNullable
Dataset.MissingValuesCount = sum of all columns
```

## Unique Values

`HashSet<string>` يحسب القيم المختلفة.

## Sample Values

يحفظ حتى 5 قيم مختلفة للعمود.

## Duplicate Rows

كل Row تتحول إلى JSON، ثم تستخدم `HashSet` لمعرفة هل ظهرت سابقًا.

مثال:

```text
A
A
A
```

الأول أصلي، والاثنان التاليان Duplicates:

```text
DuplicateRowsCount = 2
```

---
# 25. DatasetRepository وEF Core

> **سبق في Projects:** Repository و`AsNoTracking` و`Include` و`AsSplitQuery`.

هنا توجد Queries مختلفة حسب حجم البيانات المطلوبة.

## GetByIdAsync

Metadata فقط؛ مناسب لفحص الملكية.

## GetByIdWithColumnsAsync

```text
Dataset
+ Columns
+ ActiveVersion
```

## GetByIdWithPreviewAsync

```text
Dataset
+ Columns
+ أول N Rows
+ ActiveVersion
```

يستخدم `Take(rowLimit)` حتى لا يحمل كل Rows للمعاينة.

## GetByIdWithRowsAndColumnsAsync

يحمل جميع Rows وColumns، ويستخدم للتحليل.

## GetByProjectIdAsync

يحمل Metadata فقط لصفحة القائمة؛ لا داعي لتحميل آلاف Rows.

> **قاعدة مهمة:** لا تحمل العلاقات الثقيلة إلا عند الحاجة.

## AddAsync

عند إضافة Dataset ومعها Collections:

```text
Dataset
├── Columns
└── Rows
```

EF Core تحفظ الـGraph وتضبط Foreign Keys.

## SaveAnalysisResultAsync

يحدث:

```text
AnalysisResultJson
MissingValuesCount
DuplicateRowsCount
AnalyzedAt
Status = Analyzed
```

وإذا توجد Active Version، يحدث نتائجها كذلك.

---

# 26. Transactions في Replace وDelete

> **مفهوم جديد ومهم**

Transaction هي مجموعة أوامر يجب أن تنجح كلها أو لا يثبت أي منها.

Replace تشمل:

```text
Delete relationships
Delete cleaning operations
Delete versions
Delete old columns
Delete old rows
Add new columns
Add new rows
Update dataset
```

لو فشلت العملية في المنتصف، لا نريد Dataset نصف محدثة.

## Atomicity

```text
كل العملية تنجح
أو كلها ترجع للوضع السابق
```

الكود يفتح Transaction إذا Database Relational:

```csharp
BeginTransactionAsync()
```

ثم بعد `SaveChangesAsync`:

```csharp
CommitAsync()
```

## Delete

تستخدم Transaction أيضًا لأنها تحذف Dataset مع بيانات مترابطة مثل Relationship Suggestions وCleaning Operations وVersions.

---

# 27. Active Dataset Version

> **مفهوم جديد، وسيشرح أعمق في جلسة Data Cleaning.**

Dataset قد تحتوي:

```text
Versions
ActiveVersionId
ActiveVersion
```

الهدف: الاحتفاظ بنسخ تنظيف بدل تدمير النسخة الأصلية.

`ApplyActiveVersion()` إذا توجد نسخة نشطة:

- يعيد بناء Columns من Snapshot.
- يعيد بناء Rows من Snapshot.
- يستخدم Metrics النسخة.
- يستخدم Analysis النسخة.
- يحدث Status.

الحالات:

```text
Analyzed
Cleaned - Analysis Required
```

في هذه الجلسة يكفي فهم:

```text
Dataset لها Raw content
وقد توجد Cleaned active version تعرض بدلها
```

---

# 28. DTOs وEntities

> **سبق في Projects:** Entity تمثل DB وDTO تمثل API Contract.

## DatasetUploadDto

```text
TableName
SourceType
SourceName
SourceUrl
WorksheetName
IFormFile File
```

## DatasetResponseDto

Metadata فقط:

```text
Id
ProjectId
TableName
SourceType
SourceName
RowCount
ColumnCount
MissingValuesCount
DuplicateRowsCount
Status
CreatedAt
```

لا تعيد Rows لتجنب Response ضخمة.

## DatasetPreviewDto

```text
DatasetId
TableName
Columns
Rows
```

## Dataset Entity

Metadata + Navigation Properties:

```text
Project
Columns
Rows
Versions
ActiveVersion
```

## DatasetColumn

Profile أولي للعمود.

## DatasetRow

رقم Row وJSON data.

---

# 29. مسارات العمل الكاملة

## فتح صفحة Data Sources

```text
URL /projects/5/datasets
→ ngOnInit reads projectId
→ loadProject + loadDatasets
→ restoreSelection
→ selectDataset
→ previewRequests.next(id)
→ GET preview
```

## CSV Import

```text
Choose CSV
→ frontend validation
→ FormData
→ POST /projects/{id}/datasets/upload
→ ownership check
→ validate CSV
→ parse headers/rows
→ calculate stats
→ build Dataset graph
→ AddAsync
→ PostgreSQL saves dataset + columns + rows
→ 201 DatasetResponse
→ reload and select new Dataset
```

## Excel Import

```text
Choose .xlsx
→ Preview workbook
→ list worksheets
→ select worksheet
→ preview rows
→ upload with worksheetName
→ normalize sheet
→ save Dataset
```

## API Import

```text
Enter URL/path
→ Test
→ security and DNS checks
→ fetch JSON
→ resolve array
→ Preview
→ Import
→ fetch final data again
→ normalize records
→ save Dataset
```

Preview لا تحفظ البيانات. لذلك Import تجلب API مرة أخرى، وقد تكون البيانات تغيرت بين العمليتين.

## Replace

```text
Select Dataset
→ choose replacement CSV
→ parse new content
→ transaction
→ delete stale dependent state
→ replace rows/columns
→ Status = Imported
→ re-analysis required
```

## Delete

```text
Confirm
→ ownership check
→ transaction
→ remove dependent state
→ delete Dataset
→ 204
→ reload selection
```

---

# 30. الأخطاء والحالات

## Dataset statuses

```text
Imported
Analyzed
Cleaned - Analysis Required
```

## HTTP Codes

| Code | الاستخدام |
|---:|---|
| 200 | Read/Preview/Test/Replace ناجح |
| 201 | Dataset جديدة |
| 204 | Delete ناجح |
| 400 | Input/File غير صالحة |
| 401 | لا توجد جلسة |
| 403 | المورد ليس للمستخدم |
| 404 | المورد غير موجود |
| 413 | File/Response/Data أكبر من الحد |
| 422 | JSON صحيحة لكن غير قابلة للتحويل لجدول |
| 502 | API الخارجية فشلت |
| 504 | Timeout |

## API import error codes

```text
invalid_url
blocked_address
timeout
connection_error
dns_error
http_error
non_json
response_too_large
invalid_json
array_path_not_found
array_path_invalid
object_array_required
empty_array
row_limit
data_limit
```

---

# 31. الاختبار العملي

## CSV

- ملف صحيح.
- فارغ.
- امتداد خاطئ.
- Header فارغة.
- Header مكررة.
- عدد Values مختلف عن Headers.
- فاصلة داخل Quotes.
- Escaped quotes.
- Quote غير مغلقة.
- Missing Values.
- Duplicate Rows.
- أكبر من 10 MB.
- BOM في أول Header.

## Excel

- Sheet واحدة.
- عدة Sheets.
- اختيار Worksheet.
- Sheet فارغة.
- Workbook فاسدة أو Password protected.
- أكبر من 10 MB.
- أكثر من 100,000 Row.
- أكثر من 500 Column.
- أكثر من 2,000,000 Cell.
- Headers فارغة أو مكررة.

## API

- Root Array.
- `data` Array.
- Nested Array Path.
- Path غير موجود.
- Path لا يشير إلى Array.
- Empty Array.
- عناصر ليست Objects.
- Objects بأعمدة مختلفة.
- Non-JSON.
- Invalid JSON.
- HTTP error.
- Timeout.
- Redirect loop.
- Response كبيرة.
- localhost.
- Private IP.
- Metadata endpoint.
- Domain يحل إلى Private IP.

## الصفحة

- Project غير موجود.
- Project بلا Datasets.
- Search.
- Previous/Next.
- Query `datasetId` صحيحة.
- Query غير موجودة.
- Refresh يحافظ على الاختيار.
- Preview Error.
- Quality قبل Analysis.
- Upload.
- Replace.
- Delete آخر Dataset.
- مستخدم يحاول فتح Dataset مستخدم آخر.

---

# 32. ملخص الحفظ السريع

## الصفحة

```text
Route projectId
→ load project
→ load datasets
→ restore selection
→ load preview/quality
```

## التخزين

```text
Dataset = metadata
DatasetColumn = column profile
DatasetRow = row JSON
```

## CSV

```text
Validate
→ parse quoted CSV
→ headers
→ rows
→ stats
→ save
```

## Excel

```text
Workbook
→ worksheets
→ choose sheet
→ normalize headers/cells
→ save
```

## API

```text
secure URL
→ fetch JSON
→ resolve object array
→ normalize table
→ save
```

## مفاهيم جديدة في هذه الجلسة

```text
Route Parameter
Query Parameter
Subject as request trigger
switchMap cancels stale requests
multipart/form-data
IFormFile
Dynamic tabular storage
BOM
InvariantCulture
Type inference
SSRF protection
Request/response limits
Transaction
Active Dataset Version
```

## مفاهيم سبقت في Projects

```text
Signals
Computed Signals
finalize
switchMap الأساسي
Component → API → Controller → Service → Repository
DTO vs Entity
JWT ownership
AsNoTracking
Include / AsSplitQuery
WorkflowStateService
```

---

# 33. تحسينات مؤجلة لما بعد الفهم

> للتسجيل فقط؛ لا ننفذ قبل انتهاء الفهم والاختبار.

1. توحيد Table Name normalization بين الصفحات والباك إند.
2. إضافة Max Rows/Columns صريحة لـCSV.
3. استخدام CSV parsing library ناضجة إذا احتجنا صيغًا أوسع.
4. عرض API Error Code في تشخيص متقدم.
5. Progress حقيقي للملفات الكبيرة.
6. Cancel Upload.
7. Pagination أو Virtualization للقوائم الكبيرة.
8. دعم API Authentication Headers بطريقة آمنة.
9. توضيح أن API قد تتغير بين Preview وImport.
10. دعم Replace من Excel وAPI عند الحاجة.
11. توحيد سياسة Headers بين CSV وExcel.
12. تنفيذ Ownership داخل Query نفسها.
13. Audit Log لعمليات Replace وDelete.
14. Integration Tests لـTransaction rollback.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. الفرق بين Project وDataset.
2. لماذا التخزين مقسم إلى Dataset وColumns وRows.
3. كيف تحفظ الصفحة Dataset المختارة في URL.
4. لماذا تستخدم Subject وswitchMap.
5. كيف تعمل FormData وIFormFile.
6. كيف يقرأ النظام CSV مع Quotes وBOM.
7. كيف يقرأ Excel ويختار Worksheet.
8. كيف يحول JSON Array إلى جدول.
9. كيف يمنع SSRF.
10. كيف يكتشف نوع العمود.
11. كيف يحسب Missing وDuplicates.
12. لماذا Replace تمسح نتائج قديمة.
13. لماذا تستخدم Transaction.
14. ما معنى Active Dataset Version.
