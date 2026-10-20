@echo off
echo ==================================================================
echo   COMPANY PHONE TRACKER — ENTERPRISE STARTUP ORCHESTRATOR
echo ==================================================================
echo.

set APP_DIR=%~dp0
cd /d "%APP_DIR%"

echo [1/4] Checking PostgreSQL Data Storage...
if not exist "%APP_DIR%postgres_data" (
    echo Creating postgres_data directory...
    mkdir "%APP_DIR%postgres_data"
)

echo [2/4] Starting PostgreSQL Server (Port 5432)...
start "CPT-PostgreSQL" /min cmd /c "node scripts\db-server.mjs"
node scripts\wait-for-pg.mjs

echo [3/4] Starting Local USB NFC Reader Agent (Port 8002)...
start "CPT-NFC-Agent" /min cmd /c "node agent\reader-agent.mjs"
ping -n 2 127.0.0.1 >nul

echo [4/4] Starting Overdue Monitoring Worker & Public HTTPS Tunnel...
start "CPT-Overdue-Worker" /min cmd /c "node scripts\overdue-worker.mjs"
ping -n 2 127.0.0.1 >nul

if not defined APP_HOST set APP_HOST=0.0.0.0
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /I "%%A"=="APP_HOST" set "APP_HOST=%%~B"
    )
)

echo Starting Next.js Production Web Application (Port 5000, Host %APP_HOST%)...
start "CPT-Web-App" cmd /c "npx next start -p 5000 -H %APP_HOST%"

echo.
echo ==================================================================
echo   COMPANY PHONE TRACKER SERVICES INITIALIZED
echo ==================================================================
echo   • Web Application:  http://localhost:5000
echo   • Health Telemetry: http://localhost:5000/api/health
echo   • Local NFC Agent:  http://127.0.0.1:8002/api/agent/health
echo   • Database Engine:  127.0.0.1:5432 (PostgreSQL)
echo   • External Tunnel:  Auto-Managed via tools\cloudflared.exe
echo ==================================================================
echo.
