# ForgeDB Python Analysis Service

Standalone FastAPI service for profiling CSV-like dataset rows and returning ForgeDB-friendly analysis results.

## Run Locally

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Health check:

```text
GET http://localhost:8001/health
```

Analyze dataset:

```text
POST http://localhost:8001/analyze
Content-Type: application/json
```

```json
{
  "datasetId": 1,
  "tableName": "sales",
  "columns": [
    {
      "name": "customer_id",
      "dataType": "integer"
    },
    {
      "name": "name",
      "dataType": "string"
    },
    {
      "name": "total",
      "dataType": "integer"
    }
  ],
  "rows": [
    {
      "customer_id": "1",
      "name": "Bader",
      "total": "250"
    },
    {
      "customer_id": "2",
      "name": "Ahmed",
      "total": "120"
    },
    {
      "customer_id": "3",
      "name": "Bader",
      "total": "310"
    }
  ]
}
```

The service currently runs standalone and does not require a database or backend connection.
