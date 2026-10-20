@echo off
set APP_DIR=%~dp0
cd /d "%APP_DIR%"
node scripts\stop-services.mjs
