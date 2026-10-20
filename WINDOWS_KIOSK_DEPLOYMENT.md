# Windows Kiosk Deployment & Hardware Hardening Guide

**Document Version:** 2.1.0  
**Target Hardware:** Windows 10 / 11 Enterprise Headless Mini PC or Turnstile Terminal  
**Boot Waiting Page:** `file:///D:/AI%20Projects/company-phone-tracker/kiosk-boot/boot.html`  
**Application URL:** `http://localhost:5000/api/kiosk/device-login?key=<KIOSK_DEVICE_SECRET>`  
**Reader Mode:** Mode A Keyboard Wedge / Local NFC Agent (Port 8002)

---

## 1. Operating System Configuration

Deploying the Company Phone Tracker on dedicated headless Windows kiosk hardware requires system-level hardening to prevent accidental window closure, desktop access, or sleep states.

### Step 1: Create Dedicated Local Windows User
Create a non-administrative local Windows account dedicated to the kiosk:
```powershell
# Open Administrator PowerShell
net user KioskUser "DepotKiosk2026!" /add /comment:"Dedicated Turnstile Kiosk User"
net localgroup Users KioskUser /add
```

### Step 2: Configure Automatic Login (Sysinternals Autologon or Assigned Access)
1. Download `Autologon.exe` from Microsoft Sysinternals.
2. Run `Autologon.exe KioskUser . "DepotKiosk2026!"`.
3. Verify that on reboot, the computer boots directly into `KioskUser` without prompting for a password.

---

## 2. Boot Waiting Page & Microsoft Edge Full-Screen Kiosk Mode

Because the web server (`CPT_Web`) and database (`CPT_DB`) start asynchronously on boot, Microsoft Edge opens the local static boot waiting page (`kiosk-boot\boot.html`) from disk first.

1. Copy `kiosk-boot\config.example.js` to `kiosk-boot\config.js` (gitignored) and set `deviceKey` to your `KIOSK_DEVICE_SECRET` from `.env`.
2. `kiosk-boot\boot.html` displays **"Starting Phone Tracker…"** with a spinner and polls `http://localhost:5000/api/health` every 3 seconds until it returns HTTP `200` with `checks.database.status === "UP"`.
3. Once healthy, it redirects to `http://localhost:5000/api/kiosk/device-login?key=<KIOSK_DEVICE_SECRET>`, which issues the `cpt_session` and `cpt_kiosk_device` `httpOnly` cookies and redirects to `/kiosk`.
4. After 5 minutes of failures, it displays **"System unavailable – contact IT"** while continuing to retry every 3 seconds.

### Launch Script (`kiosk-boot/launch-kiosk.bat`)
```bat
start "" "%MSEDGE_EXE%" --kiosk "file:///D:/AI%20Projects/company-phone-tracker/kiosk-boot/boot.html" --edge-kiosk-type=fullscreen --no-first-run --kiosk-idle-timeout-minutes=0 --disable-pinch --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required
```

### Pointing Assigned Access or Shell Launcher at `launch-kiosk.bat` / `boot.html`
- **Assigned Access**: Set Microsoft Edge as the kiosk app in fullscreen digital sign mode with URL `file:///D:/AI%20Projects/company-phone-tracker/kiosk-boot/boot.html`.
- **Shell Launcher / Custom User Shell**: Set `HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` (or Shell Launcher v2 cmd) to `cmd.exe /c "D:\AI Projects\company-phone-tracker\kiosk-boot\launch-kiosk.bat"`.

---

## 3. Background Services & Split Watchdog Installation (NSSM)

Assigned Access does not run Startup-folder scripts. Instead, all 4 backend processes are installed as native Windows Services via NSSM (`2.24-101-g897c7ad` recommended for Windows 10 Creators Update and Windows 11, available from `https://nssm.cc/download` at `https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip`), and the watchdog is split into two tasks so no console window ever flashes or steals keyboard-wedge focus from Edge:

1. **`CPT_DB`**: `node.exe scripts\db-server.mjs` (`127.0.0.1:5432`, `SERVICE_AUTO_START`, graceful `AppStopMethodConsole` 15s, `PreshutdownTimeout` 20s)
2. **`CPT_Web`**: `node.exe node_modules/next/dist/bin/next start -p 5000` (`http://localhost:5000`, `SERVICE_DELAYED_AUTO_START`, depends on `CPT_DB`)
3. **`CPT_Worker`**: `node.exe scripts\overdue-worker.mjs` (`SERVICE_AUTO_START`, depends on `CPT_DB`)
4. **`CPT_Agent`**: `node.exe agent\reader-agent.mjs` (`127.0.0.1:8002`, `SERVICE_AUTO_START`)
5. **`CPT_Service_Watchdog` (Scheduled Task under `SYSTEM`, every 1 minute)**:
   - Runs `scripts\kiosk-watchdog.ps1` in Session 0 (non-interactive, no window).
   - If `/api/health` responds with `checks.database.status !== "UP"` or `127.0.0.1:5432` refuses TCP for 3 consecutive checks, shuts down `CPT_DB` via `POST http://127.0.0.1:54320/shutdown` and restarts `CPT_DB` (not `CPT_Web`).
   - Restarts `CPT_Web` only when `/api/health` does not respond at all 3 times in a row.
   - Enforces a 10-minute per-service restart cooldown and logs every action to `logs\watchdog.log`.
6. **`CPT_Edge_Watchdog` (Scheduled Task under `KioskUser`, every 2 minutes)**:
   - Runs `wscript.exe //B //NoLogo scripts\edge-watchdog.vbs` (window style `0`) which invokes `conhost.exe --headless powershell.exe ... scripts\edge-watchdog.ps1` with zero visible window.
   - Relaunches Edge in kiosk mode if `msedge` is not running.

### Install / Update Services with Least Privilege (Run PowerShell as Administrator)
```powershell
cd "D:\AI Projects\company-phone-tracker"
powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1 -NssmPath .\tools\nssm.exe -ServiceAccount "cptsvc" -KioskUser "KioskUser"
```

### Verify Zero Focus Stealing (5-Minute Continuous Tap Test)
Tap NFC cards continuously every few seconds for 5 minutes while `CPT_Service_Watchdog` (1-min interval) and `CPT_Edge_Watchdog` (2-min interval) execute in the background, and confirm zero window flashes and zero lost taps.

### Uninstall Services (Run PowerShell as Administrator)
```powershell
cd "D:\AI Projects\company-phone-tracker"
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-services.ps1
```

---

## 4. USB NFC Reader Power Management Hardening

1. **Disable USB Selective Suspend in Power Options:**
   ```powershell
   powercfg /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba4d5a0 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
   powercfg /SETACTIVE SCHEME_CURRENT
   ```
2. **Device Manager USB Root Hub Settings:**
   * Open **Device Manager** (`devmgmt.msc`).
   * Expand **Universal Serial Bus controllers**.
   * Right-click every **USB Root Hub** and **Generic USB Hub** -> select **Properties** -> **Power Management** tab.
   * **Uncheck** *"Allow the computer to turn off this device to save power"*.

---

## 5. Health Monitoring & Recovery Heartbeat

`GET http://localhost:5000/api/health` echoes `Access-Control-Allow-Origin` only for `Origin: null` (`file://`), `http://localhost:5000`, or `http://127.0.0.1:5000`, sanitizes database error strings from the response body, and returns:
* **HTTP 200 (`HEALTHY` / `DEGRADED`)**: Database `UP`.
* **HTTP 503 (`UNHEALTHY`)**: Database `DOWN` / unreachable.

---

## 6. Unattended In-App Resilience, Overlays & NFC Maintenance

Once Microsoft Edge is running `/kiosk`, the application handles service disruptions, remote administrative locks, and touch-free diagnostics automatically:

1. **Offline Overlay (`>= 30s` DB or Server Outage)**:
   - `/kiosk` polls `GET /api/health` every 10 seconds.
   - If the web server is unreachable or `checks.database.status !== "UP"` for 30 seconds or more, a full-screen **"Temporarily unavailable – please wait"** (`"Pansamantalang hindi magagamit – mangyaring maghintay"`) overlay appears.
   - Taps during the outage play the warning chime and display **"Please wait and tap again"** (`"Mangyaring maghintay at i-tap muli"`) so users receive immediate audible/visual feedback.
   - When `CPT_DB` / `CPT_Web` recovers and `/api/health` returns `checks.database.status === "UP"`, the overlay clears automatically without reloading the page.

2. **Maintenance Lock & `/kiosk/not-provisioned` Recovery**:
   - If an administrator sets the `KioskDevice` status to `DISABLED` or `MAINTENANCE` on `/admin/kiosks`, the next card tap receives `503 KIOSK_MAINTENANCE` from `POST /api/kiosk/resolve` and immediately shows the full-screen **"Kiosk under maintenance"** (`"Nasa ilalim ng maintenance ang kiosk"`) lock screen.
   - While locked, `/kiosk` re-checks every 30 seconds via `POST /api/kiosk/keepalive` (and checks `/api/kiosk/config` status). If re-enabled (`ACTIVE`), the lock clears automatically. If `keepalive` returns `403`, the terminal redirects to `/api/kiosk/device-login` $\rightarrow$ `/kiosk/not-provisioned?reason=device_inactive`, which retries `/api/kiosk/device-login` every 10 seconds and returns to `/kiosk` once `ACTIVE`.

3. **NFC Maintenance Card (30-Second Diagnostics & Touch-Free Reload)**:
   - A `SYSTEM_ADMIN` can flag an NFC card with `isMaintenanceCard = true` in `/admin/nfc-cards`.
   - Tapping the maintenance card at `/kiosk` creates no custody transaction, records a `KIOSK_MAINTENANCE_CARD_TAP` audit log, and displays a 30-second diagnostics screen (Reader status, Agent status, DB/Health status, Last Backup timestamp, App Version, `KIOSK_CODE`, Server Time, and Queue Length).
   - Tapping the maintenance card a second time within the 30-second window reloads the page immediately.

4. **10-Minute Self-Heal Reload & Clock Drift Badge**:
   - If the kiosk stays in an error or offline state continuously for more than 10 minutes, it calls `window.location.reload()`, guarded by `sessionStorage` (`try/catch` wrapped) so it cannot reload more than once every 10 minutes. (In non-production builds, `?selfHealMs=<ms>` overrides the threshold for testing.)
   - If the server time from `/api/health` or `/api/kiosk/config` differs from the mini PC's clock by more than 2 minutes, a header warning badge (`"Clock out of sync"`) is shown.

