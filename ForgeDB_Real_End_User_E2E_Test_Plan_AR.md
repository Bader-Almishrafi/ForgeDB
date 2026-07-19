# ForgeDB — خطة اختبار End User حقيقية من البداية إلى deploy.sql

> تاريخ الاختبار المقترح: الأحد 19 يوليو 2026  
> الفرع: `feature/final-ui-integration`  
> نوع الاختبار: End-to-End يدوي كمستخدم نهائي  
> عدد السيناريوهات: 3 مشاريع مستقلة  
> المصادر: CSV حقيقي، Excel حقيقي، API عامة حقيقية

---

# 1. الهدف

سننشئ مستخدمًا جديدًا واحدًا، ثم ثلاثة مشاريع مستقلة:

1. `E2E CSV - Titanic`
2. `E2E XLSX - Raisin`
3. `E2E API - US Holidays`

كل مشروع يجب أن يمر بهذا المسار:

```text
Register / Login
→ Create Project
→ Data Sources
→ Preview
→ Analysis
→ Dashboard
→ Data Cleaning
→ Re-analysis
→ Confirm Quality
→ Schema Designer
→ Relationships
→ Exports
→ Deployment
→ Download deploy.sql
→ Run deploy.sql in pgAdmin
→ Verify PostgreSQL
```

اختبار كل مصدر في مشروع مستقل أفضل؛ لأن أي فشل سيكون واضحًا ولن يختلط بمصدر آخر.

---

# 2. تجهيز النظام قبل الاختبار

## 2.1 افتح الفرع الصحيح

```bash
cd /d/forgedb/ForgeDB
git checkout feature/final-ui-integration
git pull
git status
```

المتوقع:

```text
On branch feature/final-ui-integration
working tree clean
```

## 2.2 شغّل PostgreSQL

```bash
docker compose up -d
docker ps
```

المتوقع:

```text
forgedb-postgres
Up
Port 5433
```

## 2.3 شغّل Python Analysis Service

من مجلد المشروع:

```bash
cd python-analysis-service
```

فعّل البيئة الافتراضية الموجودة عندك، ثم:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8002
```

افتح:

```text
http://127.0.0.1:8002/health
```

المتوقع:

```text
Healthy / OK
```

## 2.4 شغّل Backend

Terminal جديد:

```bash
cd /d/forgedb/ForgeDB
dotnet run --project backend/ForgeDB.API/ForgeDB.API.csproj
```

افتح:

```text
http://127.0.0.1:5000/health
```

المتوقع:

```json
{
  "status": "healthy",
  "service": "ForgeDB API",
  "database": "connected"
}
```

## 2.5 شغّل Angular

Terminal جديد:

```bash
cd /d/forgedb/ForgeDB/frontend/angular-app
npm start
```

افتح:

```text
http://localhost:4200
```

## 2.6 افتح أدوات المتصفح

في Chrome:

```text
F12
→ Console
→ Network
```

أثناء الاختبار راقب:

- لا توجد Console errors غير متوقعة.
- لا توجد Requests عالقة بلا نهاية.
- لا توجد Responses غير متوقعة 500.
- لا يوجد Loader يبقى للأبد.

---

# 3. المصادر الحقيقية

## 3.1 CSV — Titanic

المصدر الأصلي المستخدم في Seaborn، ومصدره موضح بأنه مأخوذ من مسابقة Titanic في Kaggle.

رابط CSV المباشر:

```text
https://raw.githubusercontent.com/mwaskom/seaborn-data/master/titanic.csv
```

نزّل الملف من المتصفح باسم:

```text
titanic.csv
```

البيانات المعروفة:

```text
891 rows
15 columns
869 missing cells
107 exact duplicate rows
```

الـmissing موزعة تقريبًا:

```text
age          177
embarked       2
deck         688
embark_town    2
```

---

## 3.2 Excel — UCI Raisin Dataset

المصدر الرسمي:

```text
https://archive.ics.uci.edu/dataset/850/raisin
```

رابط ZIP المباشر:

```text
https://archive.ics.uci.edu/static/public/850/raisin.zip
```

الخطوات:

1. نزّل `raisin.zip`.
2. فك الضغط.
3. استخدم الملف:
   `Raisin_Dataset.xlsx`

البيانات الرسمية:

```text
900 rows
8 columns
No missing values according to UCI
```

الأعمدة:

```text
Area
MajorAxisLength
MinorAxisLength
Eccentricity
ConvexArea
Extent
Perimeter
Class
```

القيم في `Class`:

```text
Kecimen
Besni
```

---

## 3.3 API — Nager.Date Public Holidays

API عامة بدون تسجيل دخول أو API key.

استخدم:

```text
https://date.nager.at/api/v3/PublicHolidays/2026/US
```

في ForgeDB:

```text
API URL:
https://date.nager.at/api/v3/PublicHolidays/2026/US

Array Path:
اتركه فارغًا
```

الاستجابة Root JSON Array، لذلك لا تحتاج Array Path.

الأعمدة المتوقعة:

```text
date
localName
name
countryCode
fixed
global
counties
launchYear
types
```

ملاحظة:

```text
counties
types
```

قد تظهر داخل ForgeDB كنص JSON مثل:

```text
["Public"]
```

وهذا متوقع في التنفيذ الحالي؛ لأن قيم Array/Object داخل Record تتحول إلى JSON text.

عدد الصفوف قد يتغير إذا حدث مصدر العطلات، لذلك لا تعتمد رقمًا ثابتًا. سجّل العدد الذي ظهر في Preview، ويجب أن يبقى نفسه في Analysis وDeployment ما لم تحذف Rows أثناء Cleaning.

---

# 4. إنشاء المستخدم

نفذ مرة واحدة فقط قبل المشاريع الثلاثة.

## صفحة Register

أنشئ حساب اختبار جديد:

```text
Name: End User Tester
Email: enduser.test.20260719@example.com
Password: استخدم كلمة مرور تحقق شروط النظام
```

المتوقع:

- التسجيل ينجح.
- يتم تسجيل الدخول أو الانتقال إلى Login حسب السلوك الحالي.
- لا يظهر Password في أي Response.
- Session تبقى بعد Refresh.

## اختبار سلبي سريع

حاول التسجيل بنفس البريد مرة ثانية.

المتوقع:

```text
رسالة واضحة أن البريد مستخدم
لا يوجد 500
```

---

# 5. Test Story 1 — CSV Titanic

# TS-CSV-01: إنشاء المشروع

من Home:

```text
Create New Project
```

اكتب:

```text
Name:
E2E CSV - Titanic

Description:
End-user test using the real Seaborn/Kaggle Titanic CSV dataset.
```

المتوقع في Home/Projects:

- Project تظهر كبطاقة.
- الاسم والوصف والتاريخ صحيح.
- بعد Refresh تبقى موجودة.
- Open يدخل إلى Project Overview.

---

# TS-CSV-02: Project Overview

المتوقع:

- اسم المشروع صحيح.
- الحالة تشير أن Data Source مطلوبة.
- أزرار الرجوع والتنقل تعمل.
- لا تظهر بيانات مشروع آخر.
- Data Sources متاحة.
- المراحل اللاحقة قد تظهر مقفلة أو تشرح المتطلبات.

PASS إذا الصفحة لا تعرض Loader دائم أو 404/500.

---

# TS-CSV-03: رفع CSV

اذهب:

```text
Data Sources
→ Upload / Import
→ CSV
```

اختر:

```text
titanic.csv
```

اسم Dataset/Table:

```text
titanic_passengers
```

## المتوقع قبل Import

Preview تعرض:

```text
15 columns
أول صفوف من البيانات
```

يجب أن ترى أعمدة مثل:

```text
survived
pclass
sex
age
fare
embarked
deck
alive
```

## المتوقع بعد Import

```text
Rows: 891
Columns: 15
```

افتح Preview وتأكد:

- توجد قيم فارغة في `age`.
- توجد قيم فارغة كثيرة في `deck`.
- `survived` أرقام 0/1.
- `adult_male` و`alone` قيم Boolean.
- `fare` أرقام عشرية.

## اختبار Data Sources

- Search باسم `titanic`.
- افتح Preview.
- افتح Quality.
- Refresh الصفحة.
- تأكد Dataset بقيت.
- لا تستخدم Replace/Delete في هذا السيناريو إلا إذا أردت اختبارًا إضافيًا.

FAIL إذا:

- الصفوف أقل أو أكثر من 891 قبل Cleaning.
- Headers تغيرت أو اختفت.
- Import أعادت 500.
- البيانات الفارغة تحولت إلى نص `"null"` أو `"undefined"` بدل Missing.

---

# TS-CSV-04: Analysis

اذهب:

```text
Analysis
```

اختر Dataset ثم شغّل Analysis.

## المتوقع

```text
Rows: 891
Columns: 15
Missing values total: 869 تقريبًا
Duplicate rows: 107 تقريبًا
```

تفاصيل مهمة:

```text
age missing: 177
deck missing: 688
embarked missing: 2
embark_town missing: 2
```

الأنواع المتوقعة تقريبًا:

```text
survived      integer
pclass        integer
age           decimal
sibsp         integer
parch         integer
fare          decimal
adult_male    boolean
alone         boolean
البقية        string/text
```

## Tabs

### Overview

يعرض Metrics بدون أرقام سالبة أو NaN.

### Columns

افتح `age` و`fare` و`deck`.

المتوقع:

- `age` تعرض Numeric profile وMissing.
- `fare` تعرض Min/Max/Average.
- `deck` تعرض Text profile وMissing كبير.

### Quality / Issues

المتوقع:

- Missing issues.
- Duplicate issue.
- قد تظهر Outlier suggestions خصوصًا في `fare`.

### Visualizations

المتوقع:

- Charts تظهر ولا تتجاوز الصفحة.
- لا يوجد Blank chart أو Console error.

---

# TS-CSV-05: Dashboard

افتح Dashboard الخاصة بـTitanic.

المتوقع:

- 891 Rows قبل Cleaning.
- 15 Columns.
- Missing وDuplicate metrics تطابق Analysis.
- Numeric summaries لـ`age` و`fare`.
- Top values مثل:
  - male/female
  - First/Second/Third
  - yes/no
- Charts تظهر بعد Refresh أيضًا.

---

# TS-CSV-06: Data Cleaning

اذهب:

```text
Data Cleaning
```

نفذ العمليات التالية بالتدريج، ولا تستخدم Fix All مرة واحدة في أول تجربة.

## العملية 1 — age

```text
Issue: Missing Values
Column: age
Strategy: Median
```

افتح Preview.

المتوقع:

- Before فارغ.
- After رقم قريب من 28.
- Preview لا تغير البيانات قبل Apply.

ثم Apply.

## العملية 2 — embarked

```text
Issue: Missing Values
Column: embarked
Strategy: Mode
```

المتوقع غالبًا:

```text
After = S
```

## العملية 3 — embark_town

```text
Issue: Missing Values
Column: embark_town
Strategy: Mode
```

المتوقع غالبًا:

```text
After = Southampton
```

## العملية 4 — deck

```text
Issue: Missing Values
Column: deck
Strategy: Custom
Value: Unknown
```

استخدم `Unknown` لأن حذف 688 Rows سيخسر أغلب البيانات.

## العملية 5 — Duplicate Rows

```text
Strategy: Keep First
```

هذه Destructive.

المتوقع:

- النظام يطلب Confirmation.
- عدد Rows المتأثرة يقارب 107.
- بعد Apply يصبح Row count:
  `784`

## History وVersions

تحقق:

- Raw Version موجودة.
- كل Apply أنشأت Version جديدة.
- History تعرض العمليات.
- جرّب Undo لآخر Remove Duplicates.
- تأكد Rows ترجع إلى 891.
- أعد تطبيق Remove Duplicates.
- النتيجة النهائية 784.

## النتيجة النهائية قبل Re-analysis

```text
Rows: 784
Missing: 0
Duplicates: 0
```

قد تبقى Outlier suggestions. لا تحذف Fare outliers في هذا الاختبار؛ اختر Leave/Keep أو اتركها للمراجعة.

---

# TS-CSV-07: Re-analysis وConfirm Quality

اضغط:

```text
Re-run Analysis
```

المتوقع:

```text
Rows: 784
Columns: 15
Missing: 0
Duplicates: 0
```

ثم:

```text
Confirm Data Quality
```

المتوقع:

- Quality Confirmed.
- Schema Ready = true.
- زر Schema Designer يصبح متاحًا.

FAIL إذا كانت Metrics القديمة 891/869/107 بعد Re-analysis.

---

# TS-CSV-08: Schema Designer

اضغط Generate Schema.

اسم Table:

```text
titanic_passengers
```

## الأنواع المقترحة

```text
survived       INTEGER NOT NULL
pclass         INTEGER NOT NULL
sex            VARCHAR(10) NOT NULL
age            NUMERIC NOT NULL
sibsp          INTEGER NOT NULL
parch          INTEGER NOT NULL
fare           NUMERIC NOT NULL
embarked       VARCHAR(5) NOT NULL
class          VARCHAR(20) NOT NULL
who            VARCHAR(20) NOT NULL
adult_male     BOOLEAN NOT NULL
deck           VARCHAR(20) NOT NULL
embark_town    VARCHAR(30) NOT NULL
alive          VARCHAR(5) NOT NULL
alone          BOOLEAN NOT NULL
```

## Primary Key

لا يوجد ID حقيقي في نسخة Seaborn هذه.

اترك Table بلا Primary Key في هذا الاختبار.

المتوقع:

```text
Warning: table has no primary key
```

لكن يجب ألا يكون Error يمنع Validation.

## اختبارات الصفحة

1. غيّر نوع `sex` إلى `VARCHAR(10)`.
2. غيّر نوع `deck` إلى `VARCHAR(20)`.
3. اضغط Save Draft.
4. Refresh.
5. تأكد القيم بقيت.
6. Verify Backend SQL.
7. Validate Schema.

المتوقع:

```text
Status = Valid
Warnings may remain
No blocking errors
```

---

# TS-CSV-09: Relationships

لأن المشروع يحتوي Table واحدة فقط:

المتوقع:

```text
Detected suggestions: 0
Persisted relationships: 0
```

شغّل Detect Relationships.

المتوقع:

- لا يحدث 500.
- لا تتولد علاقة داخل الجدول نفسه.
- Design تبقى سليمة.
- Pending suggestions لا تمنع الانتقال.

انتقل إلى Exports.

---

# TS-CSV-10: Exports

المتوقع 5 Artifacts:

```text
schema.sql
schema.dbml
schema.json
relationship-report.json
data-quality-report.json
```

تحقق:

- SQL تحتوي `CREATE TABLE titanic_passengers`.
- لا تحتوي Foreign Key.
- Quality report تعرض 784 Row و0 Missing و0 Duplicate.
- Copy يعمل.
- Download لكل ملف يعمل.
- الملفات ليست فارغة.

---

# TS-CSV-11: Deployment

افتح Deployment.

المتوقع قبل النشر:

```text
Tables: 1
Relationships: 0
Validation errors: 0
Design status: Valid
```

اضغط Deploy ثم Confirm.

المتوقع:

```text
Status: Completed
Tables created: 1
Rows seeded: 784
Relationships created: 0
Failed rows: 0
```

نزّل:

```text
deploy.sql
```

سجل Schema name:

```text
forgedb_project_<CSV_PROJECT_ID>
```

---

# TS-CSV-12: تشغيل deploy.sql في pgAdmin

1. افتح pgAdmin.
2. اختر Database:
   `forgedb`
3. افتح Query Tool.
4. افتح `deploy.sql`.
5. Execute.

المتوقع:

```text
Query returned successfully
No SQL error
```

تحقق:

```sql
SELECT COUNT(*)
FROM forgedb_project_CSV_PROJECT_ID.titanic_passengers;
```

المتوقع:

```text
784
```

تحقق Missing:

```sql
SELECT
  COUNT(*) FILTER (WHERE age IS NULL) AS missing_age,
  COUNT(*) FILTER (WHERE deck IS NULL) AS missing_deck,
  COUNT(*) FILTER (WHERE embarked IS NULL) AS missing_embarked,
  COUNT(*) FILTER (WHERE embark_town IS NULL) AS missing_town
FROM forgedb_project_CSV_PROJECT_ID.titanic_passengers;
```

المتوقع:

```text
0 | 0 | 0 | 0
```

---

# 6. Test Story 2 — Excel Raisin

# TS-XLSX-01: إنشاء المشروع

أنشئ:

```text
Name:
E2E XLSX - Raisin

Description:
End-user test using the real UCI Raisin Excel dataset.
```

المتوقع:

- يظهر في Home.
- يفتح بعد Refresh.
- Project مستقلة عن Titanic.

---

# TS-XLSX-02: استيراد Excel

اذهب:

```text
Data Sources
→ Excel
```

اختر:

```text
Raisin_Dataset.xlsx
```

المتوقع:

- تظهر Sheet واحدة أو Sheet البيانات الأساسية.
- Preview تعرض Columns الثمانية.
- اختر Sheet التي تحتوي:
  `Area`, `MajorAxisLength`, `Class`.

اسم Dataset:

```text
raisin_measurements
```

## المتوقع بعد Import

```text
Rows: 900
Columns: 8
```

تحقق:

- أول Row يبدأ `Area` قريبًا من 87524.
- Class فيها `Kecimen` أو `Besni`.
- لا توجد Headers فارغة.
- لا توجد Columns إضافية وهمية.

FAIL إذا:

- Row count 899 بسبب اعتبار أول صف Data وليس Header.
- Row count 901 بسبب احتساب Header كصف.
- Columns أقل من 8.
- Sheet list لا تظهر.

---

# TS-XLSX-03: Analysis

شغل Analysis.

المتوقع:

```text
Rows: 900
Columns: 8
Missing: 0
```

الأنواع:

```text
Area              integer
ConvexArea        integer
MajorAxisLength   decimal
MinorAxisLength   decimal
Eccentricity      decimal
Extent            decimal
Perimeter         decimal
Class             string
```

Top values لـClass:

```text
Kecimen ≈ 450
Besni   ≈ 450
```

Duplicate count:

- سجّل القيمة الظاهرة.
- المتوقع عادة عدم وجود مشكلة كبيرة.
- إذا ظهرت Duplicates، راجع Preview قبل حذفها.

Charts:

- Numerical distributions تظهر.
- Class categorical chart تظهر.
- لا يوجد Freeze مع 900 Row.

---

# TS-XLSX-04: Dashboard

المتوقع:

```text
900 rows
8 columns
0 missing
```

تحقق من:

- Numeric summaries.
- Top values لـClass.
- Chart recommendations.
- Refresh لا يفقد Dataset context.

---

# TS-XLSX-05: Data Cleaning

هذه Dataset موثقة بلا Missing Values.

المتوقع أحد المسارين:

## المسار A — لا توجد Suggestions

```text
No cleaning issues
```

بعد Analysis يجب أن يسمح النظام بتأكيد الجودة بدون تعديل وهمي.

هذا هو السلوك الصحيح.

## المسار B — تظهر Outlier Suggestions

افتح Suggestion واحدة فقط في Numeric Column:

```text
Preview
→ لا تطبق حذف Rows
```

يمكنك اختيار:

```text
Keep unchanged
```

أو تركها للمراجعة.

لا تغيّر Dataset لمجرد وجود قيمة كبيرة؛ القياسات العلمية قد تكون صحيحة.

## اختبار مهم

إذا الصفحة لا تحتوي Issues:

- Confirm Quality يجب أن يصبح ممكنًا بعد Analysis.
- لا يجب أن يجبرك النظام على Cleaning غير ضرورية.

سجل Defect إذا:

```text
Clean dataset + analyzed
ولكن Confirm Quality disabled بلا سبب
```

---

# TS-XLSX-06: Confirm Quality

المتوقع:

```text
Rows: 900
Missing: 0
Schema Ready: true
```

إذا طبقت Cleaning، شغل Re-analysis أولًا.

---

# TS-XLSX-07: Schema Designer

اسم Table:

```text
raisin_measurements
```

الأنواع:

```text
Area              INTEGER NOT NULL
MajorAxisLength   NUMERIC NOT NULL
MinorAxisLength   NUMERIC NOT NULL
Eccentricity      NUMERIC NOT NULL
ConvexArea        INTEGER NOT NULL
Extent            NUMERIC NOT NULL
Perimeter         NUMERIC NOT NULL
Class             VARCHAR(20) NOT NULL
```

لا تضع `Area` كـPK بدون إثبات أنها Unique.

اترك Table بدون PK.

المتوقع:

```text
Warning only: no primary key
Status after validation: Valid
```

نفذ:

- Save Draft.
- Refresh.
- Verify Backend SQL.
- Validate.

---

# TS-XLSX-08: Relationships

Table واحدة.

المتوقع:

```text
Suggestions: 0
Relationships: 0
```

Detect يجب أن يكمل بدون Error.

---

# TS-XLSX-09: Exports

تحقق:

```text
5 artifacts
schema.sql has raisin_measurements
quality report has 900 rows
relationship report empty or []
```

---

# TS-XLSX-10: Deployment

المتوقع:

```text
Status: Completed
Tables created: 1
Rows seeded: 900
Relationships: 0
Failed rows: 0
```

نزّل `deploy.sql`.

Schema:

```text
forgedb_project_<XLSX_PROJECT_ID>
```

---

# TS-XLSX-11: pgAdmin Verification

شغل `deploy.sql` ثم:

```sql
SELECT COUNT(*)
FROM forgedb_project_XLSX_PROJECT_ID.raisin_measurements;
```

المتوقع:

```text
900
```

تحقق من Classes:

```sql
SELECT "Class", COUNT(*)
FROM forgedb_project_XLSX_PROJECT_ID.raisin_measurements
GROUP BY "Class"
ORDER BY "Class";
```

إذا الأسماء Normalized إلى lowercase استخدم:

```sql
SELECT class, COUNT(*)
FROM forgedb_project_XLSX_PROJECT_ID.raisin_measurements
GROUP BY class
ORDER BY class;
```

المتوقع:

```text
Besni   450
Kecimen 450
```

---

# 7. Test Story 3 — API Nager.Date

# TS-API-01: فحص API خارج ForgeDB

قبل الاختبار الصق الرابط في Chrome:

```text
https://date.nager.at/api/v3/PublicHolidays/2026/US
```

المتوقع:

- HTTP 200.
- JSON يبدأ بـ`[`.
- ترى Records تحتوي `date` و`name`.
- لا يطلب Login أو API key.

إذا الرابط لا يعمل في المتصفح، لا تبدأ ForgeDB وسجل أن External dependency غير متاحة.

---

# TS-API-02: إنشاء المشروع

أنشئ:

```text
Name:
E2E API - US Holidays

Description:
End-user test using the public Nager.Date holidays API.
```

---

# TS-API-03: API Test Connection وPreview

اذهب:

```text
Data Sources
→ API
```

أدخل:

```text
URL:
https://date.nager.at/api/v3/PublicHolidays/2026/US

Array Path:
فارغ
```

اضغط:

```text
Test Connection
```

المتوقع:

- Success.
- HTTP 200.
- Content Type JSON.
- Preview records تظهر.
- Final URL نفس Domain.
- لا يظهر SSRF error.

اسم Dataset:

```text
us_public_holidays_2026
```

## المتوقع في Preview

Columns:

```text
date
localName
name
countryCode
fixed
global
counties
launchYear
types
```

Values:

```text
countryCode = US
fixed/global = true/false
date = YYYY-MM-DD
```

`counties` أو `types` قد تظهر JSON text.

## عدد الصفوف

سجّل الرقم الظاهر:

```text
API_RAW_ROW_COUNT = ______
```

لا تعتمد رقمًا محفوظًا؛ المهم أن يكون:

```text
> 0
```

وأن يبقى متسقًا خلال المسار.

---

# TS-API-04: Import

اضغط Import.

المتوقع:

```text
Rows = API_RAW_ROW_COUNT
Columns ≈ 9
Source Type = API/JSON
```

Refresh ثم افتح Preview.

المتوقع أن البيانات تبقى حتى لو API تغيرت بعد الاستيراد؛ لأن ForgeDB تحفظ Snapshot المستوردة.

---

# TS-API-05: اختبارات API سلبية

نفذها قبل إكمال المشروع أو في Project اختبار منفصلة.

## URL غير موجود

```text
https://date.nager.at/api/v3/PublicHolidays/2026/ZZ
```

قد تعيد Empty/Bad Request حسب الخدمة.

المتوقع من ForgeDB:

- رسالة واضحة.
- لا تنشئ Dataset فارغة.
- لا يوجد 500.

## Array Path خطأ

استخدم الرابط الصحيح مع:

```text
Array Path:
data.items
```

المتوقع:

```text
Array path not found
HTTP 422 من ForgeDB
لا يتم Import
```

## Unsafe URL

```text
http://169.254.169.254/latest/meta-data
```

المتوقع:

```text
Blocked/unsafe address
لا يحاول عرض محتوى
لا يوجد 500
```

ثم ارجع للرابط الصحيح.

---

# TS-API-06: Analysis

شغل Analysis.

المتوقع:

```text
Rows = API_RAW_ROW_COUNT
Columns ≈ 9
Duplicates غالبًا 0
```

Types:

```text
date          date/datetime أو string
localName     string
name          string
countryCode   string
fixed         boolean
global        boolean
counties      string أو missing
launchYear    integer أو missing
types         string
```

## Missing

من المتوقع وجود Missing في:

```text
counties
launchYear
```

لأن بعض Holidays عامة ولا ترتبط بولاية، و`launchYear` قد تكون null.

سجل:

```text
API_MISSING_COUNT = ______
```

---

# TS-API-07: Dashboard

المتوقع:

- Row count يساوي API_RAW_ROW_COUNT.
- Top values:
  `US`
- Boolean distribution لـ`fixed` و`global`.
- Date أو text profile.
- Charts لا تكسر بسبب JSON text في `types`.

---

# TS-API-08: Data Cleaning

نفذ فقط ما يظهر فعليًا.

## counties

إذا Missing Values موجودة:

```text
Strategy: Custom
Value: []
```

هذا يعني لا توجد Subdivisions محددة.

## launchYear

إذا Missing:

```text
Strategy: Custom
Value: 0
```

أو اتركها Null إذا تريد اختبار Nullable schema.

الأفضل في هذا السيناريو:

```text
اترك launchYear Null
```

حتى نختبر Nullable INTEGER في Deployment.

طبق عملية `counties` فقط إذا ظهرت.

## النتيجة

- Row count لا يتغير.
- Missing قد يبقى في launchYear.
- هذا ليس Error إذا Schema تسمح Nullable.

شغل Re-analysis بعد أي Apply.

Confirm Quality.

---

# TS-API-09: Schema Designer

اسم Table:

```text
us_public_holidays_2026
```

الأنواع:

```text
date          DATE NOT NULL
localName     VARCHAR(150) NOT NULL
name          VARCHAR(150) NOT NULL
countryCode   VARCHAR(5) NOT NULL
fixed         BOOLEAN NOT NULL
global        BOOLEAN NOT NULL
counties      TEXT NULL أو NOT NULL إذا ملأتها
launchYear    INTEGER NULL
types         TEXT NOT NULL
```

## Primary Key

استخدم Composite PK من:

```text
date
name
```

قبل ذلك تأكد أنه لا توجد Duplicate rows على هذين الحقلين.

إذا Validation أو Deployment ترفض بسبب Duplicate:

- أزل Composite PK.
- اترك No PK warning.
- أعد Validate.

## اختبارات

- Save Draft.
- Refresh.
- Verify SQL.
- Validate.

المتوقع:

```text
Valid
0 blocking errors
```

---

# TS-API-10: Relationships

Table واحدة.

المتوقع:

```text
0 suggestions
0 persisted relationships
```

Detect لا يجب أن يقترح Self relationship.

---

# TS-API-11: Exports

المتوقع:

```text
5 artifacts
```

تحقق:

- SQL تحتوي `CREATE TABLE us_public_holidays_2026`.
- `launchYear` أو `launchyear` تسمح Null.
- JSON export غير فارغة.
- Quality report Row count = API_RAW_ROW_COUNT.

---

# TS-API-12: Deployment

المتوقع:

```text
Status: Completed
Tables created: 1
Rows seeded: API_RAW_ROW_COUNT
Relationships: 0
Failed rows: 0
```

نزّل:

```text
deploy.sql
```

Schema:

```text
forgedb_project_<API_PROJECT_ID>
```

---

# TS-API-13: pgAdmin Verification

شغل `deploy.sql`.

ثم:

```sql
SELECT COUNT(*)
FROM forgedb_project_API_PROJECT_ID.us_public_holidays_2026;
```

المتوقع:

```text
API_RAW_ROW_COUNT
```

تحقق من البيانات:

```sql
SELECT date, name, countrycode, global
FROM forgedb_project_API_PROJECT_ID.us_public_holidays_2026
ORDER BY date
LIMIT 10;
```

قد يكون الاسم normalized:

```text
country_code
```

استخدم الاسم الموجود فعليًا في SQL Preview.

تحقق من Null:

```sql
SELECT COUNT(*) AS null_launch_year
FROM forgedb_project_API_PROJECT_ID.us_public_holidays_2026
WHERE launchyear IS NULL;
```

استخدم الاسم الفعلي من SQL.

المتوقع:

```text
قد يكون أكبر من 0
والنشر يظل ناجحًا لأن Column Nullable
```

---

# 8. اختبار إعادة تشغيل deploy.sql

لكل مشروع:

1. شغّل Deployment من ForgeDB.
2. نزّل `deploy.sql`.
3. شغّل `deploy.sql` يدويًا.
4. نفذ Count.
5. شغّل نفس `deploy.sql` مرة ثانية.

المتوقع:

- ينجح مرة ثانية.
- لا يقول Table already exists.
- السبب أن Complete deployment script تعمل:
  `DROP SCHEMA ... CASCADE`
  ثم تعيد إنشاء Schema.

تحذير:

أي تعديل يدوي داخل Project schema يُحذف عند إعادة التشغيل.

---

# 9. Expected Results Summary

| Story | Source | Raw Rows | Final Rows | Tables | Relationships |
|---|---|---:|---:|---:|---:|
| CSV Titanic | Real CSV | 891 | 784 | 1 | 0 |
| XLSX Raisin | Real Excel | 900 | 900 | 1 | 0 |
| API Holidays | Live public API | سجّلها | نفس العدد | 1 | 0 |

لكل Story:

```text
Exports = 5 files
Deployment status = Completed
Failed rows = 0
deploy.sql executes successfully
PostgreSQL count matches final ForgeDB count
```

---

# 10. متى تعتبر الصفحة PASS؟

## Home / Projects

PASS:

- Create/Open/Edit/Search/Refresh تعمل.
- لا تظهر Projects مستخدم آخر.

## Data Sources

PASS:

- المصدر يُقرأ.
- Preview صحيحة.
- Metadata صحيحة.
- Refresh لا يفقد البيانات.

## Analysis

PASS:

- Counts صحيحة.
- Types منطقية.
- لا يوجد NaN/negative counts.
- Charts تظهر.

## Dashboard

PASS:

- نفس Metrics.
- لا Loader دائم.
- Direct refresh يعمل.

## Cleaning

PASS:

- Preview non-mutating.
- Apply تنشئ Version.
- Raw تبقى.
- Undo/Restore يعملان.
- Re-analysis تحدث Metrics.

## Schema Designer

PASS:

- Draft تحفظ.
- Refresh يحافظ عليها.
- Validation واضحة.
- SQL frontend/backend متطابقة.
- Revision conflict لا يخرب الصفحة.

## Relationships

PASS:

- Single table لا تنتج Self relationship.
- Queue لا تمنع الانتقال.
- لا 500.

## Exports

PASS:

- 5 Artifacts.
- Preview/Copy/Download.
- محتوى غير فارغ.

## Deployment

PASS:

- Confirmation واضحة.
- Completed.
- Counts صحيحة.
- Files متاحة.
- PostgreSQL مطابقة.

---

# 11. متى تسجل Defect؟

سجل Defect عند:

```text
Unexpected 500
Endless loader
Blank page
Wrong row/column count
Import changes raw values unexpectedly
Preview mutates data
Apply does not create version
Undo/Restore does not update active version
Re-analysis keeps old metrics
Clean dataset cannot confirm quality
Saved schema disappears after refresh
Frontend SQL differs from backend SQL
Self relationship detected
Export file empty
Deployment says success but PostgreSQL differs
Failed deployment leaves partial schema
deploy.sql cannot run twice
Console error
Horizontal overflow
```

---

# 12. قالب تسجيل Defect

```text
Title:
[Page] Clear description

Environment:
Branch: feature/final-ui-integration
Browser:
Date:
Project ID:
Dataset ID:

Preconditions:

Steps:
1.
2.
3.

Expected Result:

Actual Result:

HTTP Request/Response:

Console Error:

Screenshot/Video:

Severity:
Critical / High / Medium / Low
```

---

# 13. ترتيب التنفيذ المقترح بكرة

ابدأ بالترتيب:

```text
1. CSV Titanic
2. Excel Raisin
3. API Holidays
```

السبب:

- Titanic تختبر أصعب Analysis/Cleaning flow.
- Raisin تختبر Clean Excel flow بدون Missing.
- API تختبر Network/SSRF/JSON/Nullable flow.
- في النهاية تكون اختبرت ثلاث حالات مختلفة فعلًا، وليس نفس البيانات بثلاث صيغ.
