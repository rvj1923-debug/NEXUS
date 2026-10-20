@echo off
setlocal EnableExtensions EnableDelayedExpansion

:: Resolve Edge executable path
set "MSEDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "!MSEDGE_EXE!" (
    set "MSEDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
if not exist "!MSEDGE_EXE!" (
    set "MSEDGE_EXE=msedge.exe"
)

:: Compute file:/// URI to boot.html in this directory
set "BOOT_DIR=%~dp0"
set "BOOT_FILE=!BOOT_DIR!boot.html"
set "BOOT_URI=!BOOT_FILE:\=/!"
set "BOOT_URI=!BOOT_URI: =%%20!"
set "BOOT_URL=file:///!BOOT_URI!"

:: Use a dedicated Edge profile directory so background Edge (--no-startup-window) never blocks --kiosk mode
set "KIOSK_PROFILE=%LOCALAPPDATA%\PhoneTracker\EdgeKioskProfile"
if not exist "!KIOSK_PROFILE!" mkdir "!KIOSK_PROFILE!" >nul 2>&1

:: Launch Microsoft Edge in Fullscreen Kiosk Mode pointing to local boot.html
start "" "!MSEDGE_EXE!" --user-data-dir="!KIOSK_PROFILE!" --kiosk "!BOOT_URL!" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --kiosk-idle-timeout-minutes=0 --disable-pinch --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required

endlocal
