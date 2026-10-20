@echo off
set APP_DIR=%~dp0
cd /d "%APP_DIR%"
echo Starting Resilient PostgreSQL Database Server on port 5432...
node scripts\db-server.mjs
