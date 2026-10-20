@echo off
set APP_DIR=%~dp0
cd /d "%APP_DIR%"
echo Starting Overdue Background Worker Daemon (Asia/Manila UTC+8)...
node scripts\overdue-worker.mjs
