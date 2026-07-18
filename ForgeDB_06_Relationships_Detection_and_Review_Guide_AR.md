# ForgeDB — دليل جلسة Relationships Detection & Review الكامل

> **الجلسة رقم 06 — Relationships Detection & Review**  
> الفرع: `feature/final-ui-integration`  
> الهدف: فهم اكتشاف العلاقات بين الـDatasets، حساب الثقة والأدلة، الفرق بين الاقتراح والعلاقة الفعلية، القبول والرفض والتعديل، إنشاء العلاقات يدويًا، Revision و`If-Match`، وتأثير العلاقات على الـER Diagram وSQL والتصدير والنشر.

---

## طريقة استخدام الدليل

- هذا الملف هو شرح الجلسة كاملًا، والشات للأسئلة.
- **سبق في الجلسات السابقة:** سأذكر المفهوم ثم أوضح استخدامه هنا.
- **مفهوم جديد:** سأشرحه بتركيز أكبر.
- لا يوجد قسم أسئلة مقابلة.

---

# المحتويات

1. الصورة العامة  
2. مكان الفيتشر في Workflow  
3. أهم فرق: Suggestion وDesignRelationship  
4. الصفحة والمسارات  
5. الملفات والطبقات  
6. شرط وجود Schema Design  
7. ProjectRelationshipsComponent  
8. Signals وComputed  
9. تحميل Workspace  
10. runMutation وإعادة المزامنة  
11. Detect Relationships  
12. Column Profiles  
13. Direction: Source وTarget  
14. شروط تكوين Candidate  
15. Confidence Score  
16. Evidence JSON  
17. اختيار أفضل اتجاه  
18. تخزين Suggestions  
19. Lifecycle: Suggested / Accepted / Rejected  
20. إعادة Detection  
21. عرض Confidence في الواجهة  
22. قبول Suggestion مباشرة  
23. Edit Before Accept  
24. Draft Validation  
25. Target PK أو Unique  
26. Type Compatibility  
27. Cardinality  
28. On Delete  
29. قبول Suggestion في الباك إند  
30. Atomic Acceptance  
31. Reject Suggestion  
32. إنشاء Relationship يدويًا  
33. تعديل Relationship  
34. حذف Relationship  
35. Design Revision  
36. If-Match  
37. 428 و409  
38. Optimistic Concurrency  
39. Idempotency والتعامل مع السباق  
40. Validation بعد تغيير العلاقات  
41. Pending Suggestions لا تمنع الاستمرار  
42. RelationshipSuggestionsController  
43. RelationshipDetectionService  
44. RelationshipSuggestionRepository  
45. DesignController وDesignService  
46. Entities وDTOs  
47. تأثير العلاقات على المخرجات  
48. المسارات الكاملة  
49. الحالات والأخطاء  
50. الاختبار العملي  
51. ملخص الحفظ  
52. تحسينات مؤجلة

---

# 1. الصورة العامة

بعد تنظيف البيانات وتحليلها، يحتاج ForgeDB معرفة الروابط المنطقية بين الجداول.

مثال:

```text
customers.id
orders.customer_id
```

العلاقة المحتملة:

```text
orders.customer_id
→ customers.id
```

ForgeDB يحاول اكتشاف هذه الروابط باستخدام:

```text
Column names
Table names
Key-like names
Uniqueness
Repeated values
Value overlap
Dataset sizes
Current design keys
```

ثم يعرضها للمستخدم كـSuggestions.

المستخدم يستطيع:

```text
Accept
Reject
Edit before accepting
Create manually
Edit persisted relationship
Delete persisted relationship
```

---

# 2. مكان الفيتشر في Workflow

الدورة المنطقية:

```text
Import
→ Analysis
→ Cleaning
→ Re-analysis
→ Confirm Quality
→ Generate Schema Design
→ Detect / Review Relationships
→ Validate Design
→ ER Diagram
→ Export / Deployment
```

في التطبيق Route العلاقات:

```text
/projects/:projectId/relationships
```

لكن الصفحة الحالية تحتاج **Design محفوظة** تحتوي Tables وColumns قبل أن تستطيع قبول أو إنشاء Relationships.

إذا لا توجد Design، تعرض:

```text
Generate a schema first
```

مع رابط إلى Schema Designer.

> **سبق في Data Cleaning:** Schema لا تُولد حتى تكون Active cleaned versions محللة ومؤكدة.

---

# 3. أهم فرق: Suggestion وDesignRelationship

> **مفهوم جديد ومحوري**

## RelationshipSuggestion

ترشيح اكتشفه النظام.

مثال:

```text
orders.customer_id
قد يشير إلى
customers.id
```

تحتوي:

```text
Source Dataset / Column
Target Dataset / Column
Confidence Score
Evidence
Status
CreatedAt
DecidedAt
```

لا تدخل وحدها في SQL أو ER Diagram.

## DesignRelationship

العلاقة الحقيقية المحفوظة داخل Design.

تحتوي:

```text
FromColumnId
ToColumnId
Cardinality
OnDelete
Origin
SuggestionId optional
```

هذه التي تستخدم في:

```text
ER Diagram
Foreign keys
SQL generation
DBML
JSON schema
Exports
Deployment
```

## التحول

```text
Suggestion accepted
→ DesignRelationship created
→ Suggestion status = accepted
```

## الرفض

```text
Suggestion rejected
→ no DesignRelationship created
```

## Manual

```text
User creates relationship manually
→ DesignRelationship created
→ no Suggestion required
```

---

# 4. الصفحة والمسارات

## Route

```text
/projects/:projectId/relationships
```

الـComponent المستخدمة:

```text
ProjectRelationshipsComponent
```

يوجد أيضًا Component قديم باسم `relationships` في المشروع، لكن Route الفعلية الحالية تستخدم:

```text
pages/project-relationships/project-relationships.component
```

## الصفحة تعرض

- زر Refresh.
- زر Detect Relationships.
- رابط Schema Designer.
- رابط Continue to ER Diagram.
- Design revision/status.
- عدد Tables.
- عدد Persisted Relationships.
- Pending Suggestions.
- Accepted/Rejected counts.
- Manual relationship form.
- Persisted relationships.
- Edit/Delete.
- Validate Current Design.

---

# 5. الملفات والطبقات

## Frontend

```text
pages/project-relationships/project-relationships.component.ts
pages/project-relationships/project-relationships.component.html
services/design-api.service.ts
services/api.models.ts
services/workflow-state.service.ts
app.routes.ts
```

## Backend — Suggestions

```text
Controllers/RelationshipSuggestionsController.cs
Services/RelationshipDetectionService.cs
Services/Interfaces/IRelationshipDetectionService.cs
Repositories/RelationshipSuggestionRepository.cs
Repositories/Interfaces/IRelationshipSuggestionRepository.cs
Models/Entities/RelationshipSuggestion.cs
```

## Backend — Persisted Design Relationships

```text
Controllers/DesignController.cs
Services/DesignService.cs
Repositories/DesignRepository.cs
Models/Entities/DesignModel.cs
Models/Entities/DesignTable.cs
Models/Entities/DesignColumn.cs
Models/Entities/DesignRelationship.cs
Services/Validation/DesignRelationshipRules.cs
```

## المسار العام

> **سبق في الجلسات السابقة:**  
> `Component → API Service → Controller → Service → Repository → PostgreSQL`.

هنا يوجد مساران:

### Detection

```text
ProjectRelationshipsComponent
→ DesignApiService.detectSuggestions
→ RelationshipSuggestionsController
→ RelationshipDetectionService
→ DatasetRepository + SuggestionRepository + DesignRepository
→ PostgreSQL
```

### Persisted relationship

```text
Component
→ DesignApiService
→ DesignController أو RelationshipSuggestionsController
→ DesignService / RelationshipDetectionService
→ DesignRepository
→ PostgreSQL
```

---

# 6. شرط وجود Schema Design

Detection تستطيع مقارنة Datasets حتى لو Design غير موجودة.

لكن Acceptance تحتاج Design لأن Suggestion تشير إلى:

```text
Dataset IDs + original column names
```

بينما العلاقة الحقيقية تحتاج:

```text
DesignTable IDs + DesignColumn IDs
```

لذلك عند القبول يجب تحويل:

```text
SourceDatasetId + SourceColumnName
→ DesignColumn
```

و:

```text
TargetDatasetId + TargetColumnName
→ DesignColumn
```

إذا لم توجد Design:

```text
Accepting a suggestion requires a generated design.
```

الواجهة تمنع الوصول للـworkspace الكامل وتعرض رابط Generate Schema.

---

# 7. ProjectRelationshipsComponent

الكلاس يدير:

1. تحميل Suggestions وDesign.
2. تشغيل Detection.
3. قبول ورفض Suggestions.
4. تحرير Suggestion قبل القبول.
5. إنشاء Relationship يدويًا.
6. تعديل Relationship محفوظة.
7. حذف Relationship.
8. إعادة Validation.
9. التعامل مع Revision conflicts.

## Types

```ts
type FeedbackKind =
  'success' | 'warning' | 'error';
```

## RelationshipFormDraft

```text
fromTableId
fromColumnId
toTableId
toColumnId
cardinality
onDelete
```

## Workspace

```ts
interface Workspace {
  suggestions: RelationshipSuggestion[];
  design: DesignModelResponse | null;
}
```

---

# 8. Signals وComputed

> **سبق:** Signals وComputed شُرحت في Projects.

## Signals

```text
suggestions
design
loading
busyAction
feedback

editingSuggestionId
suggestionDraft
manualDraft

editingRelationshipId
relationshipDraft
deleteTarget
```

## busyAction

لا تخزن Boolean فقط، بل Key:

```text
detect
validate
accept:15
reject:15
create
edit:10
delete:10
```

هذا يسمح للواجهة بمعرفة أي زر تحديدًا يعرض Loading.

## Computed

### pendingSuggestions

```text
status === suggested
```

### acceptedSuggestionCount

```text
status === accepted
```

### rejectedSuggestionCount

```text
status === rejected
```

### tables

Design tables أو Array فارغة.

### persistedRelationships

العلاقات الحقيقية المحفوظة في Design.

### needsValidation

```text
design exists
AND design.status !== Valid
```

---

# 9. تحميل Workspace

## ngOnInit

1. يقرأ `projectId`.
2. يتحقق أنه Integer موجب.
3. يحفظه في WorkflowState.
4. يستدعي `reloadWorkspace()`.

## fetchWorkspace

> **سبق:** `forkJoin` شُرحت في Data Analysis.

ترسل بالتوازي:

```text
GET relationship suggestions
GET current design
```

إذا Design تعيد `404`:

```text
catchError
→ return null
```

لكن أي خطأ آخر يفشل Workspace.

## applyWorkspace

```text
suggestions Signal = response suggestions
design Signal = response design
```

---

# 10. runMutation وإعادة المزامنة

`runMutation<T>` Helper موحدة لكل عمليات الصفحة.

المسار:

```text
check no busy action
→ clear feedback
→ set busy key
→ execute mutation request
→ switchMap to fetchWorkspace
→ apply latest workspace
→ close/reset UI if needed
→ show success
→ finalize clears busy
```

> **سبق:** `switchMap` و`finalize`.

## لماذا يعيد Fetch بعد كل Mutation؟

Response العملية قد لا تحتوي Workspace كاملة.

كما أن العملية قد تغيّر:

```text
Suggestion status
Design relationships
Design revision
Design status
Validation state
```

إعادة الجلب تجعل Signals مبنية على مصدر الحقيقة في الباك إند.

## recoverFromMutationError

حتى عند الفشل:

```text
save error message
→ fetch latest workspace
→ apply it
→ show original error
```

هذا مهم في Concurrency conflicts؛ قد تكون Data في الواجهة أصبحت قديمة.

---

# 11. Detect Relationships

زر:

```text
Detect Relationships
```

يرسل:

```http
POST /api/projects/{projectId}/relationship-suggestions/detect
```

## الخدمة تفعل

1. تتأكد Project موجودة.
2. تجلب Datasets مع Rows وColumns.
3. تجلب Design الحالية إن وجدت.
4. تبني Profile لكل Column.
5. تقارن Columns بين Datasets المختلفة.
6. تحسب الاتجاهين.
7. تختار Candidate الأفضل.
8. تحفظ أو تحدث Suggestions.
9. تعيد جميع Suggestions.

Detection لا تنشئ Foreign Keys مباشرة.

---

# 12. Column Profiles

لكل DatasetColumn تبني:

```text
Dataset
Column
Normalized table name
Stored non-empty values
IsUnique
HasRepeatedValues
```

## Values

تُقرأ من كل `DatasetRow.RowData` JSON حسب Column name.

القيم:

- ترتب حسب RowNumber.
- Null/empty تُستبعد.
- تتحول إلى String للمقارنة.

## IsUnique

```text
values count > 0
AND
distinct count == values count
```

## HasRepeatedValues

```text
values count > 0
AND
distinct count < values count
```

مثال:

```text
customers.id
1,2,3
→ unique
```

```text
orders.customer_id
1,1,2,3,3
→ repeated
```

هذا شكل مناسب لعلاقة:

```text
many orders
→ one customer
```

---

# 13. Direction: Source وTarget

> **مفهوم جديد مهم**

العلاقة لها اتجاه:

```text
Source / From
→ Target / To
```

في قاعدة البيانات غالبًا:

```text
Foreign key column
→ Primary/Unique key column
```

مثال:

```text
orders.customer_id     = Source
customers.id           = Target
```

Detection تحسب:

```text
ScoreDirection(left, right)
ScoreDirection(right, left)
```

ثم تختار الاتجاه المنطقي الأفضل.

## شرط Target في Detection

Target values يجب أن تكون Unique.

## شرط Target عند الحفظ

Design target column يجب أن تكون:

```text
Primary Key
أو
Unique
```

القيم الفعلية وحدها لا تكفي؛ تصميم قاعدة البيانات يحتاج Constraint واضحة.

---

# 14. شروط تكوين Candidate

`ScoreDirection(source, target)` تعيد null إذا:

```text
Target ليست Unique
أو
Source وTarget من نفس Dataset
```

ثم تحسب الأدلة:

## Name evidence

واحد من:

```text
same column name
similar normalized name
source column prefix matches target table
```

## Value evidence

```text
overlap >= 25%
```

## Shape evidence

```text
source has repeated values
أو
source dataset rows >= target dataset rows
```

## Key evidence

```text
source or target column looks key-like
```

## شروط الرفض المبكر

لا Candidate إذا:

```text
no name evidence AND overlap < 25%
```

أو:

```text
no shape evidence AND overlap < 80%
```

أو:

```text
no key evidence AND overlap < 50%
```

هذه الشروط تقلل الاقتراحات العشوائية.

---
# 15. Confidence Score

> **مفهوم جديد**

كل Candidate تبدأ:

```text
confidence = 0.20
```

ثم تزداد حسب الأدلة.

## الأوزان الحالية

### أسماء متطابقة

```text
+0.22
```

### أسماء متشابهة

```text
+0.16
```

### Source name تشير إلى Target table

```text
+0.12
```

مثال:

```text
customer_id
→ customers
```

### Key-like naming

إذا واحد فقط Key-like:

```text
+0.10
```

إذا الاثنان Key-like:

```text
+0.16
```

### Target unique

```text
+0.20
```

هذه تضاف دائمًا لأن Candidate لا تصل لهذه المرحلة إلا والTarget Unique.

### Source has repeated values

```text
+0.14
```

### Value overlap

```text
+ min(0.25, overlap × 0.25)
```

مثال:

```text
80% overlap
→ +0.20
```

### Source dataset أكبر أو مساوية للTarget

```text
+0.05
```

## الحد الأدنى

إذا النتيجة أقل من:

```text
0.55
```

لا تُنشأ Suggestion.

## الحد الأعلى

```text
0.99
```

حتى لا يعرض النظام 100% يقين من Heuristics.

---

# 16. Evidence JSON

كل Suggestion تحفظ `EvidenceJson`.

مثال منطقي:

```json
{
  "reasons": [
    "Source column name appears to reference the target table.",
    "Target column values are unique.",
    "Source column has repeated values.",
    "Value overlap is 83%."
  ],
  "overlap": 0.83,
  "sameName": false,
  "similarName": true,
  "sourceReferencesTargetTable": true,
  "sourceKeyLike": true,
  "targetKeyLike": true
}
```

## لماذا JSON؟

الأدلة قد تتوسع مستقبلًا بدون إضافة Column جديدة لكل نوع Evidence.

## Frontend suggestionReasons

تحاول:

```ts
JSON.parse(evidenceJson)
```

ثم تأخذ `reasons` إذا كانت Array Strings.

إذا JSON تالفة:

```text
return []
```

ولا تفشل الصفحة.

---

# 17. اختيار أفضل اتجاه

لكل زوج Columns، قد ينجح الاتجاهان.

`ChooseCandidate(forward, reverse, design)` تعمل:

1. إذا واحد فقط موجود، تختاره.
2. إذا Design موجودة، تفضّل الاتجاه الذي Target حقه PK/Unique في Design.
3. إذا كلاهما متساويان من هذه الناحية، تختار Score الأعلى.
4. عند التعادل، تبقي Forward.

## لماذا Design Key لها أولوية؟

لأن العلاقة التي تنتهي عند Key حقيقية في Schema أسهل وأصح للحفظ من اتجاه Score أعلى قليلًا لكنه ينتهي عند Column عادية.

---

# 18. تخزين Suggestions

Entity:

```text
RelationshipSuggestion
```

المفتاح المنطقي:

```text
ProjectId
SourceDatasetId
SourceColumnName
TargetDatasetId
TargetColumnName
```

## عند Detection

### لا توجد Suggestion

```text
insert new row
status = suggested
createdAt = now
```

### موجودة وحالتها suggested

تحدث:

```text
Score
EvidenceJson
```

### Accepted أو Rejected

لا تغيرها Detection.

```text
decision is preserved
```

## Save واحد

الخدمة تضيف/تحدث كل Candidates ثم تنفذ:

```text
SaveChangesAsync once
```

بدل Save لكل Suggestion.

---

# 19. Lifecycle: Suggested / Accepted / Rejected

الثوابت:

```text
suggested
accepted
rejected
```

## suggested

بانتظار قرار المستخدم.

## accepted

تم إنشاء أو ربط DesignRelationship.

## rejected

رفضها المستخدم، ولا توجد Relationship ناتجة عنها.

## DecidedAt

تُملأ عند Accept أو Reject.

## CreatedAt

وقت إنشاء Suggestion أول مرة.

---

# 20. إعادة Detection

عند تشغيل Detection مجددًا:

- Suggestions المعلقة الموجودة قد تحصل على Score/Evidence جديدة.
- Candidates الجديدة تُضاف.
- Accepted تبقى Accepted.
- Rejected تبقى Rejected.
- القرار لا يُمحى تلقائيًا.

الهدف:

```text
Rejected suggestion can never silently reappear as pending.
```

## ملاحظة عن الوضع الحالي

Detection تعمل Upsert للـCandidates المكتشفة، لكنها لا تحذف كل Pending Suggestion قديمة لم تعد تظهر في الجولة الجديدة.

هذه نقطة مسجلة لاحقًا ضمن التحسينات، وليست تغييرًا في شرح السلوك الحالي.

---

# 21. عرض Confidence في الواجهة

## confidencePercent

إذا Score بين 0 و1:

```text
score × 100
```

إذا API أعادت Score كنسبة أصلًا:

```text
uses it directly
```

ثم:

```text
round
clamp between 0 and 100
```

## الألوان

```text
80%+      green
55%–79%   amber
below 55% red
```

عمليًا Detection لا تحفظ Candidate أقل من 55%، لكن الواجهة تتحمل أي Response.

## الواجهة تعرض

- Source → Target.
- Confidence.
- Suggested cardinality.
- Suggested On Delete.
- أول 3 Reasons.
- Warning إذا Suggestion لا يمكن قبولها مباشرة.

---

# 22. قبول Suggestion مباشرة

`acceptSuggestion(suggestion)`:

1. يحول Suggestion إلى Draft باستخدام Design الحالية.
2. يعمل Validation.
3. إذا Valid، يرسل Accept.
4. إذا Invalid، يطلب Edit أولًا.

## Draft defaults

```text
cardinality = many-to-one
onDelete = no-action
```

## draftForSuggestion

يبحث عن:

```text
DesignTable.SourceDatasetId
```

ثم عن Column التي:

```text
SourceColumnName
أو DesignColumn.SourceColumnName
```

وبذلك يربط أسماء Dataset الأصلية مع IDs الخاصة بالDesign.

---

# 23. Edit Before Accept

المستخدم يستطيع تعديل:

```text
Source Table
Source Column
Target Table
Target Column
Cardinality
On Delete
```

هذا مفيد إذا Detection:

- اختارت الاتجاه الخطأ.
- ربطت Column مشابهة لكن ليست الصحيحة.
- تحتاج One-to-one بدل Many-to-one.
- تحتاج Cascade أو Set null.

## updateSuggestionDraft

عند تغيير Source Table:

```text
clear source column
clear target column
```

عند تغيير Source Column:

```text
clear target column
```

عند تغيير Target Table:

```text
clear target column
```

الهدف منع بقاء ID Column لم تعد تنتمي إلى Table المختارة.

---

# 24. Draft Validation

`validateDraft()` تتحقق من:

1. Design موجودة.
2. Source/Target tables وcolumns مختارة.
3. IDs تنتمي إلى Design الحالية.
4. Source وTarget ليست نفس Column.
5. Target PK أو Unique.
6. PostgreSQL types متوافقة.
7. Cardinality مدعومة.
8. On Delete مدعوم.
9. لا توجد Relationship مطابقة.

## allowExisting

عند Accept Suggestion:

```text
allowExisting = true
```

لأن الباك إند قد يجد Relationship مطابقة موجودة بالفعل ويربط Suggestion بها بدل إنشاء Duplicate.

أما Manual Create:

```text
allowExisting = false
```

فتمنع Duplicate في الواجهة.

---

# 25. Target PK أو Unique

> **مفهوم جديد مهم في قواعد البيانات**

Foreign Key يجب أن تشير إلى Column تضمن أن القيمة تحدد Row واحدة.

في PostgreSQL تكون Target عادة:

```text
PRIMARY KEY
أو
UNIQUE
```

مثال صحيح:

```text
orders.customer_id
→ customers.id (PK)
```

مثال غير صالح:

```text
orders.city
→ customers.city
```

إذا `customers.city` ليست Unique، المدينة قد تظهر في عدة Rows ولا تحدد Customer واحدة.

## targetColumnDisabled

الواجهة تعطل Target إذا:

```text
not PK and not Unique
same endpoint
type mismatch
```

---

# 26. Type Compatibility

Source وTarget يجب أن تستخدم نفس PostgreSQL type.

مثال صالح:

```text
INTEGER → INTEGER
UUID → UUID
```

مثال غير صالح:

```text
INTEGER → TEXT
```

## Frontend normalize

تحول:

```text
trim
collapse spaces
uppercase
TIMESTAMP WITH TIME ZONE → TIMESTAMPTZ
```

ثم تقارن.

## Backend

تستخدم:

```text
DesignRelationshipRules.HaveCompatibleTypes
```

الباك إند هي الحماية النهائية.

> **سبق:** Validation في Angular لتحسين UX، والباك إند لا يثق في العميل.

---

# 27. Cardinality

> **مفهوم جديد**

المدعوم حاليًا:

```text
many-to-one
one-to-one
```

## Many-to-one

Rows كثيرة في Source قد تشير إلى Row واحدة في Target.

مثال:

```text
many orders
→ one customer
```

```text
orders.customer_id
→ customers.id
```

هذا هو Default.

## One-to-one

كل Source Row ترتبط بTarget Row واحدة، والعكس منطقيًا واحدة.

مثال:

```text
users
→ user_profiles
```

عادة تحتاج Unique constraint على Source FK أيضًا لضمان One-to-one فعليًا.

## غير مدعوم مباشرة

```text
many-to-many
one-to-many
```

One-to-many هي قراءة عكسية لـmany-to-one.

Many-to-many تحتاج Junction Table، وليست Relationship مباشرة واحدة في النموذج الحالي.

---

# 28. On Delete

الخيارات:

```text
no-action
cascade
set-null
```

## No action

منع حذف Target row إذا توجد Source rows مرتبطة، بحسب Constraint/SQL الناتجة.

مناسب كخيار آمن افتراضي.

## Cascade

حذف Target row يؤدي إلى حذف Source rows المرتبطة.

مثال:

```text
delete customer
→ delete orders
```

عملية قوية وخطرة إذا استخدمت بلا فهم.

## Set null

حذف Target row يجعل Source foreign key:

```text
NULL
```

يتطلب منطقيًا أن Source Column تكون Nullable.

Validation الشاملة للDesign يجب أن تكتشف التعارض إذا Column ليست Nullable.

---

# 29. قبول Suggestion في الباك إند

Endpoint:

```http
POST /api/relationship-suggestions/{id}/accept
If-Match: {designRevision}
```

Body:

```json
{
  "fromColumnId": 10,
  "toColumnId": 3,
  "cardinality": "many-to-one",
  "onDelete": "no-action"
}
```

## AcceptAsync

تنفذ داخل Design Repository Transaction.

## AcceptCoreAsync

1. تجلب Suggestion.
2. تجلب Design كاملة مع Tracking.
3. تبحث هل Suggestion مرتبطة مسبقًا بعلاقة.
4. تمنع قبول Rejected Suggestion.
5. تقارن Revision.
6. تحل Source وTarget Columns.
7. تتحقق من Endpoints.
8. تبحث عن Relationship مطابقة.
9. تغير Suggestion إلى Accepted.
10. تربط Existing Relationship أو تنشئ واحدة.
11. تحدث Design Revision/Status إذا أضيفت Relationship جديدة.
12. تحفظ.

---

# 30. Atomic Acceptance

> **مفهوم جديد مهم**

قبول Suggestion يغير شيئين:

```text
Suggestion.Status = accepted
DesignRelationship created
```

يجب ألا ينجح واحد ويفشل الآخر.

الخدمة تستخدم:

```text
ExecuteInTransactionAsync
```

وبنفس DbContext request-scoped.

عند إنشاء Relationship جديدة، `SaveChanges` واحدة تحفظ:

```text
Suggestion decision
+
Design relationship
+
Design revision
```

إما كلها تنجح أو كلها ترجع.

---

# 31. Reject Suggestion

Endpoint:

```http
POST /api/relationship-suggestions/{id}/reject
```

لا يحتاج `If-Match`.

## لماذا؟

Reject لا تعدل Design.

تغير فقط:

```text
Suggestion.Status
Suggestion.DecidedAt
```

لذلك لا يوجد Design Revision conflict.

## الحالات

### Already rejected

ترجع نفس Suggestion، فتكون العملية Idempotent.

### Already accepted

ترجع Conflict:

```text
This suggestion has already been accepted.
```

### Suggested

تتحول إلى Rejected.

---

# 32. إنشاء Relationship يدويًا

المستخدم يملأ `manualDraft`.

ثم:

```http
POST /api/designs/{designId}/relationships
If-Match: {revision}
```

Body:

```text
fromColumnId
toColumnId
cardinality
onDelete
```

## Frontend

- تتحقق من Draft.
- تمنع Duplicate.
- ترسل الطلب.
- تمسح Form بعد النجاح.
- تعيد Workspace.

## Backend

- تتحقق من Cardinality.
- تتحقق من On Delete.
- تجلب Design tracked.
- تتحقق Revision.
- تتحقق Source/Target.
- تمنع Duplicate.
- تنشئ `DesignRelationship`.
- `Origin = user`.
- تحدث Revision وStatus.

---

# 33. تعديل Relationship

الواجهة الحالية تسمح بتعديل:

```text
Cardinality
On Delete
```

ولا تغير Endpoints في Edit persisted relationship.

Endpoint:

```http
PATCH /api/design-relationships/{id}
If-Match: {revision}
```

## التحقق

- Relationship موجودة.
- Revision حديثة.
- Endpoints الحالية ما زالت صالحة.
- Cardinality مدعومة.
- On Delete مدعوم.
- التعديل لا ينشئ Duplicate.

بعد النجاح:

```text
Design status = Draft
ValidatedAt = null
Revision + 1
```

---

# 34. حذف Relationship

Endpoint:

```http
DELETE /api/design-relationships/{id}
If-Match: {revision}
```

الواجهة:

```text
requestDelete
→ confirmation state
→ confirmDelete
→ API
→ reload workspace
```

بعد الحذف:

- تختفي من Design.
- تختفي من ER Diagram.
- لا تدخل في SQL/Exports/Deployment.
- Design تصبح Draft وتحتاج Revalidation.

حذف Relationship مقبولة لا يعيد Suggestion تلقائيًا إلى Suggested في السلوك الحالي؛ هما سجلات منفصلة مرتبطة بـSuggestionId.

---
# 35. Design Revision

> **مفهوم جديد ومحوري**

كل `DesignModel` تحتوي:

```text
Revision
```

مثال:

```text
Revision 5
```

كل Mutation حقيقية على Design تزيدها:

```text
Create relationship → revision 6
Edit relationship   → revision 7
Delete relationship → revision 8
```

## لماذا؟

حتى لا يحفظ مستخدم أو Tab قديمة فوق تغييرات أحدث.

مثال:

```text
Tab A loaded revision 5
Tab B loaded revision 5

Tab B adds relationship
→ revision becomes 6

Tab A tries to edit using revision 5
→ rejected as stale
```

---

# 36. If-Match

الفرونت يرسل Revision في HTTP Header:

```http
If-Match: 5
```

`DesignApiService` تبنيها:

```ts
new HttpHeaders({
  'If-Match': String(revision)
})
```

## Mutations التي تحتاجها

```text
Accept suggestion
Create manual relationship
Edit relationship
Delete relationship
Validate schema
Other design mutations
```

## Reject لا تحتاجها

لأنها لا تعدل DesignModel.

## Generate fresh design

Fresh create هي الحالة الاستثنائية؛ لا توجد Revision سابقة لمقارنتها.

---

# 37. 428 و409

## 428 Precondition Required

إذا Mutation تحتاج `If-Match` ولم تُرسل.

```text
Send current revision first
```

## 400 Bad Request

إذا Header موجودة لكن ليست Integer.

## 409 Conflict

إذا Revision المرسلة قديمة:

```json
{
  "currentRevision": 6,
  "message": "..."
}
```

أو إذا العملية تنشئ Duplicate/Conflict منطقي.

## لماذا 409؟

Request نفسها مفهومة، لكن حالة السيرفر الحالية تتعارض معها.

> **سبق في Data Cleaning:** 409 استخدمت أيضًا عندما Active Version تغيرت أو العملية غير مسموحة في الحالة الحالية.

---

# 38. Optimistic Concurrency

> **مفهوم جديد، قريب من Active Version check في Data Cleaning**

Optimistic يعني النظام لا يقفل Design طوال وقت تعديل المستخدم.

بدل Lock طويل:

```text
read revision
edit locally
send revision with mutation
server compares
```

إذا لم تتغير:

```text
save
```

إذا تغيرت:

```text
409
refresh
retry
```

## طبقتان للحماية

### Explicit Revision Check

```text
design.Revision == If-Match
```

### EF Core Concurrency

إذا حدث Race بين الفحص وSave:

```text
DbUpdateConcurrencyException
```

الخدمة تمسكها وتعيد Current Revision.

---

# 39. Idempotency والتعامل مع السباق

> **مفهوم جديد**

Idempotent بشكل مبسط يعني تكرار نفس الطلب لا ينشئ نتائج مكررة أو متضاربة.

## Accept already accepted

إذا Suggestion لديها Relationship مرتبطة:

```text
returns existing accepted response
```

ولا تنشئ Relationship ثانية.

## Reject already rejected

ترجع نفس Suggestion.

## Duplicate Database constraint

إذا طلبان متزامنان حاولا إنشاء نفس Relationship:

```text
one wins
other gets unique constraint violation
```

الخدمة:

1. تمسح EF tracking.
2. تبحث هل Suggestion أصبحت Accepted بالفعل.
3. إذا نعم، ترجع النتيجة الموجودة.
4. إذا لا، ترجع Conflict واضح.

## Unique constraint

قاعدة البيانات هي خط الدفاع الأخير ضد Duplicate، حتى لو تجاوز السباق فحص الذاكرة.

---

# 40. Validation بعد تغيير العلاقات

أي تغيير على Relationship يجعل:

```text
Design.Status = Draft
Design.ValidatedAt = null
```

لأن Validation السابقة كانت على Design قديمة.

## validateDesign

يرسل:

```http
POST /api/projects/{projectId}/schema/validate
If-Match: {revision}
```

ثم الخدمة:

1. تتحقق Revision.
2. تتحقق أن Design ليست Stale مقابل cleaned versions.
3. تبني Validation Issues.
4. تجعل Status:
   - `Valid`
   - أو `Invalid`.
5. تحفظ `ValidatedAt`.

## needsValidation

في الواجهة:

```text
design.status !== Valid
```

فتظهر زر:

```text
Validate Current Design
```

---

# 41. Pending Suggestions لا تمنع الاستمرار

الصفحة توضح:

```text
Pending suggestions never block the next workflow step.
```

المستخدم لا يحتاج Accept أو Reject كل Suggestion.

يستطيع:

- قبول المهم.
- رفض الخاطئ.
- ترك البقية Pending.
- الانتقال إلى ER Diagram.

ما يؤثر فعليًا هو:

```text
Persisted DesignRelationships
```

وليس عدد Pending Suggestions.

Deployment تحتاج Design Valid، لكن لا تشترط Queue فارغة.

---

# 42. RelationshipSuggestionsController

```csharp
[ApiController]
[Authorize]
[Route("api")]
```

## GET Suggestions

```http
GET /api/projects/{projectId}/relationship-suggestions
GET ...?status=suggested
```

- تفحص ملكية Project.
- ترجع القائمة.

## POST Detect

```http
POST /api/projects/{projectId}/relationship-suggestions/detect
```

- تفحص الملكية.
- Project غير موجودة → 404.

## POST Accept

```http
POST /api/relationship-suggestions/{id}/accept
```

- تحتاج `If-Match`.
- تفحص ملكية Suggestion عبر Project.
- تعالج:
  - 403.
  - 404.
  - 409 revision.
  - 409 suggestion conflict.
  - 428 missing revision.

## POST Reject

```http
POST /api/relationship-suggestions/{id}/reject
```

- لا تحتاج Revision.
- تفحص الملكية.
- تعالج Conflicts المنطقية.

---

# 43. RelationshipDetectionService

مسؤولياتها:

```text
Get suggestions
Detect candidates
Score directions
Persist suggestions
Accept suggestion
Reject suggestion
Map responses
```

## Dependencies

```text
IDatasetRepository
IRelationshipSuggestionRepository
IDesignRepository
```

### DatasetRepository

Rows وColumns للحساب.

### SuggestionRepository

حفظ القرارات والأدلة.

### DesignRepository

قراءة Design، Transactions، وحفظ Relationship الحقيقية.

## لا تستخدم Python

Relationship detection الحالية مكتوبة بالكامل في .NET Heuristics.

> **سبق في Data Analysis:** Python كانت مسؤولة عن Column profile الأولية وبعض hints، لكن صفحة Relationships تستخدم Detection Service المستقلة الحالية.

---

# 44. RelationshipSuggestionRepository

## GetByProjectIdAsync

تجلب:

```text
Suggestions
+ SourceDataset
+ TargetDataset
```

باستخدام `Include`.

> **سبق:** `AsNoTracking` للقراءة فقط.

## Status filter

إذا `status` موجودة، تضيف `WHERE`.

## ترتيب النتائج

```text
accepted first
then score descending
```

الواجهة بعد ذلك تعرض Pending وحدها في Cards، لكنها تستعمل القائمة الكاملة لحساب Accepted/Rejected counts.

## GetByIdAsync

تجلب مع Datasets وبـTracking لأنها قد تُعدّل في Accept/Reject.

## FindByKeyAsync

تبحث بالمفتاح المنطقي الكامل.

## Add

تضيف Entity إلى DbContext بلا Save فوري.

## SaveChangesAsync

يحفظ جميع التعديلات.

---

# 45. DesignController وDesignService

## DesignController

توفر CRUD للعلاقات الحقيقية:

```text
POST   /api/designs/{designId}/relationships
PATCH  /api/design-relationships/{id}
DELETE /api/design-relationships/{id}
```

كلها تمر عبر `WithIfMatch`.

## DesignService CreateRelationshipAsync

1. تتحقق Cardinality.
2. تتحقق On Delete.
3. تجلب Design tracked.
4. تتحقق Revision.
5. تجد Source وTarget Columns داخل نفس Design.
6. تتحقق Endpoints.
7. تمنع Duplicate.
8. تضيف Relationship بـOrigin User.
9. تحفظ وتزيد Revision.

## UpdateRelationshipAsync

تغير:

```text
cardinality
onDelete
```

## DeleteRelationshipAsync

تحذف العلاقة من Collection ثم تحفظ.

## SaveAndBuildResponseAsync

لكل Mutation:

```text
status = Draft
validatedAt = null
revision += 1
updatedAt = now
SaveChanges
Build response
```

إلا إذا طُلب الحفاظ على Validation Status في مسار Validation نفسه.

---

# 46. Entities وDTOs

## RelationshipSuggestion Entity

```text
Id
ProjectId
SourceDatasetId
SourceColumnName
TargetDatasetId
TargetColumnName
Score
EvidenceJson
Status
DecidedAt
CreatedAt
Project
SourceDataset
TargetDataset
DesignRelationships
```

## DesignRelationship Entity

```text
Id
DesignModelId
FromColumnId
ToColumnId
Cardinality
OnDelete
Origin
SuggestionId optional
DesignModel
FromColumn
ToColumn
Suggestion
```

## Origin

قد تكون:

```text
accepted suggestion
user/manual
generated حسب النظام
```

Origin تساعد في معرفة مصدر العنصر وفي سياسات Regeneration.

## AcceptSuggestionRequest

```text
fromColumnId
toColumnId
cardinality
onDelete
```

## AcceptSuggestionResponse

```text
suggestion
relationship
designRevision
```

## RelationshipSuggestion Response

تضيف أسماء Tables من Navigation properties، حتى لا تحتاج الواجهة Request إضافية لمجرد العرض.

---

# 47. تأثير العلاقات على المخرجات

Persisted Relationships تدخل في:

## ER Diagram

ترسم الخطوط بين Tables.

## SQL

تولد Foreign Key constraints و`ON DELETE`.

مثال منطقي:

```sql
FOREIGN KEY (customer_id)
REFERENCES customers(id)
ON DELETE NO ACTION;
```

## DBML

تولد `Ref` بين الأعمدة.

## JSON Schema / Design Export

تظهر في Model العلاقات.

## Deployment

DDL المنفذة في PostgreSQL تشمل Constraints الناتجة.

## Validation

تفحص:

```text
target key
type compatibility
duplicate relationships
valid cardinality
valid delete action
stale source versions
```

---

# 48. المسارات الكاملة

## فتح الصفحة

```text
/projects/5/relationships
→ read projectId
→ forkJoin:
   GET suggestions
   GET design
→ design absent:
   show generate schema message
→ design exists:
   show queue + persisted relationships
```

## Detection

```text
click Detect
→ POST detect
→ load datasets with rows/columns
→ profile every column
→ compare cross-dataset column pairs
→ score both directions
→ choose best candidates
→ upsert suggestions
→ preserve accepted/rejected decisions
→ reload workspace
```

## Accept مباشرة

```text
suggestion
→ map dataset/column names to design column IDs
→ frontend validation
→ POST accept + If-Match revision
→ backend ownership
→ transaction
→ verify revision
→ validate endpoints
→ suggestion accepted
→ relationship persisted
→ revision bumped
→ design Draft
→ reload workspace
```

## Accept بعد Edit

نفس المسار، لكن IDs/Cardinality/OnDelete تأتي من Draft المعدلة.

## Reject

```text
POST reject
→ ownership
→ status = rejected
→ decidedAt
→ no design mutation
→ no revision bump
→ reload
```

## Manual Create

```text
fill draft
→ validate
→ POST design relationship + If-Match
→ create Origin=user
→ revision bump
→ Draft
→ reload
```

## Edit

```text
change cardinality/onDelete
→ PATCH + If-Match
→ duplicate/endpoints validation
→ revision bump
→ Draft
```

## Delete

```text
confirm
→ DELETE + If-Match
→ remove relationship
→ revision bump
→ Draft
```

## Revalidate

```text
POST schema/validate + If-Match
→ validate current design
→ Valid or Invalid
→ reload workspace
```

---

# 49. الحالات والأخطاء

## Suggestion Status

```text
suggested
accepted
rejected
```

## Design Status

```text
Draft
Valid
Invalid
```

## HTTP Codes

| Code | المعنى |
|---:|---|
| 200 | عملية ناجحة |
| 400 | Header/Request/Cardinality/OnDelete غير صالحة |
| 401 | Token غير صالحة |
| 403 | Project/Suggestion/Design ليست للمستخدم |
| 404 | Project/Suggestion/Design/Relationship غير موجودة |
| 409 | Revision قديمة أو Duplicate/Decision conflict |
| 428 | Mutation تحتاج If-Match ولم تُرسل |

## أخطاء شائعة

```text
Generate a persisted schema first
Target is not PK/Unique
Types mismatch
Same source and target endpoint
Duplicate relationship
Suggestion already rejected
Suggestion already accepted
Stale design revision
Current cleaned versions no longer match schema
```

## Frontend recovery

عند Mutation failure:

```text
reload latest workspace
then show error
```

حتى لا تبقى الشاشة على Revision قديمة.

---

# 50. الاختبار العملي

## Workspace

- Project ID غير صالح.
- Design غير موجودة.
- Design موجودة بلا Relationships.
- Suggestions فارغة.
- Suggestions pending/accepted/rejected.
- Refresh.
- Design 404 مقابل خطأ آخر.

## Detection

- أعمدة Names متطابقة.
- `customer_id → customers.id`.
- Target غير Unique.
- Source repeated.
- Value overlap 0%.
- Overlap 25%.
- Confidence أقل من 55%.
- اتجاهان صالحان.
- Design target key تفضّل الاتجاه.
- Dataset نفسها لا تقارن بنفسها.
- Invalid Row JSON.
- Rerun Detection.
- Rejected suggestion لا ترجع Pending.
- Accepted suggestion لا تتغير.

## Accept

- Accept مباشر صالح.
- Suggestion لا تطابق Design columns.
- Edit قبل Accept.
- Target ليست PK/Unique.
- Types mismatch.
- Same endpoint.
- One-to-one.
- Many-to-one.
- No action.
- Cascade.
- Set null.
- Already rejected.
- Already accepted.
- Existing identical relationship.
- Duplicate concurrent request.

## Reject

- Suggested → rejected.
- Already rejected.
- Accepted → conflict.
- لا Revision header.

## Manual CRUD

- Create valid.
- Missing fields.
- Duplicate.
- Edit cardinality.
- Edit On Delete.
- Delete.
- Project آخر.
- Relationship غير موجودة.

## Revision

- Missing If-Match → 428.
- Invalid Header → 400.
- Current Revision → success.
- Stale Revision → 409.
- Two tabs race.
- UI reloads after conflict.

## Validation and outputs

- Relationship mutation returns Draft.
- Validate returns Valid.
- Invalid Set Null on non-nullable source.
- ER Diagram includes persisted only.
- SQL includes FK.
- Deleted relationship disappears.
- Pending suggestions do not block ER Diagram.

---

# 51. ملخص الحفظ السريع

## الفرق الرئيسي

```text
Suggestion = recommendation
DesignRelationship = real persisted database relationship
```

## Detection

```text
profile columns
→ compare datasets
→ score both directions
→ require unique target
→ name/value/key/shape evidence
→ confidence ≥ 55%
→ persist suggestion
```

## Acceptance

```text
map suggestion to design columns
→ validate target/type/cardinality/onDelete
→ transaction
→ mark accepted
→ create relationship
→ revision bump
→ design Draft
```

## Concurrency

```text
Design Revision
+ If-Match
+ EF concurrency
+ database unique constraint
```

## Relationship validity

```text
different endpoints
target PK or Unique
compatible PostgreSQL types
many-to-one or one-to-one
no-action / cascade / set-null
no duplicate
```

## مفاهيم جديدة

```text
Suggestion vs persisted relationship
heuristic confidence score
evidence JSON
relationship direction
foreign key target
cardinality
On Delete behavior
Design revision
If-Match
428 Precondition Required
optimistic concurrency
idempotent accept/reject
atomic suggestion acceptance
```

## مفاهيم سبقت

```text
Signals and computed
forkJoin
switchMap
finalize
DTO vs Entity
Repository
Transactions
JWT ownership
Query and route state
Database uniqueness
schema readiness from cleaned versions
```

---

# 52. تحسينات مؤجلة لما بعد الفهم

> للتسجيل فقط، ولا تنفذ قبل انتهاء القراءة والاختبار.

1. حذف أو Archive الـpending suggestions التي لم تعد Candidates بعد Detection جديدة.
2. زر لإعادة فتح Rejected Suggestion بقرار صريح.
3. توضيح سبب عدم صلاحية Suggestion مباشرة داخل Card بشكل أكثر تفصيلًا.
4. دعم Many-to-many بإنشاء Junction Table.
5. فحص Source uniqueness الفعلي عند اختيار One-to-one.
6. فحص Source nullable قبل السماح بـSet null مباشرة في Draft validator.
7. Type compatibility أوسع لبعض الأنواع المتوافقة مثل INTEGER/BIGINT بسياسة واضحة.
8. Sampling أو Database-side overlap للـDatasets الكبيرة بدل تحميل كل Rows.
9. تحسين Scoring باستخدام Analysis profiles وNull ratio وcardinality.
10. حفظ نسخة Algorithm version داخل Evidence.
11. Bulk accept/reject للSuggestions.
12. Filter/Sort Suggestions حسب confidence/status/table.
13. شرح بصري للـconfidence weights في UI.
14. عدم السماح بالانتقال إلى Deployment قبل Validation من صفحة Relationships نفسها.
15. ربط حذف accepted relationship بخيار إعادة Suggestion إلى pending.
16. Audit log مستقل لقرارات Accept/Reject ومن اتخذها.
17. استخدام ETag قياسي بدل Integer If-Match الخام، أو توثيق العقد الحالي رسميًا.
18. تحسين recoverFromMutationError لمعالجة 409 برسالة Revision متخصصة.
19. Detection داخل Background Job للـProjects الكبيرة.
20. Integration tests تغطي Transaction قبول Suggestion مع DesignRelationship.

---

# نهاية الجلسة

بعد قراءة الملف، المفروض تقدر تشرح:

1. الفرق بين RelationshipSuggestion وDesignRelationship.
2. لماذا يلزم وجود Design قبل Accept.
3. كيف تبني الخدمة Column Profiles.
4. كيف تختار Source وTarget.
5. ما الأدلة التي تدخل في Confidence.
6. لماذا Target يجب أن تكون Unique ثم PK/Unique في Design.
7. كيف تحفظ Detection القرارات السابقة.
8. كيف تعمل Edit Before Accept.
9. الفرق بين Many-to-one وOne-to-one.
10. الفرق بين No action وCascade وSet null.
11. لماذا Accept تحتاج If-Match وReject لا تحتاجها.
12. كيف تمنع Revision القديمة الكتابة فوق الجديدة.
13. كيف تحفظ Suggestion وRelationship بشكل Atomic.
14. كيف تتعامل الخدمة مع التكرار والطلبات المتزامنة.
15. لماذا كل Relationship mutation تعيد Design إلى Draft.
16. كيف تؤثر Relationships على ER Diagram وSQL والتصدير والنشر.
