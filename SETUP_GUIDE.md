# ForgeDB Setup Guide

## Required Software

### 1. Git
Download:
https://git-scm.com/

Check:
git --version

---

### 2. Node.js (LTS)
Download:
https://nodejs.org/

Check:
node -v
npm -v

---

### 3. Angular CLI
Install:
npm install -g @angular/cli

Check:
ng version

---

### 4. .NET SDK 9
Download:
https://dotnet.microsoft.com/en-us/download

Check:
dotnet --version

---

### 5. Python 3.12+
Download:
https://www.python.org/downloads/

Check:
python --version

---

### 6. Docker Desktop
Download:
https://www.docker.com/products/docker-desktop/

Check:
docker --version
docker compose version

ForgeDB uses Docker Compose for the local PostgreSQL database so every developer can use the same local database setup.

Local PostgreSQL connection used by the backend:

```text
Host=localhost;Port=5433;Database=forgedb;Username=postgres;Password=postgres
```

The container uses PostgreSQL port `5432` internally and publishes it on host port `5433` to avoid conflicts with manually installed local PostgreSQL services.

---

### 7. VS Code
Download:
https://code.visualstudio.com/

Recommended Extensions:
- Angular Language Service
- Python
- C#
- PostgreSQL
- Thunder Client
- ESLint
- Prettier

---

# Frontend Setup

cd frontend/angular-app

npm install

npm start

---

# Backend Setup

Start local PostgreSQL:

```bash
docker compose up -d
```

Restore local .NET tools:

```bash
dotnet tool restore
```

Apply EF Core migrations:

```bash
dotnet ef database update --project backend/ForgeDB.API --startup-project backend/ForgeDB.API
```

Build backend:

```bash
dotnet build backend/ForgeDB.sln
```

Run backend API:

```bash
dotnet run --project backend/ForgeDB.API
```

For a stable local Postman URL, you can also run:

```bash
dotnet run --project backend/ForgeDB.API --urls http://localhost:5000
```

## Manual Auth, Project, and Dataset API Testing with Postman

Set a Postman variable:

```text
baseUrl = http://localhost:5000
```

### Register User

```text
POST {{baseUrl}}/api/auth/register
Content-Type: application/json
```

Body:

```json
{
  "firstName": "Manual",
  "lastName": "Tester",
  "email": "manual.tester@example.com",
  "password": "ForgeDB123!"
}
```

Expected result:

```text
201 Created
```

The response body contains `user.id`, `user.firstName`, `user.lastName`, `user.email`, `user.role`, and `user.createdAt`. It does not include `password` or `passwordHash`. Save `user.id` as `userId`.

If this email has already been registered, use a new email or run the login request below. Duplicate registration returns:

```text
409 Conflict
```

### Login User

```text
POST {{baseUrl}}/api/auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "manual.tester@example.com",
  "password": "ForgeDB123!"
}
```

Expected result:

```text
200 OK
```

The response body contains user data only. JWT/token authentication is not implemented yet.

Invalid credentials return:

```text
401 Unauthorized
```

### Create Project

```text
POST {{baseUrl}}/api/projects
Content-Type: application/json
```

Body:

```json
{
  "userId": {{userId}},
  "name": " Sales Analytics MVP ",
  "description": " First real ForgeDB project "
}
```

Expected result:

```text
201 Created
```

The response body contains the new project `id`, trimmed `name`, trimmed `description`, and timestamps. Save the returned `id` as `projectId`.

Use the registered user's `user.id` value for `userId`.

### Get Project by ID

```text
GET {{baseUrl}}/api/projects/{{projectId}}
```

Expected result:

```text
200 OK
```

### Get Projects by User ID

```text
GET {{baseUrl}}/api/projects/user/{{userId}}
```

Expected result:

```text
200 OK
```

The response body is an array of projects owned by that user.

### Example CSV File

Create a local file named `sales-example.csv` with this content:

```csv
OrderId,Customer,Amount,Region
1,Ada,120.50,North
2,Grace,85.00,West
3,Linus,,South
2,Grace,85.00,West
```

This sample has 4 rows, 4 columns, 1 missing value, and 1 duplicate row.

### Upload CSV Dataset to Project

```text
POST {{baseUrl}}/api/projects/{{projectId}}/datasets/upload
Content-Type: multipart/form-data
```

In Postman, use `Body` > `form-data`:

```text
TableName   Text   sales_orders
SourceType  Text   csv
SourceName  Text   sales-example.csv
File        File   sales-example.csv
```

Expected result:

```text
201 Created
```

Example response:

```json
{
  "id": 1,
  "projectId": 1,
  "tableName": "sales_orders",
  "sourceType": "csv",
  "sourceName": "sales-example.csv",
  "rowCount": 4,
  "columnCount": 4,
  "missingValuesCount": 1,
  "duplicateRowsCount": 1,
  "status": "Imported",
  "createdAt": "2026-06-30T00:00:00Z"
}
```

Save the returned `id` as `datasetId`.

Invalid uploads return:

```text
400 Bad Request
```

Examples: no file attached, empty file, non-`.csv` file extension, unsupported `SourceType`, empty headers, duplicate headers, or rows with a different number of values than the header row.

Uploading to a missing project returns:

```text
404 Not Found
```

### Get Project Datasets

```text
GET {{baseUrl}}/api/projects/{{projectId}}/datasets
```

Expected result:

```text
200 OK
```

The response body is an array of dataset metadata for the project.

Example response:

```json
[
  {
    "id": 1,
    "projectId": 1,
    "tableName": "sales_orders",
    "sourceType": "csv",
    "sourceName": "sales-example.csv",
    "rowCount": 4,
    "columnCount": 4,
    "missingValuesCount": 1,
    "duplicateRowsCount": 1,
    "status": "Imported",
    "createdAt": "2026-06-30T00:00:00Z"
  }
]
```

Requesting datasets for a missing project returns:

```text
404 Not Found
```

### Get Dataset Preview

```text
GET {{baseUrl}}/api/datasets/{{datasetId}}/preview
```

Expected result:

```text
200 OK
```

The preview returns column names and up to 50 stored rows.

Example response:

```json
{
  "datasetId": 1,
  "tableName": "sales_orders",
  "columns": [
    "OrderId",
    "Customer",
    "Amount",
    "Region"
  ],
  "rows": [
    {
      "OrderId": "1",
      "Customer": "Ada",
      "Amount": "120.50",
      "Region": "North"
    },
    {
      "OrderId": "2",
      "Customer": "Grace",
      "Amount": "85.00",
      "Region": "West"
    },
    {
      "OrderId": "3",
      "Customer": "Linus",
      "Amount": null,
      "Region": "South"
    },
    {
      "OrderId": "2",
      "Customer": "Grace",
      "Amount": "85.00",
      "Region": "West"
    }
  ]
}
```

Requesting a missing dataset returns:

```text
404 Not Found
```

### Analysis and Dashboard CSV File

For the analysis/dashboard test, create a local file named `customer-totals.csv` with this content:

```csv
customer_id,name,email,total
1,Bader,bader@example.com,250
2,Ahmed,ahmed@example.com,120
3,Nora,nora@example.com,310
4,Ahmed,ahmed@example.com,120
5,,missing@example.com,
```

Upload it using the same multipart endpoint:

```text
POST {{baseUrl}}/api/projects/{{projectId}}/datasets/upload
Content-Type: multipart/form-data
```

In Postman, use `Body` > `form-data`:

```text
TableName   Text   customer_totals
SourceType  Text   csv
SourceName  Text   customer-totals.csv
File        File   customer-totals.csv
```

Expected upload result:

```text
201 Created
```

Save the returned `id` as `datasetId`.

This sample should produce 5 rows, 4 columns, 2 missing values, `total` as a numeric column, and `name`/`email` as text columns.

Duplicate rows are counted as exact full-row matches across all stored columns. In this sample, the repeated Ahmed row has a different `customer_id`, so the duplicate row count is expected to be `0`.

### Analyze Dataset

```text
POST {{baseUrl}}/api/datasets/{{datasetId}}/analyze
Content-Type: application/json
```

Body:

```json
{
  "analysisType": "summary"
}
```

Expected result:

```text
200 OK
```

Example response excerpt:

```json
{
  "datasetId": 1,
  "tableName": "customer_totals",
  "status": "Analyzed",
  "analysisResult": {
    "rowCount": 5,
    "columnCount": 4,
    "missingValuesCount": 2,
    "duplicateRowsCount": 0,
    "duplicateRowRule": "Exact full-row match across all stored columns.",
    "columns": [
      {
        "columnName": "name",
        "detectedDataType": "string",
        "missingValuesCount": 1,
        "uniqueValuesCount": 3,
        "isNullable": true,
        "sampleValues": ["Bader", "Ahmed", "Nora"],
        "numericStats": null,
        "mostCommonValues": [
          {
            "value": "Ahmed",
            "count": 2
          }
        ]
      },
      {
        "columnName": "total",
        "detectedDataType": "integer",
        "missingValuesCount": 1,
        "uniqueValuesCount": 3,
        "isNullable": true,
        "numericStats": {
          "columnName": "total",
          "min": 120,
          "max": 310,
          "average": 200,
          "count": 4
        }
      }
    ],
    "columnTypeDistribution": [
      {
        "dataType": "integer",
        "count": 2
      },
      {
        "dataType": "string",
        "count": 2
      }
    ]
  },
  "chartRecommendations": [],
  "analyzedAt": "2026-06-30T00:00:00Z"
}
```

The actual `chartRecommendations` array may include histogram, bar, or scatter recommendations based on the detected columns.

Missing dataset:

```text
404 Not Found
```

Dataset with no rows or no columns:

```text
400 Bad Request
```

### Get Dataset Dashboard

```text
GET {{baseUrl}}/api/datasets/{{datasetId}}/dashboard
```

Expected result:

```text
200 OK
```

Example response excerpt:

```json
{
  "datasetId": 1,
  "tableName": "customer_totals",
  "rowCount": 5,
  "columnCount": 4,
  "missingValuesCount": 2,
  "duplicateRowsCount": 0,
  "metrics": [
    {
      "key": "rowCount",
      "label": "Rows",
      "value": 5
    },
    {
      "key": "missingValues",
      "label": "Missing Values",
      "value": 2
    }
  ],
  "columnTypeDistribution": [
    {
      "dataType": "integer",
      "count": 2
    },
    {
      "dataType": "string",
      "count": 2
    }
  ],
  "numericSummaries": [
    {
      "columnName": "total",
      "min": 120,
      "max": 310,
      "average": 200,
      "count": 4
    }
  ],
  "topValueSummaries": [
    {
      "columnName": "name",
      "values": [
        {
          "value": "Ahmed",
          "count": 2
        }
      ]
    }
  ],
  "chartRecommendations": []
}
```

Missing dataset:

```text
404 Not Found
```

Dataset with no rows or no columns:

```text
400 Bad Request
```

### Validation Checks

Blank project name:

```text
POST {{baseUrl}}/api/projects
Content-Type: application/json
```

```json
{
  "userId": {{userId}},
  "name": "   ",
  "description": "Invalid project"
}
```

Expected result:

```text
400 Bad Request
```

Missing project:

```text
GET {{baseUrl}}/api/projects/999999
```

Expected result:

```text
404 Not Found
```

Stop local PostgreSQL:

```bash
docker compose down
```

Delete local PostgreSQL data only when a full local reset is needed:

```bash
docker compose down -v
```

---

# Python Analysis Service Setup

cd python-analysis-service

python -m venv venv

Activate venv:

Windows:
venv\Scripts\activate

Linux/macOS:
source venv/bin/activate

Install requirements:
pip install -r requirements.txt

Run:
python main.py
