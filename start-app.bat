@echo off
set APP_DIR=%~dp0
cd /d "%APP_DIR%"
if not defined APP_HOST set APP_HOST=0.0.0.0
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /I "%%A"=="APP_HOST" set "APP_HOST=%%~B"
    )
)
echo Starting Next.js Production Web Application on %APP_HOST%:5000...
npx next start -p 5000 -H %APP_HOST%
