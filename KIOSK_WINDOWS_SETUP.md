# Company Phone Tracker — Windows 10/11 Kiosk Deployment Guide
## Production Setup for Headless Self-Service NFC Terminals

**Document Version:** 2.1 (Headless Self-Healing & Zero-Focus-Steal Release)  
**Target Operating Systems:** Windows 10 Enterprise / Pro (64-bit), Windows 11 Enterprise / Pro (64-bit)  
**Target Browser:** Microsoft Edge (Chromium-based, Version 120+)  
**Target Station:** Headless Mini PC + Touchscreen Display + USB NFC Reader (No Keyboard / Mouse)  

---

## 1. Architecture Overview

On a headless mini PC that boots directly into an unprivileged Windows kiosk user account (via **Assigned Access** or **Shell Launcher**), Windows does **not** run Startup-folder batch scripts (`start-all.bat`). Furthermore, because there is no keyboard or mouse attached—and the USB NFC reader acts as a keyboard wedge—every failure must recover automatically **without flashing any console window that could steal keyboard focus from Microsoft Edge**.

```
+-----------------------------------------------------------------------------------------+
|                         WINDOWS 11 HEADLESS KIOSK TERMINAL                              |
|                                                                                         |
|  1. Boot / Login (Assigned Access or Shell Launcher -> kiosk-boot/launch-kiosk.bat)     |
|     +-------------------------------------------------------------------------------+   |
|     | Microsoft Edge Fullscreen Kiosk                                               |   |
|     |   Step A: Opens file:///D:/AI%20Projects/.../kiosk-boot/boot.html             |   |
|     |           Polls http://localhost:5000/api/health every 3s until DB is UP      |   |
|     |   Step B: Redirects to http://localhost:5000/api/kiosk/device-login?key=...   |   |
|     |   Step C: Sets httpOnly cookies (cpt_session + cpt_kiosk_device) -> /kiosk    |   |
|     +-------------------------------------------------------------------------------+   |
|                                                                                         |
|  2. Windows Services (Managed by NSSM 2.24-101-g897c7ad via scripts/install-services.ps1)|
|     +------------------+  +------------------+  +------------------+  +--------------+  |
|     | CPT_DB           |  | CPT_Web          |  | CPT_Worker       |  | CPT_Agent    |  |
|     | PGlite (:5432)   |  | Next.js (:5000)  |  | Overdue Worker   |  | NFC (:8002)  |  |
|     | Auto-Start       |  | Delayed-Auto     |  | Auto-Start       |  | Auto-Start   |  |
|     | Graceful Ctrl+C  |  | Depends: CPT_DB  |  | Depends: CPT_DB  |  |              |  |
|     +------------------+  +------------------+  +------------------+  +--------------+  |
|                                                                                         |
|  3. Split Self-Healing Watchdogs (Zero Focus Stealing)                                  |
|     a) CPT_Service_Watchdog (Runs every 1 min under SYSTEM in Session 0, no window):    |
|        - Runs scripts/kiosk-watchdog.ps1                                                |
|        - Restarts CPT_DB (via POST :54320/shutdown first) if checks.database !== "UP"   |
|          or 127.0.0.1:5432 fails TCP 3 consecutive checks                               |
|        - Restarts CPT_Web only if /api/health does not respond at all 3 times in a row  |
|        - Enforces a 10-minute per-service restart cooldown; logs to logs\watchdog.log   |
|     b) CPT_Edge_Watchdog (Runs every 2 min in Kiosk user session, headless):            |
|        - Invokes wscript.exe //B //NoLogo scripts\edge-watchdog.vbs (window style 0)    |
|          -> conhost.exe --headless powershell.exe ... scripts\edge-watchdog.ps1         |
|        - Relaunches Edge in kiosk mode if msedge.exe is not running (zero window flash) |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Windows Operating System Hardening

### 2.1 Disable USB Power Management (Prevent Reader Sleep)
By default, Windows suspends USB hubs to save power, which can disconnect unattended turnstile NFC readers.

1. Open **Device Manager** (`devmgmt.msc`).
2. Expand **Universal Serial Bus controllers**.
3. For each **USB Root Hub** and **Generic USB Hub**:
   - Right-click → **Properties** → **Power Management** tab.
   - **Uncheck** *"Allow the computer to turn off this device to save power"*.
4. Disable USB Selective Suspend in Power Options (Run PowerShell as Administrator):
   ```powershell
   powercfg /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba4d5a0 48e6b7a6-50f5-4786-9372-004780a83002 0
   powercfg /SETACTIVE SCHEME_CURRENT
   ```

### 2.2 Disable Screen Sleep & Lock Screen
The kiosk display must remain permanently awake:
```powershell
# Set screen turn-off timeout to NEVER (0) on AC power
powercfg /change monitor-timeout-ac 0

# Set system sleep timeout to NEVER (0) on AC power
powercfg /change standby-timeout-ac 0

# Disable Lock Screen via Registry
New-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Name "NoLockScreen" -Value 1 -PropertyType DWORD -Force
```

---

## 3. Production Deployment (NSSM Services & Split Watchdog)

### 3.1 Download & Verify NSSM `2.24-101-g897c7ad`
For Windows 10 Creators Update and Windows 11, use NSSM pre-release build **`2.24-101-g897c7ad`**:
- **Official Download Page**: `https://nssm.cc/download`
- **Direct Archive URL**: `https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip`

After downloading and extracting `win64\nssm.exe` to `.\tools\nssm.exe`, compute its SHA-256 hash locally and optionally paste it into `$ExpectedWin64Sha256` in `scripts\install-services.ps1`:
```powershell
Get-FileHash .\tools\nssm.exe -Algorithm SHA256
```

### 3.2 Configure `.env` and `kiosk-boot/config.js`
1. Ensure `.env` in `D:\AI Projects\company-phone-tracker\.env` defines:
   ```env
   PORT=5000
   NEXT_PUBLIC_APP_URL="http://localhost:5000"
   KIOSK_CODE="PHONE-KIOSK-01"
   KIOSK_DEVICE_SECRET="<32+ random hex characters>"
   ```
2. Copy `kiosk-boot\config.example.js` to `kiosk-boot\config.js` (which is gitignored) and set `deviceKey` to match `KIOSK_DEVICE_SECRET`:
   ```javascript
   window.CPT_KIOSK_CONFIG = {
     baseUrl: "http://localhost:5000",
     deviceKey: "<KIOSK_DEVICE_SECRET>",
   };
   window.KIOSK_DEVICE_SECRET = window.CPT_KIOSK_CONFIG.deviceKey;
   ```
   *(Note: `scripts\install-services.ps1` automatically generates `kiosk-boot\config.js` from `.env` if it does not already exist.)*

### 3.3 Install Windows Services & Split Watchdogs (`scripts/install-services.ps1`)
Run PowerShell **as Administrator**. To run the 4 services under a dedicated least-privilege local account (recommended for production), pass `-ServiceAccount "cptsvc"`:

```powershell
cd "D:\AI Projects\company-phone-tracker"
powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1 -NssmPath .\tools\nssm.exe -ServiceAccount "cptsvc" -KioskUser "KioskUser"
```
*(If `-ServiceAccount` is omitted, `install-services.ps1` defaults to `LocalSystem` and prints a warning.)*

What `scripts\install-services.ps1` does:
1. **Prints NSSM SHA-256**: Computes and prints the SHA-256 of `nssm.exe` (and compares against `$ExpectedWin64Sha256` if filled in).
2. **Configures Clean Windows Shutdown Timeouts**:
   - Sets `HKLM\SYSTEM\CurrentControlSet\Control\WaitToKillServiceTimeout` to `"20000"` (20 seconds).
   - Configures `CPT_DB` with `AppStopMethodConsole = 15000` (15s) and `PreshutdownTimeout = 20000` so PGlite receives `Ctrl+C` (`SIGINT`), flushes its WAL, and logs `"Database shutdown completed cleanly"` before Windows restarts.
3. **Builds Production Assets First**: Runs `npm ci` and `npm run build`, verifying `.next\BUILD_ID` exists. If the build fails, the script aborts immediately.
4. **Configures Least-Privilege Service Account (`-ServiceAccount`)**:
   - Creates or updates the local Windows account (e.g., `cptsvc`).
   - Grants Read & Execute (`RX`) on the project root and Modify (`(OI)(CI)M`) rights on `postgres_data`, `logs`, `backups`, `.next`, `data`, `public\uploads`, and `public\uploads\incident-proofs` (plus directory-level `M` on the project root for DB self-heal archive renames).
   - Grants `SeServiceLogonRight` (*"Log on as a service"*) via `secedit.exe`.
5. **Installs / Updates 4 NSSM Windows Services** (idempotent — safe to re-run on upgrades):
   - **`CPT_DB`**: Runs `node.exe scripts\db-server.mjs` (`SERVICE_AUTO_START`).
   - **`CPT_Web`**: Runs `node.exe node_modules/next/dist/bin/next start -p 5000` (`SERVICE_DELAYED_AUTO_START`, depends on `CPT_DB`).
   - **`CPT_Worker`**: Runs `node.exe scripts\overdue-worker.mjs` (`SERVICE_AUTO_START`, depends on `CPT_DB`).
   - **`CPT_Agent`**: Runs `node.exe agent\reader-agent.mjs` (`SERVICE_AUTO_START`, port `8002`).
   - All 4 services use `AppExit Default Restart`, `AppRestartDelay = 3000`, and 10 MB log rotation in `logs\<service>.log`.
6. **Registers Split Watchdog Scheduled Tasks (No Focus Stealing)**:
   - **`CPT_Service_Watchdog`**: Runs `scripts\kiosk-watchdog.ps1` every **1 minute** under `NT AUTHORITY\SYSTEM` (Session 0, non-interactive, never creates a desktop window). Because it runs as `SYSTEM`, no `sc.exe sdset` permission loosening on `CPT_Web` is needed.
     - If `/api/health` responds with `checks.database.status !== "UP"`, or `127.0.0.1:5432` does not accept TCP for **3 consecutive checks**, it gracefully shuts down `CPT_DB` via `POST http://127.0.0.1:54320/shutdown` and restarts **`CPT_DB`** (not `CPT_Web`).
     - Restarts **`CPT_Web`** only when `/api/health` does not respond at all (connection refused or timeout) **3 times in a row**.
     - Skips any restart decision if the target service's process started less than **180 seconds** ago (startup grace period), and skips `CPT_DB` restarts while `scripts/auto-heal-db.mjs` or `scripts/restore-db.mjs` is running.
     - Enforces a **10-minute cooldown** (max 1 restart per service per 10 minutes) and logs every action to `logs\watchdog.log`.
   - **`CPT_Edge_Watchdog`**: Runs every **2 minutes** in the kiosk user's interactive session via `wscript.exe //B //NoLogo scripts\edge-watchdog.vbs` (window style `0`) and `conhost.exe --headless powershell.exe ... scripts\edge-watchdog.ps1` so no window ever flashes on screen.

### 3.4 Uninstall Services (`scripts/uninstall-services.ps1`)
To cleanly stop and remove all 4 services and unregister the watchdog Scheduled Tasks, run PowerShell **as Administrator**:

```powershell
cd "D:\AI Projects\company-phone-tracker"
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-services.ps1
```

---

## 4. Verification Procedures

### 4.1 Focus-Stealing Verification (5-Minute Continuous NFC Card Tap Test)
Because the USB NFC reader acts as a keyboard wedge, any background process that briefly opens a window in the kiosk user's interactive session will steal keyboard focus from Microsoft Edge and drop card taps.

To verify that neither `CPT_Service_Watchdog` (every 1 minute under `SYSTEM`) nor `CPT_Edge_Watchdog` (every 2 minutes via headless `wscript.exe` / `conhost.exe --headless`) steals focus:
1. Ensure both `CPT_Service_Watchdog` and `CPT_Edge_Watchdog` are enabled in Task Scheduler (`Get-ScheduledTask CPT_*_Watchdog`).
2. Open the kiosk screen (`/kiosk`) in fullscreen Microsoft Edge.
3. Tap NFC cards continuously every few seconds for **5 full minutes** (spanning at least 5 runs of `CPT_Service_Watchdog` and at least 2–3 runs of `CPT_Edge_Watchdog`).
4. Confirm that:
   - No console or PowerShell window ever flashes on screen or on the taskbar.
   - 100% of NFC card taps are captured by `/kiosk` with **zero lost taps**.

### 4.2 Clean Database Shutdown on Windows Reboot (`shutdown /r /t 0`)
To verify that `CPT_DB` flushes its WAL and closes cleanly before Windows terminates services on reboot:
1. While all 4 services (`CPT_DB`, `CPT_Web`, `CPT_Worker`, `CPT_Agent`) are running, trigger an immediate reboot from an Administrator shell:
   ```powershell
   shutdown /r /t 0
   ```
2. After the system boots back up, inspect `logs\CPT_DB.log`:
   ```powershell
   Get-Content "D:\AI Projects\company-phone-tracker\logs\CPT_DB.log" -Tail 40
   ```
3. Confirm that `logs\CPT_DB.log` shows:
   - `[PG-Server] Database shutdown completed cleanly. Zero corruption risk.` recorded right before the reboot.
   - `[PG-Server] PostgreSQL engine initialized successfully.` after the reboot, with **no** `corrupted storage` or `Cleaning stale postmaster.pid` message.

---

## 5. Boot Waiting Page & Kiosk Browser Launcher

Because Edge can launch on boot before `CPT_DB` and `CPT_Web` finish starting, Edge must **never** open `http://localhost:5000` directly on cold boot. Instead, Edge opens the local static boot waiting page on disk:

- **Boot Page (`kiosk-boot\boot.html`)**:
  - Displays a fullscreen **"Starting Phone Tracker…"** screen with a spinner.
  - Polls `http://localhost:5000/api/health` every **3 seconds**.
  - Waits until `/api/health` returns HTTP `200` and reports `checks.database.status === "UP"`.
  - Once healthy, redirects to `http://localhost:5000/api/kiosk/device-login?key=<deviceKey>`, which authenticates the kiosk device, sets the `cpt_session` and `cpt_kiosk_device` cookies, and loads `/kiosk`.
  - If services remain unreachable for **5 minutes**, displays **"System unavailable – contact IT"** while continuing to retry every 3 seconds.

- **Kiosk Launcher (`kiosk-boot\launch-kiosk.bat`)**:
  ```bat
  start "" "%MSEDGE_EXE%" ^
    --kiosk "file:///D:/AI%20Projects/company-phone-tracker/kiosk-boot/boot.html" ^
    --edge-kiosk-type=fullscreen ^
    --no-first-run ^
    --kiosk-idle-timeout-minutes=0 ^
    --disable-pinch ^
    --overscroll-history-navigation=0 ^
    --autoplay-policy=no-user-gesture-required
  ```

---

## 6. Pointing Assigned Access or Shell Launcher at the Kiosk

### Option A: Windows Assigned Access (Single-App Edge Kiosk Mode)
1. Create the dedicated local Windows account (if not already created):
   ```powershell
   net user KioskUser "KioskSecure2026!" /add
   ```
2. Open Windows **Settings** → **Accounts** → **Other users** → **Set up a kiosk** (Assigned access).
3. Select **Get started** and choose `KioskUser`:
   - Choose kiosk app: **Microsoft Edge**.
   - Select kiosk display mode: **As a digital sign or interactive display** (Fullscreen).
   - Enter the local boot waiting page URL:
     ```text
     file:///D:/AI%20Projects/company-phone-tracker/kiosk-boot/boot.html
     ```
4. Re-run `.\scripts\install-services.ps1 -KioskUser KioskUser -ServiceAccount cptsvc` as Administrator so `CPT_Edge_Watchdog` is bound to `KioskUser`.

### Option B: Windows Shell Launcher v1/v2 or Autologon Custom Shell (`kiosk-boot\launch-kiosk.bat`)
1. Configure **Autologon** (Sysinternals `Autologon.exe`) for `KioskUser`.
2. Point the user's custom shell registry value (or Shell Launcher Win32 command) at `launch-kiosk.bat`:
   ```powershell
   Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" `
     -Name "Shell" `
     -Value "cmd.exe /c `"D:\AI Projects\company-phone-tracker\kiosk-boot\launch-kiosk.bat`""
   ```
   In addition, `CPT_Edge_Watchdog` (triggered at logon and every 2 minutes) automatically executes `kiosk-boot\launch-kiosk.bat` whenever `msedge.exe` is not running.
