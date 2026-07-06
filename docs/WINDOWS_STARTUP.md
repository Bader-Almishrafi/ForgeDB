# Windows Local Startup

Use `start-forgedb.cmd` from the repository root to start the local ForgeDB stack.

It starts:

- Docker PostgreSQL with `docker compose up -d`
- Python analysis service on `http://localhost:8002`
- ASP.NET backend on `http://localhost:5000`
- Angular frontend on `http://localhost:4200`

The backend launcher window sets `PythonAnalysis__BaseUrl=http://localhost:8002` so the backend talks to the Python service on the same port started by the script.

## Requirements

- Docker Desktop running
- .NET SDK installed
- Node.js/npm/npx installed
- `python-analysis-service\.venv\Scripts\python.exe` exists
- `frontend\angular-app\node_modules` exists

## Start

From the repository root:

```cmd
start-forgedb.cmd
```

For automated checks without pausing the launcher window:

```cmd
start-forgedb.cmd --no-pause
```

Useful URLs:

- Frontend: `http://localhost:4200/`
- Backend: `http://localhost:5000/`
- Python health: `http://localhost:8002/health`

The backend root URL may return `404` because API routes live under `/api`; that still confirms the backend process is reachable on port `5000`.

## Stop

From the repository root:

```cmd
stop-forgedb.cmd
```

For automated checks without pausing:

```cmd
stop-forgedb.cmd --no-pause
```

The stop script runs `docker compose down` and then stops local ForgeDB-related `cmd`, `dotnet`, `ForgeDB.API`, `node`, and `python` processes whose command lines match this project.
