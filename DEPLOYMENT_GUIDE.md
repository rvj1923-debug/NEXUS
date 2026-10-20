# Company Phone Tracker — Windows Kiosk Deployment Guide

This guide covers building, installing, upgrading, rolling back, and uninstalling the **Company Phone Tracker** Windows installer (`PhoneTrackerSetup-<version>.exe`) for headless kiosk mini PCs.

---

## 1. Architecture & Directory Layout

The installer separates immutable application binaries from persistent runtime data so that upgrades and rollbacks never overwrite database records, backups, logs, or secrets.

| Path | Purpose | Touched on Upgrade? |
| :--- | :--- | :--- |
| `C:\Program Files\PhoneTracker` | Standalone Next.js server (`server.js`), bundled portable `node\node.exe`, Prisma CLI & Windows query engine, PGlite WASM runtime, `agent\`, `kiosk-boot\`, `scripts\`, and `tools\nssm.exe`. | Replaced (previous version archived to `_previous`) |
| `C:\Program Files\PhoneTracker\_previous` | Automatic snapshot of the immediately preceding application version for zero-data-loss rollback. | Rotated on each upgrade |
| `C:\ProgramData\PhoneTracker\.env` | Environment variables (`APP_URL`, `APP_HOST`, `KIOSK_CODE`, etc.) and 64-hex cryptographic secrets (`SESSION_SECRET`, `KIOSK_DEVICE_SECRET`, `AGENT_PAIRING_SECRET`, `DEPLOYMENT_ID`). | Preserved (only missing keys appended) |
| `C:\ProgramData\PhoneTracker\postgres_data` | PGlite PostgreSQL data directory (`PG_DATA_DIR`). | Preserved (migrated via `prisma db push` without `--accept-data-loss`) |
| `C:\ProgramData\PhoneTracker\backups` | Pre-upgrade and scheduled database JSON snapshots (`BACKUP_DIR`). | Preserved |
| `C:\ProgramData\PhoneTracker\logs` | Service stdout/stderr logs, watchdog logs, and installer logs (`LOG_DIR`). | Preserved |
| `C:\ProgramData\PhoneTracker\data` | Local HR incident JSON store (`DATA_DIR`). | Preserved |
| `C:\ProgramData\PhoneTracker\uploads` | Uploaded incident proof images (`UPLOAD_DIR`). | Preserved |

---

## 2. Building the Installer

### Prerequisites on the Build Machine
1. **Windows 10/11 x64** with PowerShell 5.1+.
2. **Node.js v24.x** installed on `PATH` (matching the target portable runtime major version).
3. **Official Portable Node.js Windows x64 `.zip`** downloaded from [nodejs.org](https://nodejs.org/en/download) (e.g., `node-v24.20.0-win-x64.zip`).
   - *Note*: `scripts/build-installer.ps1` does **not** download Node.js over the network; you must pass the local `.zip` path via `-NodeZipPath`. The build script prints its SHA-256 hash and verifies that its major version matches your development Node.js version.
4. **Inno Setup 6** (`ISCC.exe`) installed in either:
   - `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` (default for `winget install --id JRSoftware.InnoSetup --scope user`), or
   - `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`.

### Running the Build
From the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1 `
  -NodeZipPath "C:\path\to\node-v24.20.0-win-x64.zip"
```

### What `scripts/build-installer.ps1` Does
1. Reads `version` from `package.json` (e.g., `1.0.1`) and verifies `next.config.mjs` has `output: "standalone"`.
2. Prints the SHA-256 checksum of `-NodeZipPath`.
3. **Clean Build Environment (Zero Dev `.env` Inlining)**: Temporarily isolates `.env*` files outside the repository root, unsets `NEXT_PUBLIC_APP_URL`, `APP_URL`, and all site-specific environment variables, removes stale `.next` build artifacts, and runs `npm ci`, `npx prisma generate`, and `npm run build` (enforcing TypeScript type checking and ESLint).
4. Stages `.next/standalone` (excluding `.next/cache`), `.next/static`, `public/` (excluding `public/uploads/*`), Prisma Client + Windows query engine, Prisma CLI (`prisma db push`), `@electric-sql/pglite` (`.wasm` + `.data`), `@electric-sql/pglite-socket`, `bcryptjs`, `nodemailer`, `tools/nssm.exe`, `agent/reader-agent.mjs`, `kiosk-boot/` (excluding `config.js`), and the 15 runtime scripts into `dist\stage\PhoneTracker`.
5. Extracts `node.exe` from `-NodeZipPath` into `dist\stage\PhoneTracker\node\node.exe`.
6. **Security, Exclusion & Dev `.env` Leak Audit**: Fails the build immediately if any of the following exist in the staged directory:
   - `.env`, `backups/`, `postgres_data/`, `logs/`, `data/`, `public/uploads/*`, `kiosk-boot/config.js`
   - `scripts/seed.mjs` (which also refuses to run when `NODE_ENV=production`)
   - `cleanup-*.mjs`, `test-*.mjs`, `benchmark-*.mjs`, `*_REPORT.md`
   - Any `devDependencies` from `package.json` (other than the `prisma` CLI required for schema migrations)
   - Any occurrence of `"192.168."` or any site-specific value from the developer `.env` (`NEXT_PUBLIC_APP_URL`, `APP_URL`, `DEPLOYMENT_ID`, `SESSION_SECRET`, `KIOSK_DEVICE_SECRET`, `AGENT_PAIRING_SECRET`, `KIOSK_CODE`).
7. Runs an automated standalone smoke test from an external `%TEMP%` directory (starts PGlite, pushes schema, seeds the kiosk account, takes a backup, starts `server.js` from a different working directory, and verifies `GET http://127.0.0.1:5000/api/health` returns `200 OK`).
8. Compiles `installer\PhoneTrackerSetup.iss` into `dist\PhoneTrackerSetup-<version>.exe` and prints its SHA-256 hash.

---

## 3. Windows SmartScreen ("Unknown Publisher" Warning)

Because `PhoneTrackerSetup-<version>.exe` is not signed with a commercial Authenticode code-signing certificate by default, Windows Defender SmartScreen on a target kiosk PC may display a blue **"Windows protected your PC"** dialog when launched interactively.

### Bypassing SmartScreen on Unsigned Builds
1. **In the SmartScreen Dialog**: Click **More info**, verify the application name (`Company Phone Tracker` / `PhoneTrackerSetup-<version>.exe`), and click **Run anyway**.
2. **Via File Properties / PowerShell (Before Running)**:
   If the `.exe` was copied via a browser or SMB share and has the `Zone.Identifier` Alternate Data Stream (Mark-of-the-Web), unblock it in PowerShell:
   ```powershell
   Unblock-File -Path .\PhoneTrackerSetup-1.0.1.exe
   ```
   Verify its integrity before running:
   ```powershell
   Get-FileHash -Path .\PhoneTrackerSetup-1.0.1.exe -Algorithm SHA256
   ```

### Optional: Signing the Installer (Recommended for Enterprise Rollouts)
If your organization has an internal PKI or commercial Authenticode certificate:
```powershell
signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f "C:\path\to\cert.pfx" /p "<CertPassword>" .\dist\PhoneTrackerSetup-1.0.1.exe
```

---

## 4. Fresh Installation on a Kiosk Mini PC

### Prerequisites
- Windows 10/11 Pro or IoT Enterprise x64.
- Administrator privileges (the installer automatically requests UAC elevation).
- Microsoft Edge installed (standard on Windows 10/11).

### Step-by-Step Required Installation Procedure

#### Step 1 (Required): Create the Local `KioskUser` Windows Account
Open an elevated PowerShell prompt (`Run as Administrator`) and create the standard local user account:
```powershell
$Password = Read-Host -AsSecureString "Enter Windows password for KioskUser"
New-LocalUser -Name "KioskUser" -Password $Password -FullName "Phone Tracker Kiosk" -PasswordNeverExpires:$true -UserMayNotChangePassword:$true
Add-LocalGroupMember -Group "Users" -Member "KioskUser"
```

#### Step 2 (Required): Log In Once Manually as `KioskUser` to Finish OOBE & Disable Notifications
1. Sign into Windows interactively as `KioskUser` once so Windows completes its first-login profile setup and any OOBE welcome screens.
2. Disable notifications for `KioskUser` (**Settings → System → Notifications → Off**, or via policy).
   - **Why this is required:** Pop-up toast notifications steal foreground focus from Microsoft Edge, which causes USB keyboard-wedge NFC taps to be lost or dropped.
   - *(Note: The installer also automatically applies the Windows notification-off policies `NoToastApplicationNotification = 1`, `DisableNotificationCenter = 1`, and `KioskUser` `ToastEnabled = 0` in the registry.)*
3. Sign out of `KioskUser` and log back in as **Administrator**.

#### Step 3 (Required): Configure Windows Auto-Login for `KioskUser` with Sysinternals Autologon
**Windows auto-login for `KioskUser` is REQUIRED, not optional.** Without auto-login, any power cut or overnight Windows Update restart stops at the Windows login screen on a headless mini PC where nobody can type the password.
1. Download **Sysinternals Autologon** (`Autologon64.exe`) from Microsoft: `https://learn.microsoft.com/sysinternals/downloads/autologon`.
2. Run `Autologon64.exe` as Administrator, enter `KioskUser`, the mini PC's computer name, and the `KioskUser` password, and click **Enable**.
3. `Autologon` stores the password encrypted as an **LSA secret**. **Do not** use the plaintext `DefaultPassword` registry method under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`.

#### Step 4 (Required): Run `PhoneTrackerSetup-1.0.1.exe` as Administrator
1. Launch `PhoneTrackerSetup-1.0.1.exe` as **Administrator**.
2. Complete the **Kiosk & Network Configuration** wizard page:
   - **Kiosk Station Code (`KIOSK_CODE`)**: Unique identifier for this kiosk station (e.g., `KIOSK-01`).
   - **Web Server Bind Address (`APP_HOST`)**: Defaults to `0.0.0.0` (all interfaces) so supervisors and HR can open 24-hour overdue email links from other PCs on the LAN.
   - **Network URL for email links (`APP_URL`, optional)**: Prefilled automatically with `http://<detected LAN IPv4>:5000` and written to `C:\ProgramData\PhoneTracker\.env` as `APP_URL`.
     - **Changing `APP_URL` later**: Edit `APP_URL` in `C:\ProgramData\PhoneTracker\.env` and run:
       ```powershell
       Restart-Service CPT_Web, CPT_Worker
       ```
   - **Kiosk Windows User Name**: The local Windows account that auto-logs into the desktop (default: `KioskUser`).
   - **Optional Backup Mirror Directory (`BACKUP_MIRROR_DIR`)**: Optional secondary directory (e.g., a mounted NAS share or USB drive) where database backups are mirrored.
3. Complete the **System Administrator Account** wizard page:
   - **Administrator Email**: e.g., `admin@company.local`.
   - **Password & Confirm Password**: Minimum **12 characters** (passed via a temporary file that is wiped and deleted immediately after `create-admin.mjs` finishes; never passed on the command line or logged).
4. Click **Install**. Behind the scenes, the installer:
   - Generates `C:\ProgramData\PhoneTracker\.env` with `NODE_ENV=production`, `APP_URL`, 64-hex CSPRNG secrets (`SESSION_SECRET`, `KIOSK_DEVICE_SECRET`, `AGENT_PAIRING_SECRET`), and a unique `DEPLOYMENT_ID`.
   - Registers and starts the 4 NSSM Windows Services (`CPT_DB`, `CPT_Web`, `CPT_Agent`, `CPT_Worker`) using the bundled `node\node.exe`.
   - Registers the 2 Scheduled Tasks (`CPT_Service_Watchdog` running every 1 minute as `SYSTEM`, and `CPT_Edge_Watchdog` running every 2 minutes in `KioskUser`'s session; if Edge is closed, `CPT_Edge_Watchdog` relaunches it **within about 2 minutes**).
   - Applies kiosk power & notification settings: USB selective suspend disabled, AC monitor and standby timeouts set to `0` (never sleep), `WaitToKillServiceTimeout = 20000` ms, and notification-off registry policies.
   - Waits for `http://localhost:5000/api/health` database check to report `UP`.
   - Seeds the core roles, permissions, and kiosk station account (`seed-kiosk-account.mjs`), creates the System Admin account (`create-admin.mjs`), takes an initial database backup (`backup-db.mjs`), generates `kiosk-boot\config.js`, and registers the Edge kiosk auto-start entry in `HKLM\...\Run\CPT_Edge_Kiosk`.
   - Runs `scripts\release-check.mjs` and displays the verification summary on the final wizard page.

#### Step 5 (Required): Verify Unattended Cold Boot
Reboot or pull power on the mini PC with no keyboard or mouse attached and verify it auto-logs into `KioskUser` and boots straight into `/kiosk` (`Ready to Scan`) with no user input.

---

## 5. Upgrading an Existing Installation

Because `PhoneTrackerSetup.iss` uses a fixed `AppId` GUID (`{8F6E2A1B-4C9D-4E7A-9B3C-1D5F8A2E6C04}`), running a newer `PhoneTrackerSetup-<version>.exe` automatically detects the existing installation in `C:\Program Files\PhoneTracker` and switches to **Upgrade Mode**.

### Downgrade Protection
- If you run an older installer version over a newer installed version, setup **refuses to downgrade** and displays an error message showing the installed version vs. installer version.
- To intentionally force a downgrade, pass `/ALLOWDOWNGRADE` on the command line:
  ```powershell
  .\PhoneTrackerSetup-1.0.0.exe /ALLOWDOWNGRADE
  ```

### What Happens During an Upgrade
1. **Wizard Pages Skipped**: The `KIOSK_CODE`, `APP_HOST`, `APP_URL`, Kiosk User, `BACKUP_MIRROR_DIR`, and Admin Account wizard pages are automatically skipped. Your existing `C:\ProgramData\PhoneTracker\.env` is preserved (any newly introduced environment keys are appended with safe defaults).
2. **What's New Summary**: In interactive mode, the wizard displays a **What's New / Upgrade Summary** page detailing the upgrade steps.
3. **Pre-Upgrade Backup**: While `CPT_DB` is still running, the installer runs `backup-db.mjs` to save a fresh snapshot in `C:\ProgramData\PhoneTracker\backups`.
4. **Clean Service Shutdown**: Stops `CPT_Worker`, `CPT_Agent`, `CPT_Web`, and sends `POST http://127.0.0.1:54320/shutdown` to cleanly flush PGlite to disk before stopping `CPT_DB`.
5. **Previous Version Snapshot (`_previous`)**: Moves the existing `C:\Program Files\PhoneTracker` application files into `C:\Program Files\PhoneTracker\_previous` (retaining only the single most recent previous version).
6. **File Replacement & Safe Schema Migration**:
   - Installs the new application files into `C:\Program Files\PhoneTracker`.
   - Starts `CPT_DB` and runs `prisma db push --skip-generate` **without** `--accept-data-loss`.
   - If `prisma db push` fails or detects any potential data loss (warnings about dropping tables/columns), the installer **automatically aborts the upgrade, restores `C:\Program Files\PhoneTracker\_previous`, restarts all services on the previous version, and reports the error**.
7. **Service Restart & Release Check**: Re-applies NSSM service definitions, starts all services, waits for `/api/health` (`UP`), and runs `release-check.mjs`.

### Interactive Upgrade
Simply run the new installer as Administrator:
```powershell
.\PhoneTrackerSetup-1.0.1.exe
```

### Silent / Remote Upgrade (PowerShell Remoting or RMM Tool)
To push an update silently without any UI prompts or message boxes and write full diagnostic output to `C:\ProgramData\PhoneTracker\logs\install.log`:

```powershell
C:\temp\PhoneTrackerSetup-1.0.1.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\ProgramData\PhoneTracker\logs\install.log"
```

Example via PowerShell Remoting (`Invoke-Command`) to a remote kiosk mini PC:
```powershell
$TargetPC = "KIOSK-MINI-PC-01"
$InstallerLocal = ".\dist\PhoneTrackerSetup-1.0.1.exe"

Copy-Item -Path $InstallerLocal -Destination "\\$TargetPC\C$\Windows\Temp\PhoneTrackerSetup-1.0.1.exe" -Force

Invoke-Command -ComputerName $TargetPC -ScriptBlock {
    $Proc = Start-Process -FilePath "C:\Windows\Temp\PhoneTrackerSetup-1.0.1.exe" `
        -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /LOG="C:\ProgramData\PhoneTracker\logs\install.log"' `
        -Wait -PassThru
    if ($Proc.ExitCode -ne 0) {
        throw "Installer exited with code $($Proc.ExitCode). Check C:\ProgramData\PhoneTracker\logs\install.log"
    }
    Get-Content "C:\ProgramData\PhoneTracker\logs\release-check-latest.log"
}
```

---

## 6. Rollback Procedure

### A. Automatic Rollback (During Upgrade)
If `prisma db push` fails or warns about data loss during an upgrade, the installer automatically:
1. Stops `CPT_DB`.
2. Restores all application binaries and scripts from `C:\Program Files\PhoneTracker\_previous` back to `C:\Program Files\PhoneTracker`.
3. Re-registers and restarts all services (`CPT_DB`, `CPT_Web`, `CPT_Agent`, `CPT_Worker`).
4. Logs the failure in `C:\ProgramData\PhoneTracker\logs\install.log` (and shows an error dialog if run interactively).

### B. Manual Rollback (After an Upgrade)
If you need to manually revert to the previous version (`C:\Program Files\PhoneTracker\_previous`) and optionally restore the pre-upgrade database backup:

Run the following in an **elevated (Administrator) PowerShell** window:

```powershell
$AppDir  = "C:\Program Files\PhoneTracker"
$PrevDir = "C:\Program Files\PhoneTracker\_previous"
$DataDir = "C:\ProgramData\PhoneTracker"

if (-not (Test-Path (Join-Path $PrevDir "server.js"))) {
    throw "No previous version backup found at $PrevDir"
}

# 1. Cleanly stop all services (flushes PGlite via HTTP shutdown endpoint)
& "$AppDir\node\node.exe" "$AppDir\scripts\stop-services.mjs"

# 2. Replace current app files with _previous (preserving unins000.*)
Get-ChildItem -Path $AppDir -Force | Where-Object { $_.Name -ne "_previous" -and $_.Name -notlike "unins*" } | ForEach-Object {
    Remove-Item -Path $_.FullName -Recurse -Force
}
Get-ChildItem -Path $PrevDir -Force | ForEach-Object {
    Move-Item -Path $_.FullName -Destination (Join-Path $AppDir $_.Name) -Force
}
Remove-Item -Path $PrevDir -Recurse -Force

# 3. (Optional) Restore the latest pre-upgrade database snapshot
# Uncomment the two lines below only if you also want to revert database records to the pre-upgrade snapshot:
# Start-Service CPT_DB
# & "$AppDir\node\node.exe" "$AppDir\scripts\restore-db.mjs"

# 4. Restart all services and verify health
powershell -ExecutionPolicy Bypass -File "$AppDir\scripts\install-services.ps1" `
    -NodePath "$AppDir\node\node.exe" `
    -DataDir $DataDir `
    -EnvFilePath "$DataDir\.env" `
    -SkipBuild

& "$AppDir\node\node.exe" "$AppDir\scripts\release-check.mjs"
```

---

## 7. Uninstalling

You can uninstall **Company Phone Tracker** via **Settings → Apps → Installed apps** or by running:

```powershell
"C:\Program Files\PhoneTracker\unins000.exe"
```

### What the Uninstaller Does
1. Cleanly stops `CPT_DB` (via `http://127.0.0.1:54320/shutdown`), `CPT_Web`, `CPT_Agent`, and `CPT_Worker`.
2. Removes all 4 NSSM Windows Services, both Scheduled Watchdog Tasks (`CPT_Service_Watchdog` and `CPT_Edge_Watchdog`), and the `HKLM\...\Run\CPT_Edge_Kiosk` startup entry.
3. Prompts whether to **keep or permanently delete** `C:\ProgramData\PhoneTracker` (database, backups, logs, uploaded proof images, and `.env` secrets):
   - **Default choice is `No` (Keep data)** so accidental uninstalls or reinstalls never destroy production data.
   - In silent uninstall mode (`/VERYSILENT`), `C:\ProgramData\PhoneTracker` is always preserved.
4. Removes `C:\Program Files\PhoneTracker` (including `_previous`).
