# ForgeDB — دليل جلسة Projects الكامل

> **الجلسة رقم 02 — Projects Feature**  
> الفرع الذي بُني عليه الشرح: `feature/final-ui-integration`  
> الهدف: فهم فيتشر المشاريع كاملًا كما هو الآن، قبل تنفيذ أي تحسينات.

---

## طريقة استخدام هذا الدليل

هذا الملف هو المرجع الأساسي للجلسة. استخدم الشات فقط لطرح الأسئلة على قسم أو سطر لم يتضح لك.

مع كل دالة، ركّز على سبعة أسئلة:

1. أين توجد؟
2. من يستدعيها؟
3. ماذا تستقبل؟
4. ماذا تُرجع؟
5. ما الخطوات التي تنفذها؟
6. ماذا يحدث عند الخطأ؟
7. ما الدالة أو الطبقة التالية في المسار؟

---

# جدول المحتويات

1. [الصورة العامة للفيتشر](#1-الصورة-العامة-للفيتشر)
2. [الصفحات والمسارات](#2-الصفحات-والمسارات)
3. [معمارية الطبقات](#3-معمارية-الطبقات)
4. [الملفات المشاركة](#4-الملفات-المشاركة)
5. [صفحة إنشاء المشروع — Project Create Wizard](#5-صفحة-إنشاء-المشروع--project-create-wizard)
6. [Angular Signals وReactive Forms](#6-angular-signals-وreactive-forms)
7. [Computed Signals](#7-computed-signals)
8. [التنقل بين خطوات الـWizard](#8-التنقل-بين-خطوات-الwizard)
9. [استيراد البيانات من API](#9-استيراد-البيانات-من-api)
10. [استيراد Excel](#10-استيراد-excel)
11. [اختيار ملفات CSV](#11-اختيار-ملفات-csv)
12. [إنشاء المشروع وربطه برفع البيانات](#12-إنشاء-المشروع-وربطه-برفع-البيانات)
13. [شرح RxJS المستخدم](#13-شرح-rxjs-المستخدم)
14. [رفع CSV وExcel وAPI](#14-رفع-csv-وexcel-وapi)
15. [الفشل الجزئي وإعادة المحاولة](#15-الفشل-الجزئي-وإعادة-المحاولة)
16. [الحماية من الخروج بدون حفظ](#16-الحماية-من-الخروج-بدون-حفظ)
17. [صفحة قائمة المشاريع](#17-صفحة-قائمة-المشاريع)
18. [بطاقة المشروع والتعديل والحذف](#18-بطاقة-المشروع-والتعديل-والحذف)
19. [ForgeApiService](#19-forgeapiservice)
20. [WorkflowStateService](#20-workflowstateservice)
21. [ProjectsController](#21-projectscontroller)
22. [ProjectService](#22-projectservice)
23. [ProjectRepository وEF Core](#23-projectrepository-وef-core)
24. [DTOs وEntity](#24-dtos-وentity)
25. [مسارات CRUD كاملة](#25-مسارات-crud-كاملة)
26. [Overview وExport](#26-overview-وexport)
27. [الحماية والملكية](#27-الحماية-والملكية)
28. [HTTP Status Codes](#28-http-status-codes)
29. [CancellationToken](#29-cancellationtoken)
30. [الاختبار العملي](#30-الاختبار-العملي)
31. [أسئلة مقابلة متوقعة](#31-أسئلة-مقابلة-متوقعة)
32. [ملخص الحفظ السريع](#32-ملخص-الحفظ-السريع)
33. [تحسينات مؤجلة لما بعد الفهم](#33-تحسينات-مؤجلة-لما-بعد-الفهم)

---

# 1. الصورة العامة للفيتشر

فيتشر Projects لا يعني فقط إنشاء سجل اسمه Project. في ForgeDB، المشروع هو الحاوية التي تربط دورة العمل كاملة:

```text
إنشاء مشروع
    ↓
استيراد CSV أو Excel أو API
    ↓
تحليل البيانات
    ↓
تنظيف البيانات
    ↓
اكتشاف العلاقات
    ↓
تصميم قاعدة البيانات
    ↓
التصدير أو النشر
```

لذلك كيان `Project` مرتبط بـ:

- المستخدم المالك.
- Datasets.
- تصميم قاعدة البيانات.
- اقتراحات العلاقات.
- دفعات التنظيف.
- حالة جودة وتنظيف المشروع.
- إعدادات Dashboard.

## مسؤوليات فيتشر Projects الحالي

- إنشاء مشروع.
- عرض مشاريع المستخدم.
- فتح مشروع.
- تعديل الاسم والوصف.
- حذف المشروع.
- إنشاء المشروع مع استيراد أول مصدر بيانات.
- عرض Overview مجمع.
- تجهيز Export Package.

---

# 2. الصفحات والمسارات

المسارات المهمة داخل `app.routes.ts`:

| المسار | الصفحة | الحماية |
|---|---|---|
| `/projects` | قائمة المشاريع | `authGuard` |
| `/projects/new` | إنشاء مشروع | `authGuard` + `unsavedChangesGuard` |
| `/projects/:projectId/overview` | نظرة عامة | `authGuard` |
| `/projects/:projectId/datasets` | مصادر البيانات | `authGuard` |
| `/projects/:projectId/analysis` | التحليل | `authGuard` |
| `/projects/:projectId/data-cleaning` | التنظيف | `authGuard` |
| `/projects/:projectId/relationships` | العلاقات | `authGuard` |
| `/projects/:projectId/schema-designer` | التصميم | `authGuard` |
| `/projects/:projectId/exports` | التصدير | `authGuard` |

## لماذا `/projects/new` عليه `canDeactivate`؟

لأن المستخدم قد:

- يكتب اسم المشروع.
- يضيف ملفات.
- يختار Worksheet.
- يدخل رابط API.

ثم يحاول الخروج قبل الإكمال.  
`unsavedChangesGuard` يستدعي `canDeactivate()` ويقرر هل يسمح بالخروج أو يعرض رسالة تأكيد.

---

# 3. معمارية الطبقات

المسار العام:

```text
Angular Component
        ↓
ForgeApiService
        ↓ HTTP + JWT
ProjectsController
        ↓
IProjectService / ProjectService
        ↓
IProjectRepository / ProjectRepository
        ↓
ForgeDbContext / EF Core
        ↓
PostgreSQL
```

## مسؤولية كل طبقة

### Angular Component

- يدير الصفحة.
- يقرأ إدخال المستخدم.
- يعرض Loading وErrors.
- يمنع الضغط المتكرر.
- يقرر الانتقال بين الخطوات.

### ForgeApiService

- يحدد رابط الـendpoint.
- يحدد HTTP Method.
- يرسل Request.
- يحدد نوع Response.
- لا يحتوي Business Logic.

### Controller

- يستقبل HTTP Request.
- يقرأ هوية المستخدم من JWT.
- يختار Status Code.
- يستدعي Service.
- لا يتعامل مباشرة مع تفاصيل EF Core.

### Service

- ينفذ Business Logic.
- يتحقق من البيانات.
- ينظم العمليات.
- يحول Entity إلى DTO.
- ينسق مع أكثر من Repository أو Service.

### Repository

- يتعامل مباشرة مع EF Core.
- ينفذ الاستعلامات والحفظ والحذف.
- لا يدير شكل واجهة المستخدم.

### PostgreSQL

- التخزين الدائم.
- العلاقات والقيود.
- توليد `Id`.

---

# 4. الملفات المشاركة

## Frontend

```text
frontend/angular-app/src/app/pages/project-create/project-create.component.ts
frontend/angular-app/src/app/pages/project-create/project-create.component.html
frontend/angular-app/src/app/pages/project-create/project-create.utils.ts

frontend/angular-app/src/app/pages/projects/projects.component.ts
frontend/angular-app/src/app/pages/projects/projects.component.html

frontend/angular-app/src/app/shared/project-card/project-card.component.ts
frontend/angular-app/src/app/shared/project-card/project-card.component.html

frontend/angular-app/src/app/services/forge-api.service.ts
frontend/angular-app/src/app/services/api.models.ts
frontend/angular-app/src/app/services/workflow-state.service.ts
frontend/angular-app/src/app/services/unsaved-changes.guard.ts
frontend/angular-app/src/app/app.routes.ts
```

## Backend

```text
backend/ForgeDB.API/Controllers/ProjectsController.cs

backend/ForgeDB.API/Services/ProjectService.cs
backend/ForgeDB.API/Services/Interfaces/IProjectService.cs

backend/ForgeDB.API/Repositories/ProjectRepository.cs
backend/ForgeDB.API/Repositories/Interfaces/IProjectRepository.cs

backend/ForgeDB.API/Models/DTOs/ProjectCreateDto.cs
backend/ForgeDB.API/Models/DTOs/ProjectUpdateDto.cs
backend/ForgeDB.API/Models/DTOs/ProjectResponseDto.cs
backend/ForgeDB.API/Models/DTOs/ProjectWorkspaceDto.cs

backend/ForgeDB.API/Models/Entities/Project.cs
backend/ForgeDB.API/Data/ForgeDbContext.cs
```

---

# 5. صفحة إنشاء المشروع — Project Create Wizard

الملف الرئيسي:

```text
project-create.component.ts
```

هذا الملف يجمع ست مسؤوليات:

1. تفاصيل المشروع.
2. اختيار مصدر البيانات.
3. إنشاء المشروع.
4. استيراد CSV أو Excel أو API.
5. التعامل مع الفشل الجزئي وإعادة المحاولة.
6. منع الخروج عند وجود تغييرات غير محفوظة.

## خطوات الـWizard

```ts
type WizardStep = 1 | 2 | 3;
```

| الرقم | الخطوة |
|---:|---|
| 1 | Project Details |
| 2 | Data Source |
| 3 | Review & Create |

استخدام Union Type يمنع وضع قيمة غير معروفة مثل `4` أو `"step"`.

---

## أنواع الحالة

### SubmissionState

```ts
type SubmissionState =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'partial'
  | 'success';
```

| الحالة | معناها |
|---|---|
| `idle` | لا توجد عملية إرسال |
| `creating` | طلب إنشاء المشروع شغال |
| `uploading` | المشروع أُنشئ ويتم استيراد البيانات |
| `partial` | المشروع موجود لكن بعض الاستيراد فشل |
| `success` | المشروع وكل الاستيراد نجح |

### FileUploadState

```ts
type FileUploadState =
  | 'selected'
  | 'uploading'
  | 'uploaded'
  | 'failed';
```

هذه تخص كل ملف أو مصدر منفرد، وليست العملية كاملة.

مثال:

```text
customers.csv = uploaded
orders.csv    = failed
products.csv  = uploading
```

### WizardSource

```ts
type WizardSource = 'csv' | 'excel' | 'api';
```

يضمن أن مصدر البيانات واحد من الخيارات المدعومة.

---

## Interfaces المحلية

### WizardCsvFile

يمثل ملف CSV داخل واجهة الـWizard:

```ts
interface WizardCsvFile {
  id: string;
  file: File;
  state: FileUploadState;
  error?: string;
  dataset?: DatasetResponse;
}
```

- `id`: رقم واجهة مؤقت مثل `csv-1`.
- `file`: ملف المتصفح الحقيقي.
- `state`: حالة الملف.
- `error`: تظهر عند الفشل.
- `dataset`: تُضاف بعد نجاح الحفظ في الباك إند.

### WizardExcelFile

```ts
interface WizardExcelFile {
  id: string;
  file: File;
  preview: ExcelWorkbookPreview | null;
  state: FileUploadState;
  error?: string;
  dataset?: DatasetResponse;
}
```

يختلف عن CSV بوجود `preview` لأن ملف Excel قد يحتوي عدة Worksheets.

### UploadResult

```ts
interface UploadResult {
  fileId: string;
  success: boolean;
  dataset?: DatasetResponse;
  error?: string;
}
```

يوحّد نتيجة CSV وExcel وAPI في شكل واحد.

نجاح:

```ts
{
  fileId: 'csv-1',
  success: true,
  dataset
}
```

فشل:

```ts
{
  fileId: 'csv-2',
  success: false,
  error: 'Upload failed.'
}
```

### FeedbackMessage

```ts
interface FeedbackMessage {
  kind: 'success' | 'warning' | 'error';
  title: string;
  message: string;
}
```

يحدد رسالة الواجهة وشكلها.

---

## trimmedRequired

```ts
const trimmedRequired: ValidatorFn = (
  control: AbstractControl<string>
): ValidationErrors | null => {
  return control.value.trim().length > 0
    ? null
    : { whitespace: true };
};
```

`Validators.required` قد يعتبر `"   "` قيمة موجودة.  
هذا الـvalidator يحذف المسافات مؤقتًا ثم يفحص الطول.

في Angular:

- `null` = لا يوجد خطأ.
- `{ whitespace: true }` = الحقل غير صالح.

---

## Component Metadata

```ts
@Component({
  selector: 'app-project-create',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './project-create.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

### standalone

لا يحتاج التسجيل في `NgModule`.

### ReactiveFormsModule

ضروري لاستخدام:

```html
[formGroup]
formControlName
```

### OnPush

يقلل تحديثات الواجهة غير الضرورية.  
Signals تخبر Angular عند تغير حالة تعتمد عليها الصفحة.

---

# 6. Angular Signals وReactive Forms

## الخدمات المحقونة

```ts
private readonly formBuilder = inject(FormBuilder);
private readonly api = inject(ForgeApiService);
private readonly auth = inject(AuthService);
private readonly workflow = inject(WorkflowStateService);
private readonly router = inject(Router);
```

| المتغير | المسؤولية |
|---|---|
| `formBuilder` | إنشاء الفورم والتحقق |
| `api` | إرسال طلبات الباك إند |
| `auth` | قراءة المستخدم المسجل |
| `workflow` | حفظ المشروع والـDataset المختارين |
| `router` | الانتقال بين الصفحات |

## private readonly

- `private`: يستخدم داخل الكلاس.
- `readonly`: لا يمكن استبدال مرجع الخدمة بعد إنشائه.
- لا يمنع استدعاء دوال الخدمة.

---

## Local State غير المعروض مباشرة

### fileSequence

```ts
private fileSequence = 0;
```

ينشئ IDs محلية:

```text
csv-1
csv-2
excel-3
```

هذه ليست IDs من قاعدة البيانات.

### allowNavigation

```ts
private allowNavigation = false;
```

يصبح `true` بعد نجاح العملية أو تأكيد الخروج، حتى لا يمنع Guard انتقالًا مقصودًا.

### leaveDecision

```ts
private leaveDecision: Subject<boolean> | null = null;
```

يمثل قرارًا ينتظره Guard:

- `true`: غادر.
- `false`: ابقَ.

---

## Signals الرئيسية

### currentStep

```ts
readonly currentStep = signal<WizardStep>(1);
```

قراءة:

```ts
this.currentStep()
```

تعيين:

```ts
this.currentStep.set(2)
```

تحديث اعتمادًا على القيمة الحالية:

```ts
this.currentStep.update(step => ...)
```

### selectedSource

```ts
readonly selectedSource = signal<WizardSource>('csv');
```

يحفظ المصدر المختار.

### csvFiles

```ts
readonly csvFiles = signal<WizardCsvFile[]>([]);
```

قائمة ملفات CSV وحالة كل ملف.

### excelFile

```ts
readonly excelFile = signal<WizardExcelFile | null>(null);
```

يدعم ملف Excel واحدًا في الـWizard الحالي.

### API Signals

```ts
apiUrl
apiArrayPath
apiConnection
apiPreview
apiTesting
apiPreviewLoading
apiImportState
apiDataset
apiError
```

تغطي:

- الرابط.
- مسار المصفوفة داخل JSON.
- نتيجة Test Connection.
- Sample Preview.
- حالات التحميل.
- Dataset الناتجة.
- رسالة الخطأ.

### submissionState

الحالة العامة للعملية.

### createdProject

```ts
readonly createdProject =
  signal<ProjectResponse | null>(null);
```

يحفظ المشروع بعد إنشائه لأسباب مهمة:

- أخذ `project.id` للاستيراد.
- منع إنشاء مشروع مكرر.
- إعادة محاولة الرفع على نفس المشروع.
- الانتقال إلى Overview.

### uploadCompleted وuploadTotal

تسمح بعرض:

```text
Uploading 2 of 5
```

### feedback

الرسالة الحالية.

### leaveDialogOpen

هل Dialog تأكيد الخروج مفتوح؟

---

## Reactive Form

```ts
readonly projectForm =
  this.formBuilder.nonNullable.group({
    name: [
      '',
      [
        Validators.required,
        Validators.maxLength(100),
        trimmedRequired
      ]
    ],
    description: [
      '',
      [Validators.maxLength(500)]
    ],
  });
```

### nonNullable

يضمن أن القيم النصية لا تصبح `null` داخل الفورم.

### Validators

- الاسم مطلوب.
- الاسم لا يزيد عن 100.
- الاسم ليس مسافات فقط.
- الوصف لا يزيد عن 500.

### Backend validation

تحقق Angular لتحسين تجربة المستخدم، لكنه ليس الحماية النهائية.  
يمكن تجاوز الواجهة باستخدام Postman أو طلب يدوي؛ لذلك الباك إند يعيد التحقق.

---

## formValue وtoSignal

```ts
private readonly formValue = toSignal(
  this.projectForm.valueChanges.pipe(
    map(value => ({
      name: value.name ?? '',
      description: value.description ?? '',
    }))
  ),
  {
    initialValue:
      this.projectForm.getRawValue()
  },
);
```

`valueChanges` عبارة عن Observable.  
`toSignal` يحوله إلى Signal حتى تستخدمه `computed()`.

`initialValue` ضرورية قبل أول تعديل للمستخدم.

---

# 7. Computed Signals

`computed()` تحسب قيمة من Signals أخرى، وتعيد الحساب تلقائيًا إذا تغيرت أي Signal تمت قراءتها داخلها.

## processing

```ts
readonly processing = computed(
  () =>
    this.submissionState() === 'creating'
    || this.submissionState() === 'uploading'
);
```

تمنع الضغط أو تغيير المصدر أثناء طلب شغال.

## nameLength وdescriptionLength

تستخدم لعداد الأحرف.

## projectDetailsValid

```ts
readonly projectDetailsValid = computed(() => {
  this.formValue();
  return this.projectForm.valid;
});
```

قراءة `formValue()` تجعل Computed مرتبطة بتغير الفورم.

## showNameError

يعرض الخطأ إذا كان الحقل:

- غير صالح.
- وتم لمسه أو تعديله.

## currentFile

يُرجع CSV المحدد للمعاينة حسب `selectedFileIndex`.

## uploadedFiles وfailedFiles

تفلتر ملفات CSV حسب الحالة.

## sourceReady

تقرر هل يستطيع المستخدم الذهاب للخطوة الثالثة:

- CSV: يوجد ملف واحد على الأقل.
- Excel: يوجد ملف ومعاينة وWorksheet محددة.
- API: يوجد URL ومعاينة ناجحة.

## uploadedCount وfailedCount

توحّد العد بين CSV وExcel وAPI.

## hasUnsavedChanges

تفحص وجود أي شيء يحتاج حماية:

- اسم أو وصف.
- الانتقال من الخطوة الأولى.
- ملفات CSV.
- Excel.
- URL أو Array Path.

---

## constructor وeffect

```ts
constructor() {
  effect(() => {
    if (this.leaveDialogOpen()) {
      queueMicrotask(
        () =>
          this.stayButton()
            ?.nativeElement
            .focus()
      );
    }
  });
}
```

عندما تفتح نافذة الخروج:

1. `effect` يلاحظ تغير Signal.
2. ينتظر `queueMicrotask`.
3. Angular ينتهي من رسم الزر.
4. يضع Focus على زر Stay.

هذا تحسين Accessibility.

---

# 8. التنقل بين خطوات الـWizard

## nextStep()

### وظيفتها

تنقل المستخدم إلى الخطوة التالية فقط إذا كانت الحالية صحيحة.

### الخطوة الأولى

```ts
this.projectForm.markAllAsTouched();
```

تجعل رسائل الأخطاء تظهر حتى لو لم يلمس المستخدم الحقول يدويًا.

إذا الفورم غير صالح:

```ts
return;
```

إذا صالح:

```ts
this.currentStep.set(2);
```

### الخطوة الثانية

تقرأ `sourceReady()`.

إذا المصدر غير جاهز، تعرض رسالة تناسب المصدر:

- CSV: أضف ملفًا.
- Excel: اختر Workbook وWorksheet.
- API: أدخل URL واعرض Preview.

إذا جاهز:

```ts
this.currentStep.set(3);
```

---

## selectSource(source)

تغيّر المصدر بشرط:

- لا توجد عملية إنشاء/رفع.
- Test API غير شغال.
- Preview API غير شغال.
- المصدر الجديد مختلف.

ثم تمسح Feedback السابقة.

---

## previousStep()

- أثناء Processing: لا تفعل شيئًا.
- من Step 1: تطلب الانتقال إلى `/projects`.
- من Step 2 أو 3: تنقص رقم الخطوة.

## cancel()

يحاول الرجوع لقائمة المشاريع، لكن Guard قد يوقفه إذا توجد تغييرات.

---

# 9. استيراد البيانات من API

## updateApiUrl(value)

1. يحفظ URL.
2. يستدعي `resetApiResults()`.

لماذا يمسح النتائج؟  
لأن Test أو Preview السابقة تخص URL قديمًا.

## updateApiArrayPath(value)

نفس الفكرة لمسار المصفوفة.

مثال Response:

```json
{
  "data": {
    "customers": [
      { "id": 1, "name": "Ahmed" }
    ]
  }
}
```

قد يكون `arrayPath`:

```text
data.customers
```

---

## testApiConnection()

### شروط البداية

لا يبدأ إذا:

- URL فارغ.
- Test شغال.
- إنشاء/رفع شغال.

### قبل الطلب

```ts
apiTesting = true
apiConnection = null
apiError = ''
feedback = null
```

### الطلب

```ts
this.api.testApiConnection(
  this.apiRequest()
)
```

### النجاح

- يوقف Loading.
- يخزن معلومات الاتصال.

### الفشل

- يوقف Loading.
- يستخرج رسالة مفهومة.
- يخزنها في `apiError`.
- يعرض Feedback.

---

## previewApiData()

تجلب Sample من JSON قبل الاستيراد.

الفرق:

```text
Test Connection
= هل الرابط قابل للوصول وما معلومات الاستجابة؟

Preview
= ما الأعمدة والصفوف التي ستُستورد؟
```

الـPreview لا تنشئ Dataset.

---

## apiRequest()

```ts
private apiRequest(): ApiJsonImportRequest {
  const arrayPath =
    this.apiArrayPath().trim();

  return {
    apiUrl: this.apiUrl().trim(),
    arrayPath: arrayPath || null
  };
}
```

تبني Contract موحدًا تستخدمه:

- Test.
- Preview.
- Import.

## resetApiResults()

تمسح:

- Connection result.
- Preview.
- Dataset.
- Import state.
- Error.
- Feedback.

---

# 10. استيراد Excel

## onExcelFileInput(event)

### الخطوات

1. يحول Target إلى `HTMLInputElement`.
2. يأخذ أول ملف فقط.
3. يمسح `input.value` للسماح بإعادة اختيار نفس الملف.
4. يتحقق:
   - الامتداد `.xlsx`.
   - الحجم أكبر من صفر.
5. ينشئ `WizardExcelFile`.
6. يحفظه في Signal.
7. يستدعي `loadExcelPreview()`.

### لماذا Preview قبل الاستيراد؟

لمعرفة:

- أسماء Worksheets.
- Worksheet المختارة.
- عدد الصفوف والأعمدة.
- Sample rows.

---

## onExcelWorksheetChange(event)

يقرأ Worksheet المختارة ثم يعيد طلب Preview لها.

## removeExcelFile()

يمنع الحذف إذا:

- Processing شغال.
- Excel Preview شغال.

ثم يمسح الملف والرسالة.

## loadExcelPreview(worksheetName?)

### Request

ينشئ `FormData`:

```text
file
worksheetName (اختياري)
```

ويرسل:

```http
POST /api/datasets/excel/preview
```

### النجاح

- يوقف Loading.
- يضيف Preview إلى ملف Excel.

### الفشل

- يوقف Loading.
- يمسح Preview.
- يخزن Error.
- يعرض Feedback.

---

# 11. اختيار ملفات CSV

## onFileInput(event)

يحول `FileList` إلى Array، ثم يرسلها إلى `addFiles()`.

يمسح قيمة input ليتمكن المستخدم من اختيار نفس الملف لاحقًا بعد حذفه.

## Drag and Drop

### onDragOver

- يمنع المتصفح من فتح الملف.
- يفعّل Highlight.

### onDragLeave

يلغي Highlight.

### onDrop

- يمنع التصرف الافتراضي.
- يلغي Highlight.
- يرسل الملفات إلى نفس `addFiles()`.

بهذا File Picker وDrag/Drop يستخدمان نفس التحقق.

---

## addFiles(files)

هذه أهم دالة في اختيار CSV.

### المجموعات المستخدمة

```ts
fingerprints
additions
invalidTypes
emptyFiles
duplicates
```

### لكل ملف

1. يتحقق من `.csv`.
2. يتحقق أنه صالح وغير فارغ.
3. ينشئ Fingerprint.
4. يمنع التكرار.
5. ينشئ ID محليًا.
6. يضيفه بحالة `selected`.

### continue

داخل Loop:

```ts
continue;
```

تعني تجاهل الملف الحالي والانتقال للتالي، بدل إيقاف المجموعة كلها.

### قبول جزئي

إذا اختار المستخدم:

```text
customers.csv  صحيح
photo.png      خطأ
empty.csv      فارغ
```

يُضاف `customers.csv` ويعرض Warning عن البقية.

### Feedback

- توجد إضافات وبعض المرفوضات: `warning`.
- كل الملفات مرفوضة: `error`.
- كلها صحيحة: لا توجد رسالة.

---

## selectFile(index)

يختار ملفًا للمعاينة بشرط أن Index داخل الحدود.

## selectPreviousFile()

ينقص Index دون النزول أقل من صفر.

## selectNextFile()

يزيد Index دون تجاوز آخر ملف.

## removeFile(index)

1. يمنع الحذف أثناء Processing.
2. يتحقق من Index.
3. ينشئ Array بدون الملف.
4. يحسب Index صالحًا بعد الحذف.
5. يحدث Signal.
6. يمسح Feedback.

## formatSize(bytes)

يفوض تنسيق الحجم إلى Utility مشتركة.

## previewValue(row, column)

يحول القيمة إلى نص للعرض فقط:

- `null` أو `undefined` → `Not available`.
- غير ذلك → `String(value)`.

لا يغيّر البيانات الأصلية.

---

# 12. إنشاء المشروع وربطه برفع البيانات

## createProject()

هذه أهم دالة في الصفحة.

## شروط منع التنفيذ

لا تبدأ إذا:

- توجد عملية شغالة.
- المستخدم ليس في Step 3.
- الفورم غير صالح.
- المصدر غير جاهز.
- المشروع تم إنشاؤه مسبقًا.

الشرط الأخير يمنع إنشاء مشروع ثانٍ عند Retry.

---

## فحص الجلسة

```ts
const userId = this.auth.userId();
```

إذا `null`:

- يعرض Session unavailable.
- يطلب تسجيل الدخول.
- لا يرسل الطلب.

---

## أخذ Snapshot

```ts
const value =
  this.projectForm.getRawValue();

const source = this.selectedSource();
const files = [...this.csvFiles()];
const excel = this.excelFile();
```

يأخذ نسخة من حالة الإدخال وقت الضغط.

## getRawValue()

يعيد كل قيم الفورم Typed، حتى Controls غير المفعلة لو وُجدت.

---

## Request إنشاء المشروع

```ts
this.api.createProject({
  userId,
  name: value.name.trim(),
  description:
    value.description.trim() || null,
})
```

ثم تبدأ RxJS Pipeline.

## المسار

```text
POST Create Project
       ↓
ProjectResponse
       ↓
حفظ المشروع في createdProject
       ↓
حفظه في WorkflowStateService
       ↓
اختيار Pipeline حسب المصدر
       ↓
رفع CSV أو Excel أو API
       ↓
handleUploadCompletion()
```

---

# 13. شرح RxJS المستخدم

## Observable

عملية غير متزامنة يمكن الاشتراك في نتائجها.

HTTP Request في Angular يعيد Observable.

## subscribe

يشغل الـObservable ويتعامل مع:

```ts
next
error
```

من دون `subscribe` لن يبدأ HTTP Observable العادي.

---

## pipe

تمرير الـObservable عبر Operators.

```ts
request.pipe(
  operator1,
  operator2
)
```

---

## tap

يستخدم للـSide Effects دون تغيير القيمة المارة.

في `createProject()`:

```ts
tap(project => {
  this.createdProject.set(project);
  this.workflow.setProject(project);
})
```

القيمة التي تستمر بعد `tap` ما زالت `project`.

---

## switchMap

يأخذ نتيجة Observable الأولى ويبدأ Observable ثانية تعتمد عليها.

هنا:

```text
أنشئ المشروع
→ خذ project.id
→ ابدأ الاستيراد
```

لا يمكن رفع Dataset قبل معرفة `project.id`.

---

## map

يحوّل القيمة إلى شكل جديد.

مثال:

```ts
map(dataset => ({
  fileId,
  success: true,
  dataset
}))
```

أو يحتفظ بالمشروع والنتائج:

```ts
map(results => ({
  project,
  results
}))
```

---

## from(files)

يحول Array ملفات إلى Stream:

```text
file1
file2
file3
```

## concatMap

ينفذ Observables بالترتيب، واحدة بعد الأخرى.

```text
Upload file1 وينتهي
→ Upload file2 وينتهي
→ Upload file3
```

هذا يجعل Progress وحالة الملفات واضحة وثابتة.

## catchError

يمسك خطأ Observable.

داخل رفع كل CSV، يحوّل الخطأ إلى `UploadResult` بدل إنهاء Stream كله.

## of(value)

ينشئ Observable ناجحة بقيمة جاهزة.

هنا يستخدم لتحويل الفشل إلى Result:

```ts
of({
  success: false,
  error
})
```

## toArray

ينتظر انتهاء جميع الرفعات، ثم يصدر Array واحدة من النتائج.

## take(1)

يأخذ أول قرار فقط من Dialog الخروج ثم يكمل الاشتراك تلقائيًا.

## finalize

في صفحات القائمة والبطاقة:

```ts
finalize(() => loading = false)
```

يعمل عند النجاح أو الفشل.

---

# 14. رفع CSV وExcel وAPI

## uploadFiles(project, files)

### البداية

```text
submissionState = uploading
uploadCompleted = 0
uploadTotal = files.length
```

### Pipeline

```text
from(files)
    ↓
concatMap لكل ملف
    ↓
state = uploading
    ↓
إنشاء FormData
    ↓
POST uploadDataset
    ↓
نجاح → UploadResult success
فشل  → UploadResult failed
    ↓
tap لتحديث UI
    ↓
toArray
```

### FormData

```text
file
sourceType = csv
sourceName
tableName
```

### لماذا catchError داخل concatMap؟

حتى لا يؤدي فشل ملف واحد إلى منع رفع الملفات التالية.

### النجاح

- الملف يصبح `uploaded`.
- يخزن `dataset`.
- `WorkflowStateService` يحفظ Dataset.
- يزيد Progress.

### الفشل

- الملف يصبح `failed`.
- يخزن Error.
- يزيد Progress.

---

## uploadExcel(project, item)

يدعم Worksheet واحدة.

### فحص Worksheet

إذا غير موجودة:

- يضع State = failed.
- يعيد Observable فيها Result فاشل.
- لا يرسل HTTP.

### FormData

```text
file
sourceType = excel
sourceName
worksheetName
tableName
```

### النتيجة

تُحوّل إلى `UploadResult[]` حتى تتوافق مع CSV وAPI.

---

## importApi(project)

### البداية

```text
submissionState = uploading
uploadCompleted = 0
uploadTotal = 1
apiImportState = uploading
apiError = ''
```

### Request

```http
POST /api/projects/{projectId}/datasets/api
```

Body:

```json
{
  "apiUrl": "...",
  "arrayPath": "..."
}
```

### النجاح

- `apiImportState = uploaded`.
- تخزن Dataset.
- تحفظ في Workflow State.

### الفشل

- `apiImportState = failed`.
- تخزن رسالة الخطأ.

---

# 15. الفشل الجزئي وإعادة المحاولة

## handleUploadCompletion(project)

بعد انتهاء Pipeline:

### يوجد Failed

```text
submissionState = partial
feedback = warning
```

المشروع موجود فعلًا في قاعدة البيانات، لكن بعض الاستيراد فشل.

لا ينتقل تلقائيًا، حتى يستطيع المستخدم:

- Retry.
- أو Continue مع النتيجة الجزئية.

### لا يوجد Failed

```text
submissionState = success
feedback = success
allowNavigation = true
navigate to overview
```

---

## retryFailedUploads()

### لا تنشئ مشروعًا جديدًا

تقرأ:

```ts
const project = this.createdProject();
```

ثم تعيد فقط المصدر الفاشل.

### CSV

ترسل `failedFiles()` فقط.

### Excel

ترسل ملف Excel إذا حالته `failed`.

### API

تعيد `importApi(project)`.

ثم تستدعي `handleUploadCompletion(project)` مجددًا.

---

## continueToProject()

تسمح للمستخدم بقبول Partial Result.

1. تجمع عدد الناجح.
2. تجمع أسماء الفاشل.
3. تجعل `allowNavigation = true`.
4. تنتقل إلى Overview.
5. ترسل Notice في Router State.

---

# 16. الحماية من الخروج بدون حفظ

## canDeactivate()

تعيد أحد ثلاثة أنواع من القرار:

### يسمح بالخروج

إذا:

- `allowNavigation = true`.
- أو لا توجد تغييرات غير محفوظة.

### يمنع فورًا

إذا Processing شغال.

### ينتظر Dialog

ينشئ:

```ts
new Subject<boolean>()
```

ويفتح Dialog.

يرجع:

```ts
leaveDecision
  .asObservable()
  .pipe(take(1))
```

---

## resolveLeaveDialog(leave)

- إذا `leave = true`: يسمح بالانتقال.
- يغلق Dialog.
- يرسل القرار إلى Guard.
- يكمل Subject.
- يمسح المرجع.

---

## protectBrowserUnload

`canDeactivate` يرى انتقالات Angular، لكنه لا يرى دائمًا:

- إغلاق Tab.
- Refresh.
- كتابة URL جديد.

لذلك:

```ts
@HostListener('window:beforeunload')
```

يطلب من المتصفح تأكيد الخروج.

---

## manageLeaveDialogKeyboard

يدعم:

- `Escape`: البقاء.
- `Tab` و`Shift+Tab`: حصر Focus بين Stay وLeave.

هذا يجعل Dialog قابلًا للاستخدام بالكيبورد.

---

# 17. صفحة قائمة المشاريع

الملف:

```text
projects.component.ts
```

## مسؤوليتها

- تحميل مشاريع المستخدم.
- البحث.
- الترتيب.
- استقبال Events من البطاقات.
- حفظ المشروع المختار.
- الانتقال إلى Overview.

---

## Signals

```ts
projects
loading
loadError
searchQuery
sortBy
```

## filteredProjects

Computed Signal تعتمد على:

- `projects`.
- `searchQuery`.
- `sortBy`.

### البحث

- يحذف المسافات.
- يحول إلى Lowercase.
- يبحث في الاسم.

### الترتيب

يستخدم نسخة من Array حتى لا يغير المصدر الأصلي.

---

## ngOnInit()

1. يراقب Query Parameter اسمه `search`.
2. يحدث Search Signal.
3. يستدعي `loadProjects()`.

### takeUntilDestroyed

يلغي Subscription تلقائيًا عند تدمير Component.

---

## loadProjects()

1. يقرأ `userId`.
2. يمسح Error.
3. يفعّل Loading.
4. يستدعي `getUserProjects(userId)`.
5. `finalize` يوقف Loading في النجاح أو الفشل.
6. النجاح يخزن المشاريع.
7. الفشل يعرض رسالة.

---

## updateSearch وclearSearch

تغيران Signal فقط؛ `filteredProjects` تعيد الحساب تلقائيًا.

## updateSort(value)

لا تقبل إلا:

```text
modified
created
name
```

## openProject(project)

```text
حفظ المشروع في WorkflowStateService
→ الانتقال إلى Overview
```

## onProjectUpdated(updated)

تستبدل المشروع المعدل محليًا بدل إعادة تحميل القائمة.

## onProjectDeleted(projectId)

تحذف المشروع من Array المحلية بعد نجاح الباك إند.

## compareProjects

### name

`localeCompare` ببحث غير حساس لحالة الأحرف.

### created

الأحدث أولًا باستخدام `createdAt`.

### modified

`updatedAt`، وإذا غير موجود يستخدم `createdAt`.

## timestamp

يحول تاريخ API النصي إلى رقم قابل للمقارنة.  
التاريخ غير الصحيح يصبح `0`، أي الأقدم.

---

## HTML حالات الصفحة

تعرض الصفحة:

1. Loading Skeleton.
2. Load Error مع Try Again.
3. Empty State إذا لا توجد مشاريع.
4. No Search Results.
5. Grid من `ProjectCardComponent`.

كل بطاقة ترسل Events:

```html
(openProject)
(projectUpdated)
(projectDeleted)
```

---

# 18. بطاقة المشروع والتعديل والحذف

الملف:

```text
project-card.component.ts
```

## Input

```ts
readonly project =
  input.required<ProjectResponse>();
```

الأب يرسل المشروع إلى البطاقة.

## Outputs

```ts
openProject
projectUpdated
projectDeleted
```

البطاقة لا تعدل Array الأب بنفسها؛ ترسل Event.

---

## relevantDate وdateLabel

إذا يوجد `updatedAt`:

```text
Last modified
```

وإلا:

```text
Created
```

---

## حالات البطاقة

```ts
editing
confirmingDelete
saving
deleting
errorMessage
```

`editName` و`editDescription` قيم مؤقتة للفورم.

---

## startEdit()

ينسخ بيانات المشروع إلى حقول مؤقتة.

لماذا نسخة؟  
حتى الإلغاء لا يغير بيانات الأب.

## cancelEdit()

يغلق Edit Overlay ويمسح الخطأ.

## saveEdit()

### الشروط

- الاسم بعد Trim ليس فارغًا.
- لا يوجد Save شغال.

### Request

```http
PUT /api/projects/{projectId}
```

Body:

```json
{
  "name": "...",
  "description": "..."
}
```

### finalize

يعيد `saving = false` سواء نجح أو فشل.

### النجاح

- يغلق Editor.
- يرسل `projectUpdated(updated)` للأب.

### الفشل

يعرض رسالة الباك إند أو Fallback.

---

## confirmDelete()

يفتح نافذة تأكيد، ولا يحذف مباشرة.

## cancelDelete()

يغلقها.

## deleteProject()

### الشرط

يمنع DELETE مكررًا أثناء `deleting`.

### Request

```http
DELETE /api/projects/{projectId}
```

### النجاح

يرسل ID للأب:

```ts
projectDeleted.emit(projectId)
```

### الفشل

- يغلق التأكيد.
- يعرض Error محليًا.

---

## HTML البطاقة

تعرض:

- الاسم.
- الوصف.
- تاريخ الإنشاء أو التعديل.
- زر Open.
- زر Edit.
- زر Delete.
- Edit Overlay.
- Delete Confirmation Overlay.
- Loading text أثناء Save/Delete.

---

# 19. ForgeApiService

هذه الخدمة مركز HTTP في Angular.

## createProject

```http
POST /api/projects
```

ترجع `ProjectResponse`.

## getProject

```http
GET /api/projects/{projectId}
```

## getUserProjects

```http
GET /api/projects/user/{userId}
```

ترجع `ProjectResponse[]`.

## updateProject

```http
PUT /api/projects/{projectId}
```

ترجع المشروع المعدل.

## deleteProject

```http
DELETE /api/projects/{projectId}
```

تتوقع `204 No Content`.

## getProjectOverview

```http
GET /api/projects/{projectId}/overview
```

ترجع `ProjectOverview`.

## uploadDataset

```http
POST /api/projects/{projectId}/datasets/upload
Content-Type: multipart/form-data
```

## previewExcel

```http
POST /api/datasets/excel/preview
```

لا يحفظ Dataset.

## testApiConnection

```http
POST /api/datasets/api/test
```

## previewApi

```http
POST /api/datasets/api/preview
```

## importApi

```http
POST /api/projects/{projectId}/datasets/api
```

ForgeApiService لا تقرر متى تعيد المحاولة أو ما الرسالة المعروضة؛ هذه مسؤولية Component.

---

# 20. WorkflowStateService

تخزن المشروع والـDataset الحاليين بين الصفحات.

## لماذا نحتاجها؟

عند فتح المشروع:

```text
/projects/15/overview
```

صفحات أخرى تحتاج:

- Project ID.
- Project Name.
- Dataset ID.
- Dataset Name.
- Dataset Status.

## Signals + localStorage

Signals تحدث الواجهة مباشرة.  
`localStorage` يحافظ على الحالة بعد Refresh.

## المفاتيح

```text
forgedb.currentProjectId
forgedb.currentProjectName
forgedb.currentDatasetId
forgedb.currentDatasetName
forgedb.currentDatasetStatus
```

## setProject(project)

يحفظ ID والاسم.

## setProjectId(id, name?)

لصفحة تعرف ID فقط.

## setDataset(dataset)

يحفظ بيانات Dataset المختارة أو المستوردة.

## clearDataset()

يمسح Dataset فقط ويبقي المشروع.

## clearAll()

يمسح المشروع والـDataset، مثل Logout أو Reset Workflow.

## readNumber

يرفض:

- قيمة غير رقمية.
- صفر.
- رقم سالب.
- Infinity.

## readString

يرفض النص الفارغ أو المسافات.

---

# 21. ProjectsController

المسار الأساسي:

```csharp
[Route("api/projects")]
```

وعلى الكلاس:

```csharp
[Authorize]
```

كل Endpoints تحتاج JWT صالحًا.

## Dependency Injection

```csharp
IProjectService
IProjectRepository
```

- Service للعمليات.
- Repository يستخدم هنا لفحص الملكية قبل بعض العمليات.

---

## Create

```http
POST /api/projects
```

### أهم سطر

```csharp
request.UserId = GetUserId();
```

حتى لو أرسل العميل User ID مختلفًا، السيرفر يكتب فوقه بقيمة JWT.

### النتيجة

```csharp
CreatedAtAction(...)
```

تعيد:

- `201 Created`.
- بيانات المشروع.
- Location يشير إلى Endpoint جلب المشروع.

### الخطأ

`ArgumentException` → `400 Bad Request`.

---

## GetById

```http
GET /api/projects/{projectId}
```

1. Service تجلب المشروع.
2. إذا غير موجود → 404.
3. إذا المالك مختلف → 403.
4. إذا يملكه المستخدم → 200.

---

## GetByUserId

```http
GET /api/projects/user/{userId}
```

قبل الاستعلام يقارن Route User ID مع JWT User ID.

إذا مختلف:

```http
403 Forbidden
```

ثم Service:

- مستخدم غير موجود → 404.
- مستخدم موجود → قائمة، حتى لو فارغة.

---

## Update

```http
PUT /api/projects/{projectId}
```

1. `EnsureOwnedProjectAsync`.
2. `UpdateProjectAsync`.
3. نجاح → 200.
4. غير موجود → 404.
5. Input غير صالح → 400.
6. ليس المالك → 403.

---

## Delete

```http
DELETE /api/projects/{projectId}
```

1. فحص الملكية.
2. Service تحذف.
3. `true` → 204.
4. `false` → 404.

---

## GetOverview

```http
GET /api/projects/{projectId}/overview
```

- فحص الملكية.
- Service تجمع بيانات عدة أجزاء.
- `200 OK`.

الأخطاء:

- 400 ID غير صالح.
- 403 ملكية.
- 404 مشروع غير موجود.

---

## GetExportPackage

```http
GET /api/projects/{projectId}/exports/package
```

بالإضافة إلى الأخطاء السابقة:

```http
422 Unprocessable Entity
```

إذا التصميم مفهوم لكن حالته لا تسمح بإنتاج Export صالح.

---

## GetUserId()

تبحث عن User ID في Claims:

```csharp
ClaimTypes.NameIdentifier
```

أو:

```csharp
JwtRegisteredClaimNames.Sub
```

ثم:

- تحول إلى `int`.
- تتأكد أكبر من صفر.
- وإلا ترمي `UnauthorizedAccessException`.

---

## EnsureOwnedProjectAsync()

1. يتأكد `projectId > 0`.
2. يجلب Project خفيفة.
3. إذا موجود والمالك مختلف → Exception.
4. إذا غير موجود لا يرمي هنا؛ العملية الأساسية تُرجع 404.

---

# 22. ProjectService

هذه طبقة Business Logic.

الخدمات التي تنسق معها:

```text
IProjectRepository
IDesignService
IRelationshipDetectionService
ICleaningRepository
```

---

## CreateProjectAsync

### المسار

```text
فحص request
→ Trim للاسم
→ فحص UserId
→ فحص الاسم
→ التأكد أن User موجود
→ إنشاء Project Entity
→ Repository.AddAsync
→ MapToResponse
```

### ArgumentNullException.ThrowIfNull

يمنع Request null.

### التحقق

- `UserId > 0`.
- الاسم غير فارغ.
- المستخدم موجود.

### إنشاء Entity

```csharp
new Project
{
    UserId = request.UserId,
    Name = projectName,
    Description = ...,
    CreatedAt = DateTime.UtcNow
}
```

### الحفظ

`AddAsync` يحفظ ويعيد تعبئة `project.Id`.

### العودة

لا يعيد Entity مباشرة؛ يستخدم `MapToResponse`.

---

## GetProjectByIdAsync

- يتحقق من ID.
- Repository تجلب Entity.
- إذا null يعيد null.
- وإلا يحول إلى DTO.

Controller تحول null إلى 404.

---

## GetProjectsByUserIdAsync

يفرق بين حالتين:

### المستخدم غير موجود

```csharp
return null;
```

### المستخدم موجود ولا يملك مشاريع

```csharp
return empty list;
```

ثم يحول كل Entity إلى DTO.

---

## UpdateProjectAsync

1. يفحص Request.
2. يفحص ID.
3. Trim للاسم.
4. يمنع الاسم الفارغ.
5. يحول الوصف الفارغ إلى null.
6. يستدعي `UpdateDetailsAsync`.
7. null → null.
8. Project → DTO.

---

## DeleteProjectAsync

- يفحص ID.
- يعيد Task من Repository مباشرة.
- `true` حُذف.
- `false` غير موجود.

---

# 23. ProjectRepository وEF Core

## ForgeDbContext

```csharp
private readonly ForgeDbContext _context;
```

يمثل جلسة EF Core مع قاعدة البيانات.

---

## GetByIdAsync

```csharp
_context.Projects
    .AsNoTracking()
    .FirstOrDefaultAsync(...)
```

### AsNoTracking

للقراءة فقط.  
EF Core لا يحتفظ بنسخة لتتبع التغييرات، فيقل الاستهلاك.

---

## GetByIdWithWorkspaceAsync

يحمل:

```text
Project
├── Datasets
│   ├── Columns
│   └── Rows
```

### Include

يحمل Navigation Property.

### ThenInclude

يكمل من Dataset إلى Columns أو Rows.

### AsSplitQuery

بدل Join ضخمة قد تكرر الصفوف، يقسم التحميل إلى عدة استعلامات منظمة.

---

## GetByUserIdAsync

```text
WHERE UserId = ...
ORDER BY CreatedAt DESC
THEN BY Id DESC
```

يعيد قائمة فارغة إذا لا توجد مشاريع.

---

## UserExistsAsync

يستخدم:

```csharp
AnyAsync(...)
```

يعيد Boolean دون تحميل User كامل.

---

## AddAsync

```csharp
await _context.Projects.AddAsync(project);
await _context.SaveChangesAsync();
```

### AddAsync

تضع Entity في حالة `Added`.

### SaveChangesAsync

تنفذ SQL `INSERT`.

بعد الحفظ، PostgreSQL يولد ID وEF Core يضعه في:

```csharp
project.Id
```

---

## UpdateDashboardConfigAsync

- تجلب Entity مع Tracking.
- إذا غير موجود → Exception.
- تعدل DashboardConfig وUpdatedAt.
- SaveChanges.

---

## UpdateDetailsAsync

- تجلب Entity مع Tracking.
- إذا غير موجود → null.
- تعدل الاسم والوصف والتاريخ.
- SaveChanges.
- تعيد Entity.

---

## DeleteAsync

- تجلب Entity.
- إذا غير موجود → false.
- `Remove` يجعل حالتها Deleted.
- `SaveChangesAsync` ينفذ DELETE.
- يعيد true.

إذا العلاقات مضبوطة Cascade Delete، قد تُحذف السجلات التابعة حسب إعدادات EF/DB.

---

## الفرق بين null وfalse وException

### null

عملية جلب أو تحديث متوقع أن لا تجد Record.

### false

أمر حاول تغيير صفًا لكنه لم يجد شيئًا.

### Exception

الحالة تُعتبر غير صالحة لمسار معين، مثل Dashboard Update يتوقع وجود المشروع.

---

# 24. DTOs وEntity

## Project Entity

يمثل سجل قاعدة البيانات وعلاقاته:

```csharp
Id
UserId
Name
Description
DashboardConfig
CreatedAt
UpdatedAt
User
Datasets
Design
RelationshipSuggestions
CleaningBatches
CleaningState
```

Navigation Properties تستخدم داخل EF Core.

---

## ProjectCreateDto

Input Contract لإنشاء المشروع:

```csharp
UserId
Name
Description
```

Controller تستبدل UserId بقيمة JWT.

## ProjectUpdateDto

حقول قابلة للتعديل:

```csharp
Name
Description
```

لا يسمح العميل بتعديل:

- Id.
- UserId.
- CreatedAt.
- العلاقات.

## ProjectResponseDto

Output مستقر:

```csharp
Id
UserId
Name
Description
DashboardConfig
CreatedAt
UpdatedAt
```

لا يعيد Navigation Graph.

## ProjectOverviewDto

ليس سجل DB مباشرًا؛ هو تجميع Calculated Data:

- عدد Datasets.
- الصفوف.
- الأعمدة.
- عدد المحلل.
- دفعات التنظيف.
- جودة مؤكدة.
- Schema Ready.
- العلاقات.
- Export readiness.
- Recent datasets.
- Next actions.

## ProjectExportPackageDto

يجمع:

- SQL.
- DBML.
- JSON Schema.
- Relationship Report.
- Data Quality Report.
- Status.
- GeneratedAt.

---

## لماذا لا نعيد Entity مباشرة؟

لمنع:

- تسريب Navigation Properties.
- Circular References.
- إرسال بيانات داخلية مستقبلًا.
- ربط الـAPI بشكل قاعدة البيانات مباشرة.
- مشاكل الأداء من تحميل Graph غير مقصود.

DTO تجعل Contract واضحة ومستقرة.

---

# 25. مسارات CRUD كاملة

## Create Project

```text
ProjectCreateComponent.createProject()
    ↓
ForgeApiService.createProject()
    ↓ POST /api/projects
Auth Interceptor adds JWT
    ↓
ProjectsController.Create()
    ↓ GetUserId from JWT
ProjectService.CreateProjectAsync()
    ↓
ProjectRepository.UserExistsAsync()
    ↓
ProjectRepository.AddAsync()
    ↓
EF Core SaveChangesAsync()
    ↓
PostgreSQL INSERT
    ↓
ProjectResponseDto
    ↓
201 Created
    ↓
Angular stores createdProject
```

## List Projects

```text
ProjectsComponent.loadProjects()
    ↓
ForgeApiService.getUserProjects()
    ↓ GET /api/projects/user/{userId}
ProjectsController.GetByUserId()
    ↓
JWT ownership comparison
    ↓
ProjectService.GetProjectsByUserIdAsync()
    ↓
ProjectRepository.GetByUserIdAsync()
    ↓
PostgreSQL SELECT
    ↓
ProjectResponse[]
    ↓
projects Signal
    ↓
filteredProjects computed
```

## Update Project

```text
ProjectCard.saveEdit()
    ↓
ForgeApiService.updateProject()
    ↓ PUT /api/projects/{id}
ProjectsController.Update()
    ↓ EnsureOwnedProjectAsync()
ProjectService.UpdateProjectAsync()
    ↓
ProjectRepository.UpdateDetailsAsync()
    ↓
EF Core UPDATE
    ↓
ProjectResponse
    ↓
projectUpdated Event
    ↓
ProjectsComponent replaces local item
```

## Delete Project

```text
ProjectCard.confirmDelete()
    ↓ user confirms
ProjectCard.deleteProject()
    ↓ DELETE /api/projects/{id}
ProjectsController.Delete()
    ↓ EnsureOwnedProjectAsync()
ProjectService.DeleteProjectAsync()
    ↓
ProjectRepository.DeleteAsync()
    ↓
EF Core DELETE
    ↓
204 No Content
    ↓
projectDeleted Event
    ↓
ProjectsComponent removes local item
```

---

# 26. Overview وExport

## GetProjectOverviewAsync

تجمع بيانات من أكثر من مصدر:

```text
Project + Datasets
Cleaning History
Cleaning State
Schema Readiness
Relationship Suggestions
Design
```

### الحسابات

- `DatasetsCount`.
- `TotalRows`.
- `TotalColumns`.
- `AnalyzedDatasetsCount`.
- `CleaningBatchesCount`.
- `QualityConfirmed`.
- `SchemaReady`.
- `GeneratedSchemasCount`.
- `RelationshipSuggestionsCount`.
- `AcceptedRelationshipsCount`.
- `RecentDatasets`.
- `NextRecommendedActions`.

---

## BuildNextRecommendedActions

تنتج الخطوة التالية حسب حالة المشروع.

### لا توجد Datasets

```text
Import datasets
```

### توجد غير محللة

```text
Analyze datasets
```

### توجد اقتراحات علاقات ولم يقبل شيء

```text
Review relationships
```

### لا يوجد Design

```text
Generate design
```

### كل شيء جاهز

```text
Open Exports
```

---

## ResolveExportReadiness

الحالات:

```text
Upload datasets
Analyze datasets
Generate design
Ready
Ready without accepted relationships
```

---

## GetProjectExportPackageAsync

### الخطوات

1. يجلب Workspace.
2. يبني Data Quality Report.
3. يطلب Design Artifacts.
4. إذا لا توجد Artifacts يعيد Package فارغة مع Status.
5. إذا توجد Validation Errors يرمي `DesignValidationFailedException`.
6. يجلب Relationship Suggestions.
7. يبني Relationship Report.
8. يعيد SQL وDBML وJSON والتقارير.

---

## ParseEvidence

يحاول تحويل Evidence JSON إلى `JsonElement`.

إذا JSON قديم أو تالف:

```csharp
catch (JsonException)
{
    return null;
}
```

لا يفشل Export كاملًا بسبب Evidence واحدة.

---

## BuildDataQualityReportJson

يلخص لكل Dataset:

- ID.
- Table name.
- Rows.
- Columns.
- Missing values.
- Duplicates.
- Status.
- AnalyzedAt.

ثم يحولها إلى JSON.

---

# 27. الحماية والملكية

## [Authorize]

يمنع المستخدم غير المسجل من الوصول إلى Endpoints.

## JWT User ID

السيرفر يأخذ المالك من Token الموقعة.

لا يكفي أن يخفي الفرونت زرًا؛ الحماية الحقيقية في الباك إند.

## Ownership

قبل:

- القراءة.
- التعديل.
- الحذف.
- Overview.
- Export.

النظام يقارن:

```text
Project.UserId
مع
JWT UserId
```

## الفرق بين Authentication وAuthorization

### Authentication

من أنت؟

يتم عبر JWT.

### Authorization

هل يحق لك فتح هذا المشروع؟

يتم عبر Ownership check.

---

# 28. HTTP Status Codes

| الكود | المعنى في الفيتشر |
|---:|---|
| 200 | قراءة أو تعديل ناجح |
| 201 | مشروع جديد أُنشئ |
| 204 | حذف ناجح ولا يوجد Body |
| 400 | ID أو Input غير صالح |
| 401 | JWT مفقود أو غير صالح |
| 403 | المستخدم مسجل لكنه لا يملك المشروع |
| 404 | المشروع أو المستخدم غير موجود |
| 422 | البيانات مفهومة لكن Design لا تسمح بالتصدير |

## 201 vs 200

`201 Created` أدق عند إنشاء Resource جديد.

## 204

بعد الحذف لا يوجد Project Representation لإرجاعها.

---

# 29. CancellationToken

Controller تستقبل:

```csharp
CancellationToken cancellationToken
```

ويمر عبر:

```text
Controller
→ Service
→ Repository
→ EF Core
```

إذا أغلق العميل الاتصال أو ألغى الطلب، يمكن إلغاء العمل غير الضروري بدل استمراره.

يستخدم خصوصًا مع:

```csharp
FirstOrDefaultAsync
ToListAsync
AnyAsync
SaveChangesAsync
```

---

# 30. الاختبار العملي

## تشغيل البيئة

### PostgreSQL

```bash
docker compose up -d postgres
docker compose ps
```

### Backend

```bash
dotnet run \
  --project backend/ForgeDB.API/ForgeDB.API.csproj
```

### Frontend

```bash
cd frontend/angular-app
npx ng serve
```

---

## Test Cases — Create

- مشروع باسم صحيح وCSV صحيح.
- اسم فارغ.
- اسم مسافات فقط.
- اسم أكثر من 100 في Angular.
- وصف أكثر من 500 في Angular.
- الضغط مرتين.
- Session مفقودة.
- CSV فارغ.
- ملف غير CSV.
- CSV مكرر.
- مجموعة فيها ملفات صحيحة وخاطئة.
- Excel غير `.xlsx`.
- Excel فارغ.
- تغيير Worksheet.
- API URL غير صالح.
- API Test ناجح وPreview فاشل.
- Import API ناجح.
- فشل بعض CSV ثم Retry.
- Continue بعد Partial.
- محاولة الخروج قبل الحفظ.
- Refresh قبل الحفظ.

## Test Cases — List

- مستخدم بدون مشاريع.
- مستخدم لديه مشاريع.
- Search موجود.
- Search بدون نتائج.
- Sort by Name.
- Sort by Created.
- Sort by Modified.
- Refresh.
- API Error.

## Test Cases — Edit

- اسم صحيح.
- اسم فارغ.
- Cancel.
- Backend Error.
- ضغط Save مرتين.

## Test Cases — Delete

- فتح Confirmation.
- Cancel.
- Delete ناجح.
- Delete Error.
- ضغط Delete مرتين.
- محاولة حذف مشروع مستخدم آخر.

## Ownership

- بدون JWT.
- JWT مستخدم A مع Project مستخدم B.
- تغيير `userId` في URL.
- تغيير `userId` في Create Body.

---

# 31. أسئلة مقابلة متوقعة

## لماذا تستخدم Service وRepository؟

لفصل:

- HTTP.
- Business Logic.
- Database Access.

يسهل الاختبار والصيانة.

## ما الفرق بين DTO وEntity؟

- Entity تمثل DB وعلاقاتها.
- DTO تمثل API Input أو Output.

## لماذا Backend validation مع وجود Angular validation؟

لأن العميل غير موثوق ويمكن تجاوز Angular.

## لماذا switchMap؟

لأن Import يحتاج `project.id` الذي يأتي من طلب Create.

## لماذا concatMap لملفات CSV؟

لرفعها بالترتيب واحدة بعد الأخرى.

## لماذا catchError داخل concatMap؟

حتى لا يوقف فشل ملف واحد بقية الملفات.

## لماذا toArray؟

لانتظار اكتمال كل الملفات ثم اتخاذ قرار النجاح أو الفشل الجزئي.

## لماذا AsNoTracking؟

لتحسين قراءة Entity لن يتم تعديلها.

## لماذا Include وThenInclude؟

لتحميل العلاقات المطلوبة مع المشروع.

## لماذا AsSplitQuery؟

لتجنب Join ضخمة عند تحميل أكثر من Collection.

## لماذا MapToResponse؟

لمنع تسريب Entity وعلاقات EF Core.

## كيف تحمي ملكية المشروع؟

`[Authorize]` + استخراج User ID من JWT + مقارنة `Project.UserId`.

## ما معنى Partial Success؟

Project أُنشئ لكن Dataset واحدة أو أكثر فشلت، ويمكن إعادة المحاولة دون إنشاء Project جديدة.

---

# 32. ملخص الحفظ السريع

## إنشاء المشروع

```text
Component
→ API Service
→ Controller
→ Service
→ Repository
→ DB
```

## إنشاء + استيراد

```text
Create Project
→ get project.id
→ import selected source
→ success or partial
```

## الصفحة

```text
Signals = حالة
Computed = قيم مشتقة
Reactive Form = إدخال وتحقيق
RxJS = ترتيب العمليات غير المتزامنة
Guard = منع الخروج
```

## الباك إند

```text
Controller = HTTP + JWT + Status Codes
Service = Rules + Coordination + Mapping
Repository = EF Core + PostgreSQL
DTO = API Contract
Entity = DB Model
```

## أهم Operators

```text
tap       = Side effect
switchMap = ابدأ طلبًا يعتمد على نتيجة السابق
map       = غيّر شكل القيمة
from      = Array إلى Stream
concatMap = نفذ بالترتيب
catchError= تعامل مع الخطأ
of        = أنشئ Observable بقيمة
toArray   = اجمع النتائج
finalize  = نفذ في النجاح والفشل
take(1)   = خذ أول قيمة فقط
```

---

# 33. تحسينات مؤجلة لما بعد الفهم

> هذا القسم للتسجيل فقط. لا ننفذ شيئًا منه حتى ننتهي من فهم الفيتشر واختباره.

## تحسينات محتملة

1. إزالة `userId` من Create Request والاعتماد على JWT فقط.
2. استبدال:
   ```http
   GET /api/projects/user/{userId}
   ```
   بمسار يعتمد على JWT مثل:
   ```http
   GET /api/projects
   ```
3. توحيد قيود طول الاسم والوصف في Backend بشكل صريح.
4. تنفيذ Ownership داخل Queries نفسها لتقليل الفصل بين الفحص والتنفيذ.
5. تقسيم `project-create.component.ts` إلى Components أصغر بعد التأكد من السلوك.
6. إضافة حالة Project واضحة مثل Draft / Importing / Ready / Partial.
7. Server-side pagination إذا زاد عدد المشاريع.
8. البحث والترتيب من السيرفر إذا أصبحت القوائم كبيرة.
9. قرار موحد هل المشروع غير المملوك يعيد 403 أو 404.
10. إضافة Integration Tests حقيقية لمسار Create + Upload + Retry.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. كيف ينشأ المشروع.
2. كيف يأخذ النظام `project.id`.
3. كيف يبدأ رفع البيانات بعد الإنشاء.
4. الفرق بين CSV وExcel وAPI.
5. كيف يعمل Partial Retry.
6. كيف تمنع الصفحة الخروج.
7. كيف تصل الطلبات إلى PostgreSQL.
8. كيف تحمي JWT وOwnership المشاريع.
9. كيف تعمل عمليات العرض والتعديل والحذف.
10. كيف يبني Overview وExport معلومات مجمعة.
