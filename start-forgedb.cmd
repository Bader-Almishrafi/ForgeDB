@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "NO_PAUSE="
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

cd /d "%ROOT%"

echo.
echo ForgeDB local startup
echo Repository: %CD%
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker CLI was not found. Install Docker Desktop and try again.
  call :PauseIfNeeded
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker is not running. Start Docker Desktop, wait until it is ready, then run this script again.
  call :PauseIfNeeded
  exit /b 1
)

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [ERROR] dotnet was not found. Install the .NET SDK and try again.
  call :PauseIfNeeded
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node was not found. Install Node.js and try again.
  call :PauseIfNeeded
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js/npm and try again.
  call :PauseIfNeeded
  exit /b 1
)

where npx >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npx was not found. Install Node.js/npm and try again.
  call :PauseIfNeeded
  exit /b 1
)

if not exist "%ROOT%python-analysis-service\.venv\Scripts\python.exe" (
  echo [ERROR] Python virtual environment was not found:
  echo         %ROOT%python-analysis-service\.venv\Scripts\python.exe
  echo Create the venv and install python-analysis-service requirements, then run this script again.
  call :PauseIfNeeded
  exit /b 1
)

if not exist "%ROOT%frontend\angular-app\node_modules" (
  echo [ERROR] Frontend dependencies are missing:
  echo         %ROOT%frontend\angular-app\node_modules
  echo Run npm install from frontend\angular-app, then run this script again.
  call :PauseIfNeeded
  exit /b 1
)

echo [1/4] Starting PostgreSQL with Docker Compose...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] docker compose up -d failed.
  call :PauseIfNeeded
  exit /b 1
)

echo [2/4] Starting Python analysis service on port 8002...
start "ForgeDB Python Analysis" /D "%ROOT%python-analysis-service" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8002"

echo [3/4] Starting ASP.NET backend on port 5000...
start "ForgeDB API" /D "%ROOT%" cmd /k "set PythonAnalysis__BaseUrl=http://localhost:8002&& dotnet run --project backend\ForgeDB.API --urls http://localhost:5000"

echo [4/4] Starting Angular frontend on port 4200...
start "ForgeDB Angular" /D "%ROOT%frontend\angular-app" cmd /k "npx ng serve --port 4200"

echo.
echo ForgeDB is starting in separate terminal windows.
echo.
echo Frontend:      http://localhost:4200/
echo Backend:       http://localhost:5000/
echo Python health: http://localhost:8002/health
echo.
echo Keep the service windows open while working. Errors will remain visible there.
echo Run stop-forgedb.cmd to stop the local services.
echo.
call :PauseIfNeeded

endlocal
exit /b 0

:PauseIfNeeded
if not defined NO_PAUSE pause
exit /b 0
