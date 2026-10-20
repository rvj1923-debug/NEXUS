# Company Phone Tracker (PHONIX) — Release Acceptance Test Checklist

**Target Hardware & Environment:**
- Dedicated headless kiosk mini PC (no keyboard, no mouse)
- Windows Auto-Login configured for `KioskUser` via **Sysinternals Autologon** (password encrypted as an LSA secret; never the plaintext `DefaultPassword` registry value)
- `KioskUser` first-login / OOBE completed and Windows notifications disabled (`Settings → System → Notifications` off and registry policy applied so pop-ups cannot steal focus from Edge)
- USB NFC keyboard-wedge reader (plus optional local `CPT_Agent` SSE service on `127.0.0.1:8002`)
- Microsoft Edge in fullscreen kiosk mode launched via `kiosk-boot/launch-kiosk.bat` $\rightarrow$ `kiosk-boot/boot.html` $\rightarrow$ `/api/kiosk/device-login`
- Windows Services managed via NSSM: `CPT_DB`, `CPT_Web`, `CPT_Worker`, `CPT_Agent`
- Scheduled Tasks: `CPT_Service_Watchdog` (Session 0 `SYSTEM`, every 1 min) and `CPT_Edge_Watchdog` (kiosk user session via `wscript.exe` window style `0` / `conhost.exe --headless`, every 2 min)

---

## Pre-Flight Automated Check
Run `node scripts/release-check.mjs` on the kiosk mini PC before beginning physical acceptance tests:
- **Expected Result:** `0 FAIL` (`CPT_DB`, `CPT_Web`, `CPT_Worker`, `CPT_Agent` all `RUNNING`; both watchdog tasks registered; `/api/health` `200 OK`; newest backup `< 1h` old with valid SHA-256 and matching `DEPLOYMENT_ID`; demo passwords rejected; `WaitToKillServiceTimeout >= 20000`).
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 1. Cold Boot / Pull Power to Unattended Kiosk Ready State (`pull power → boots to /kiosk with no input`)
- **Steps:**
  1. Disconnect any keyboard and mouse; leave only power, display, network, and the USB NFC reader connected.
  2. Pull the AC power cord (or shut down completely), reconnect power, and turn on the mini PC without touching any input device.
- **Expected Result:**
  - Pull power $\rightarrow$ boots to `/kiosk` with no input: Windows auto-logs into `KioskUser` via Sysinternals Autologon without stopping at the Windows login screen, launches `kiosk-boot/boot.html` in fullscreen Edge kiosk mode, waits for `/api/health` (`database.status === "UP"`), authenticates via `/api/kiosk/device-login`, and lands on `/kiosk` (`IDLE` "Ready to Scan" screen) within **3 minutes** with zero human input and zero notification pop-ups.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 2. Single Tap (Time In / Time Out) & Rapid 4-Phone FIFO Queue
- **Steps:**
  1. Tap one assigned phone's NFC tag once $\rightarrow$ verify Time In confirmation, wait 15+ seconds, tap again $\rightarrow$ verify Time Out confirmation.
  2. Take **4 different assigned phones** and tap their NFC tags rapidly one after another (within ~2 seconds total) without waiting for the confirmation screen to finish between taps.
- **Expected Result:**
  - The first tap processes immediately, and the remaining 3 taps enter the FIFO queue (`Processing 1 of N — please wait` badge appears).
  - Confirmation screens automatically shorten to ~2s while queued taps are waiting.
  - All 4 phones are recorded in the exact order tapped, and all 4 transactions appear in the **Recent Kiosk Activity** sidebar.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 3. USB NFC Reader Unplug (30s) & Reconnect
- **Steps:**
  1. Unplug the USB NFC reader from the mini PC for **30 seconds**.
  2. Observe the kiosk screen while unplugged.
  3. Plug the USB NFC reader back into the mini PC and tap a phone tag.
- **Expected Result:**
  - Within a few seconds of unplugging (when `CPT_Agent` is active), the kiosk displays the reader disconnected warning banner and header status changes to `Reader Offline`.
  - When plugged back in, the warning banner clears automatically without any page reload or user input, header status returns to `Reader Ready`, and the next NFC tap is processed immediately.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 4. Hard Power Loss Mid-Tap & Auto-Recovery
- **Steps:**
  1. Tap a phone NFC tag and immediately pull the mini PC's AC power cable while the tap is processing.
  2. Plug the AC power cable back in and turn on the mini PC without touching any input device.
  3. Check `/kiosk` and log into the admin dashboard from another PC to inspect `/notifications` and `/custody`.
- **Expected Result:**
  - Pull power $\rightarrow$ boots to `/kiosk` with no input and accepts new taps automatically.
  - If `postgres_data` was intact, no restore occurs and all committed transactions remain.
  - If ungraceful power loss corrupted `postgres_data`, `db-server.mjs` archives `postgres_data_corrupted_<timestamp>`, restores the newest valid backup matching `DEPLOYMENT_ID`, logs a `CRITICAL` `DATABASE_AUTO_RESTORED` notification for administrators, and data loss is at most the last **30 minutes** (the backup worker interval).
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 5. Graceful Windows Restart & Clean PGlite Shutdown Log
- **Steps:**
  1. Trigger a normal Windows restart (`Restart-Computer` or Start $\rightarrow$ Restart).
  2. After the system comes back up, inspect `logs\CPT_DB.log`.
- **Expected Result:**
  - `logs\CPT_DB.log` shows `[PG-Server] Received shutdown trigger (...). Flushing WAL and closing cleanly...` followed by `[PG-Server] Database shutdown completed cleanly. Zero corruption risk.` prior to the reboot timestamp, and no corruption/restore is triggered on startup.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 6. Stop `CPT_DB` Service $\rightarrow$ Offline Overlay & Automatic Recovery
- **Steps:**
  1. From an elevated PowerShell session (or remote admin session), stop the database service: `Stop-Service CPT_DB`.
  2. Keep watching the `/kiosk` display for 35+ seconds, and tap a card while the overlay is visible.
  3. Wait up to 60–90 seconds for `CPT_Service_Watchdog` / NSSM to restart `CPT_DB`.
- **Expected Result:**
  - After 30 seconds of database unavailability, the full-screen bilingual **"Temporarily unavailable – please wait / Pansamantalang hindi magamit – mangyaring maghintay"** overlay appears.
  - Tapping a card while the overlay is shown plays the warning chime and shows **"Please wait and tap again"** (taps are never silently lost).
  - `CPT_Service_Watchdog` automatically restarts `CPT_DB`, `/api/health` returns `UP`, and the offline overlay clears automatically.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 7. Kill `msedge.exe` $\rightarrow$ Watchdog Restores Kiosk Browser Within About 2 Minutes
- **Steps:**
  1. Terminate Microsoft Edge (`taskkill /F /IM msedge.exe`).
  2. Wait up to **2 minutes** without touching the mini PC.
- **Expected Result:**
  - `CPT_Edge_Watchdog` detects `msedge` is not running and relaunches `kiosk-boot/launch-kiosk.bat` headlessly (no console window flash).
  - Edge opens in fullscreen kiosk mode, authenticates via `boot.html` $\rightarrow$ `/api/kiosk/device-login`, and returns to `/kiosk` **within about 2 minutes**.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 8. Stop `CPT_Web` for 5 Minutes $\rightarrow$ Safe-Reload & Watchdog Recovery (No Edge Error Page)
- **Steps:**
  1. Disable the service watchdog temporarily or pause `CPT_Web` so `CPT_Web` stays down for **5 minutes**.
  2. Observe the `/kiosk` screen while `CPT_Web` is stopped.
  3. Start `CPT_Web` again (or re-enable `CPT_Service_Watchdog`).
- **Expected Result:**
  - While `CPT_Web` is unreachable, `safeReload()` refuses to call `window.location.reload()`, so Edge **never** navigates to its built-in `"Hmmm… can't reach this page"` error screen; the kiosk page and its offline overlay remain rendered in the DOM.
  - Once `CPT_Web` is reachable again, the offline overlay clears and the kiosk returns to `IDLE` automatically without anyone touching the PC (and if Edge had ever been stranded on an error page, `CPT_Edge_Watchdog` restarts Edge via `launch-kiosk.bat` within about 2 minutes).
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 9. Disable Kiosk in `/admin/kiosks` $\rightarrow$ Maintenance Lock & Re-Enable Recovery
- **Steps:**
  1. On another PC, log into `/admin/kiosks` as `SYSTEM_ADMIN` and change the kiosk device status from `ACTIVE` to `INACTIVE` or `MAINTENANCE`.
  2. Tap a card on the kiosk (or wait for the next config/keepalive poll).
  3. Change the kiosk device status back to `ACTIVE` in `/admin/kiosks` and wait up to 30 seconds.
- **Expected Result:**
  - When disabled, `/api/kiosk/resolve` returns `503 KIOSK_MAINTENANCE` (or `/api/kiosk/keepalive` returns `403` and redirects to `/kiosk/not-provisioned?reason=device_inactive`), displaying a full-screen maintenance/deactivated lock screen.
  - When re-enabled in `/admin/kiosks`, the kiosk automatically recovers back to the `/kiosk` `IDLE` screen within 30 seconds without human intervention on the mini PC.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 10. Continuous Tapping for 5 Minutes (Zero Focus Stealing / Notifications Disabled)
- **Steps:**
  1. Tap phone NFC cards every 5–10 seconds continuously across a **5-minute** window (spanning multiple 1-minute `CPT_Service_Watchdog` and 2-minute `CPT_Edge_Watchdog` executions).
- **Expected Result:**
  - Every tap is captured by the global `window` keydown wedge listener.
  - No console window or Windows notification toast ever flashes on screen, Edge never loses foreground focus, and 0 taps are dropped or partially truncated.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 11. 9+ Hours Unattended Overnight Soak Test
- **Steps:**
  1. Leave the kiosk running unattended overnight (**9+ hours**).
  2. The next morning, without touching the mini PC, inspect the display and tap a phone NFC tag.
- **Expected Result:**
  - The screen is awake (no sleep/screensaver/lock screen), the 30-day Kiosk JWT session is still valid and auto-renewed, the **Recent Kiosk Activity** sidebar is up to date, and the morning tap processes immediately.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 12. Admin Dashboard Login & Per-Account Lockout from Another PC
- **Steps:**
  1. From another PC on the LAN, open `http://<kiosk-lan-ip>:5000/login`.
  2. Attempt to log in to an account with **6 wrong passwords** in a row (even if spoofing different `X-Forwarded-For` headers).
  3. Log in with a valid `SYSTEM_ADMIN` account that has not been locked out.
- **Expected Result:**
  - After 5 failed attempts, the 6th attempt returns HTTP `429 Too Many Requests` (`15-minute` lockout for that email address, ignoring fake `X-Forwarded-For` headers).
  - Valid admin login succeeds and opens `/dashboard`.
- **Status:** `[ ] Pass` / `[ ] Fail`

---

## 13. LAN Security Check from Another PC (Port 8002 Closed & Kiosk APIs Protected)
- **Steps:**
  1. From another PC on the LAN, test connecting to `http://<kiosk-lan-ip>:8002/api/agent/status`.
  2. From the other PC, send an unauthenticated `POST http://<kiosk-lan-ip>:5000/api/kiosk/resolve` with body `{"cardUid":"0114156366"}`.
- **Expected Result:**
  - Connection to `<kiosk-lan-ip>:8002` is **refused / unreachable** (agent is bound to `127.0.0.1` only).
  - Unauthenticated `POST /api/kiosk/resolve` returns HTTP `401 Unauthorized` and does not Time In or Time Out any phone.
- **Status:** `[ ] Pass` / `[ ] Fail`
