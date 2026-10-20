@echo off
set APP_DIR=%~dp0
cd /d "%APP_DIR%"
echo Starting Local USB NFC Reader Agent on port 8002...
node agent\reader-agent.mjs
