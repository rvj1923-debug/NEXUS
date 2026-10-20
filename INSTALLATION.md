# Installation & Setup Guide
**Company Phone Tracker — Enterprise Asset Custody Platform**

This guide covers:
1. **Production Windows Kiosk Installation (`PhoneTrackerSetup-<version>.exe`)** — One-click installer for headless kiosk mini PCs (no pre-installed Node.js or database required).
2. **Upgrading, Rolling Back, and Uninstalling** on production kiosk mini PCs.
3. **Developer / Source Setup** — Running from source for local development.

> For full installer build instructions (`scripts/build-installer.ps1`), architecture details, and remote PowerShell deployment, see [DEPLOYMENT_GUIDE.md](file:///D:/AI%20Projects/company-phone-tracker/DEPLOYMENT_GUIDE.md).

---

## Part 1: Production Kiosk Installation (`PhoneTrackerSetup-1.0.1.exe`)

### 1. System Requirements (Kiosk Mini PC)
- **Operating System:** Windows 10 Pro / Enterprise or Windows 11 Pro / IoT Enterprise (64-bit)
- **Privileges:** Local Administrator (required to install Windows services, scheduled tasks, notification policies, and power settings)
- **Browser:** Microsoft Edge (pre-installed on Windows 10/11)
- **Disk Space:** Minimum 2 GB free (`C:\Program Files\PhoneTracker` for app binaries + `C:\ProgramData\PhoneTracker` for database, backups, and logs)
- **Hardware:** USB NFC Reader connected via a direct motherboard USB port

---

### 2. Required Pre-Installation Preparation on the Mini PC

#### Required Step 1: Create the Local Kiosk Windows User Account (`KioskUser`)
Open an elevated PowerShell prompt (`Run as Administrator`) and create the standard local user account that will run the fullscreen kiosk session (default name: `KioskUser`):
```powershell
$Password = Read-Host -AsSecureString "Enter Windows password for KioskUser"
New-LocalUser -Name "KioskUser" -Password $Password -FullName "Phone Tracker Kiosk" -PasswordNeverExpires:$true -UserMayNotChangePassword:$true
Add-LocalGroupMember -Group "Users" -Member "KioskUser"
```

#### Required Step 2: Log In Once Manually as `KioskUser` to Finish First-Login / OOBE & Disable Notifications
**This step is REQUIRED.** Before enabling unattended mode, sign into Windows interactively as `KioskUser` once:
1. Complete all Windows first-login / OOBE welcome animations and privacy prompts so they never block the kiosk screen later.
2. Disable Windows notifications for `KioskUser`:
   - Open **Settings → System → Notifications** and turn **Notifications** **Off** (or apply via group/registry policy — note that `PhoneTrackerSetup-1.0.1.exe` and `scripts\install-services.ps1` also automatically apply the machine-wide and `KioskUser` registry policies `NoToastApplicationNotification = 1`, `DisableNotificationCenter = 1`, and `ToastEnabled = 0`).
   - **Why this matters:** USB NFC keyboard-wedge readers type card UIDs into the active foreground window. Any Windows toast pop-up or notification banner stealing focus from Microsoft Edge will cause lost or truncated NFC taps.
3. Sign out of `KioskUser` and log back into your **Administrator** account to run the installer.

#### Required Step 3: Configure Windows Auto-Login for `KioskUser` via Sysinternals Autologon
**Windows auto-login for `KioskUser` is REQUIRED, not optional.** Because the kiosk mini PC runs headless (no keyboard or mouse attached), without Windows auto-login any power cut, brownout, or overnight Windows Update restart will stop at the Windows sign-in screen and nobody will be able to type the password.

- **Use Microsoft Sysinternals `Autologon.exe` (Recommended):**
  1. Download Sysinternals **Autologon** from Microsoft (`https://learn.microsoft.com/sysinternals/downloads/autologon`).
  2. Run `Autologon64.exe` as Administrator.
  3. Enter:
     - **Username:** `KioskUser`
     - **Domain:** *(the mini PC's local computer name)*
     - **Password:** *(the `KioskUser` password)*
  4. Click **Enable**. `Autologon` encrypts and stores the password securely as a Local Security Authority (**LSA**) secret in the Windows security subsystem.
- **WARNING — Do NOT use the plaintext registry method:** Never set `DefaultPassword` in `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon` manually or via `reg add`, as that stores the password in cleartext in the registry.

#### Optional Step 4: Assign a Static LAN IPv4 Address
If department supervisors or HR administrators will open 24-hour overdue email links or access the web dashboard from their own PCs on the LAN, configure a static IPv4 address (or DHCP reservation) on the mini PC before running the installer so the detected `APP_URL` never changes.

---

### 3. Step-by-Step Interactive Installation

#### Step 5: Copy and Launch `PhoneTrackerSetup-1.0.1.exe` as Administrator
1. Copy `dist\PhoneTrackerSetup-1.0.1.exe` to the target mini PC.
2. **Bypass Windows SmartScreen (Unsigned Builds):**
   - If Windows Defender SmartScreen displays **"Windows protected your PC"**, click **More info** → **Run anyway**.
   - Or unblock the file in PowerShell before launching:
     ```powershell
     Unblock-File -Path .\PhoneTrackerSetup-1.0.1.exe
     ```
3. Right-click `PhoneTrackerSetup-1.0.1.exe` and select **Run as administrator**.

#### Step 6: Wizard Page 1 — Kiosk & Network Configuration
- **Kiosk Station Code (`KIOSK_CODE`):** Enter the unique station identifier for this kiosk (e.g., `KIOSK-01`).
- **Web Server Bind Address (`APP_HOST`):**
  - Keep `0.0.0.0` (default) so Department Supervisors and HR can open 24-hour overdue approval links in emails from other PCs on the LAN. Setting `127.0.0.1` restricts web access to this mini PC only.
- **Network URL for email links (`APP_URL`, optional):**
  - Automatically prefilled with `http://<detected LAN IPv4>:5000`.
  - Written to `C:\ProgramData\PhoneTracker\.env` as `APP_URL` and read at runtime by the web server and overdue notification worker when generating links in emails.
  - **How to change `APP_URL` later:** Edit `APP_URL="http://<new-ip-or-host>:5000"` in `C:\ProgramData\PhoneTracker\.env` and restart the web and worker services:
    ```powershell
    Restart-Service CPT_Web, CPT_Worker
    ```
- **Kiosk Windows User Name:** Enter the Windows username that runs the kiosk display session (default: `KioskUser`).
- **Optional Backup Mirror Directory (`BACKUP_MIRROR_DIR`):** *(Optional)* Browse to or enter a secondary directory (such as a USB drive or NAS share) where database backups are mirrored automatically. Leave blank to skip.

#### Step 7: Wizard Page 2 — System Administrator Account
- **Administrator Email Address:** Enter the initial `SYSTEM_ADMIN` login email (e.g., `admin@company.local`).
- **Administrator Full Name:** Enter the display name (e.g., `System Administrator`).
- **Password & Confirm Password:** Enter a strong password of **at least 12 characters**.
- *Security Note:* Your password is passed via a temporary file that is overwritten and deleted immediately after `create-admin.mjs` completes; it is never exposed on a process command line or written to installation logs.

#### Step 8: Automated Provisioning & Final Release Check Page
During installation, the wizard automatically:
- Installs application binaries and the bundled portable Node.js v24 runtime into `C:\Program Files\PhoneTracker`.
- Creates persistent data directories in `C:\ProgramData\PhoneTracker` (`postgres_data`, `backups`, `logs`, `data`, `uploads`).
- Generates `C:\ProgramData\PhoneTracker\.env` with `NODE_ENV=production`, `APP_URL`, a unique `DEPLOYMENT_ID`, and three 64-hex cryptographic secrets (`SESSION_SECRET`, `KIOSK_DEVICE_SECRET`, `AGENT_PAIRING_SECRET`).
- Registers and starts the 4 NSSM Windows Services (`CPT_DB`, `CPT_Web`, `CPT_Agent`, `CPT_Worker`) and the 2 self-healing scheduled tasks (`CPT_Service_Watchdog` every 1 minute as `SYSTEM`, and `CPT_Edge_Watchdog` every 2 minutes as `KioskUser`).
- Applies Windows power & focus policies: disables USB selective suspend on AC power, sets monitor and standby timeouts to `0` on AC power, sets `WaitToKillServiceTimeout = 20000` ms, and applies notification-off registry policies for the machine and `KioskUser`.
- Pushes the Prisma database schema to PGlite, seeds the core roles/permissions and kiosk station account, creates your System Administrator account, takes an initial verified backup snapshot, generates `C:\Program Files\PhoneTracker\kiosk-boot\config.js`, and registers the Edge kiosk launcher in `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\CPT_Edge_Kiosk`.
- Runs `scripts\release-check.mjs` and displays its summary on the final wizard page.

---

### 4. Post-Installation Verification & Unattended Reboot Test

#### Step 9: Verify Services, Health Endpoint & Admin Dashboard
1. **Verify Windows Services:**
   ```powershell
   Get-Service CPT_DB, CPT_Web, CPT_Worker, CPT_Agent
   ```
   All four services should show `Status: Running`.
2. **Verify Health Endpoint:**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:5000/api/health" | ConvertTo-Json -Depth 5
   ```
   Confirm `status` is `"OK"` and `checks.database.status` is `"UP"`.
3. **Verify Watchdog Recovery Timing:**
   - If Microsoft Edge (`msedge.exe`) is ever closed or crashes, `CPT_Edge_Watchdog` automatically relaunches the fullscreen kiosk browser **within about 2 minutes**.

#### Step 10: Test Full Unattended Boot (Pull Power → Boots to `/kiosk` With No Input)
1. Disconnect the keyboard and mouse from the mini PC (leaving only power, monitor, network, and the USB NFC reader connected).
2. Reboot or pull power and turn the mini PC back on.
3. Verify that Windows automatically signs in as `KioskUser` via Sysinternals Autologon, launches `kiosk-boot\boot.html` in fullscreen Microsoft Edge, authenticates via `/api/kiosk/device-login`, and lands on `/kiosk` (`Ready to Scan`) with zero human input.

---

## Part 2: Upgrading, Rolling Back & Uninstalling

### 1. Upgrading an Existing Installation
Running a newer `PhoneTrackerSetup-<version>.exe` on a machine with an existing installation automatically triggers **Upgrade Mode** (detected via the fixed `AppId` `{8F6E2A1B-4C9D-4E7A-9B3C-1D5F8A2E6C04}`):
- **Downgrade Protection:** Installing an older version over a newer version is blocked unless `/ALLOWDOWNGRADE` is passed on the command line.
- **Preserves Configuration & Data:** Skips the `KIOSK_CODE`, `APP_HOST`, `APP_URL`, and Admin Account wizard pages, shows only the **What's New** page, and preserves `C:\ProgramData\PhoneTracker` (`.env`, database, backups, logs, uploads).
- **Safe Migration & Auto-Rollback:** Takes a backup with `backup-db.mjs`, shuts down services cleanly (`http://127.0.0.1:54320/shutdown`), saves the previous application folder to `C:\Program Files\PhoneTracker\_previous`, and runs `prisma db push` **without** `--accept-data-loss`. If schema migration would lose data or fails, the installer automatically restores `_previous` and restarts the old version.

#### Silent Remote Upgrade Command
```powershell
PhoneTrackerSetup-1.0.1.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\ProgramData\PhoneTracker\logs\install.log"
```

### 2. Changing `APP_URL` After Installation
To update the network URL used in supervisor/HR email links at any time without reinstalling:
1. Open `C:\ProgramData\PhoneTracker\.env` in Notepad as Administrator.
2. Update `APP_URL="http://<new-lan-ip-or-hostname>:5000"`.
3. Restart `CPT_Web` and `CPT_Worker` in an elevated PowerShell prompt:
   ```powershell
   Restart-Service CPT_Web, CPT_Worker
   ```

### 3. Rolling Back to the Previous Version
If you need to manually roll back to `C:\Program Files\PhoneTracker\_previous` after an upgrade, see Section 6 of [DEPLOYMENT_GUIDE.md](file:///D:/AI%20Projects/company-phone-tracker/DEPLOYMENT_GUIDE.md).

### 4. Uninstalling
Run **Settings → Apps → Installed apps → Company Phone Tracker → Uninstall** (or run `"C:\Program Files\PhoneTracker\unins000.exe"` as Administrator):
- Stops and removes all `CPT_*` Windows services, scheduled watchdog tasks, and Edge startup registry entries.
- Prompts whether to keep or delete `C:\ProgramData\PhoneTracker` (**defaults to Keep** so production data is never deleted accidentally).

---

## Part 3: Developer / Source Setup (Local Development)

### 1. Prerequisites
- **Node.js:** `v24.x` (Tested on `v24.20.0`)
- **Package Manager:** `npm` v10+ (Tested on `v11.19.0`)

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```

### 3. Install Dependencies & Initialize Database
```powershell
npm ci
node scripts/db-server.mjs
```
In a second terminal:
```powershell
npx prisma generate
npx prisma db push
```

### 4. Seed Development Data
*(Note: `scripts/seed.mjs` is strictly for development and refuses to run when `NODE_ENV=production`.)*
```powershell
node scripts/seed.mjs
```

### 5. Start the Development Server
```powershell
npm run dev
```
Open `http://localhost:5000`.
