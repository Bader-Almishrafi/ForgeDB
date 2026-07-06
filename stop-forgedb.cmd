@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "NO_PAUSE="
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"

cd /d "%ROOT%"

echo.
echo ForgeDB local stop
echo Repository: %CD%
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [WARN] Docker CLI was not found. Skipping Docker Compose shutdown.
) else (
  echo Stopping Docker Compose services...
  docker compose down
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [WARN] PowerShell was not found. Skipping local process cleanup.
  call :PauseIfNeeded
  exit /b 0
)

echo Stopping local ForgeDB dotnet, node, and python processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$patterns = @('ForgeDB.API','ng serve','angular-app','uvicorn app\.main:app','python-analysis-service','start-forgedb'); $names = @('cmd.exe','dotnet.exe','ForgeDB.API.exe','node.exe','python.exe','pythonw.exe'); $processes = Get-CimInstance Win32_Process | Where-Object { $cmd = $_.CommandLine; $name = $_.Name; $cmd -and ($names -contains $name) -and ($patterns | Where-Object { $cmd -match $_ }) }; foreach ($process in $processes) { Write-Host ('Stopping PID {0}: {1}' -f $process.ProcessId, $process.CommandLine); Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo Stop command complete.
call :PauseIfNeeded

endlocal
exit /b 0

:PauseIfNeeded
if not defined NO_PAUSE pause
exit /b 0
