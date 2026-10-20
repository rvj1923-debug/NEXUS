# Azure Deployment Guide
**Company Phone Tracker: moving the server to an Azure virtual machine**

This guide moves the web app, database and overdue email worker from the kiosk mini PC to a Windows VM in Azure. The kiosk PCs keep the USB NFC reader and the full-screen Edge kiosk. After the move they open the Azure address instead of `localhost`.

---

## 1. How it works after the move

```
 Kiosk mini PC (at the gate)                     Azure VM (Windows Server)
 ┌──────────────────────────────┐   HTTPS 443    ┌────────────────────────────────────┐
 │ Edge kiosk  ─────────────────┼───────────────▶│ Caddy (HTTPS, port 443)            │
 │   ▲ card number typed as     │                │   └─▶ CPT_Web  (127.0.0.1:5000)    │
 │   │ keystrokes               │                │        CPT_DB  (PGlite database)   │
 │ USB NFC reader               │                │        CPT_Worker (overdue emails) │
 │ CPT_Agent (127.0.0.1:8002)   │                │        backups, logs, uploads      │
 └──────────────────────────────┘                └────────────────────────────────────┘
 Supervisors / HR / admins open the same HTTPS address from any browser.
```

- **Card taps keep working.** The NFC reader acts like a keyboard and types the card number into the kiosk page in Edge. The page sends the tap to the server. The local agent (`CPT_Agent`) is optional.
- **The kiosk needs internet.** If the site's internet goes down, the kiosk can't check phones in or out until it comes back.
- **The deployment role** is set by `CPT_ROLE` in `C:\ProgramData\PhoneTracker\.env`:

| `CPT_ROLE` | Used on | What runs there |
|---|---|---|
| `ALL` (default) | Original single-PC kiosk | Database, web, worker, agent and Edge kiosk |
| `SERVER` | Azure VM | Database, web and worker. No Edge kiosk, port 5000 is not opened, and the server doesn't check the NFC agent. |
| `KIOSK` | Each kiosk PC after the move | The NFC agent and the Edge kiosk only, pointing at `KIOSK_SERVER_URL` |

Two scripts set the role for you: `scripts\configure-azure-server.ps1` and `scripts\configure-kiosk-client.ps1`.

---

## 2. Before you start

### 2.1 Fix the security issues first (important)
[QA_AUDIT_REPORT_2026-10-19.md](QA_AUDIT_REPORT_2026-10-19.md) lists **3 Critical** and **4 High** issues that are **not fixed yet**. Two of them matter most on a public server:
- `GET /api/kiosk/device-login` gives a kiosk session to **anyone** who opens it (C1).
- The whole `/api/overdue/*` API needs **no login** (C2).

On an Azure VM with a public IP, anyone on the internet can reach these. **Fix at least C1, C2 and H1–H4 before you point real users at the Azure address.** Until then, either leave the VM with no public HTTPS access, or restrict it to your office IPs (see 3.3).

### 2.2 What you need
| Item | Notes |
|---|---|
| Azure subscription | Permission to create a VM, public IP and network security group (NSG) |
| A new installer build | `PhoneTrackerSetup-1.0.6.exe` or later, built from this repository (see 2.3). Older builds don't include the Azure scripts. |
| A DNS name | Your own domain (e.g. `phonetracker.company.com`) or the free Azure DNS label (`<name>.<region>.cloudapp.azure.com`) |
| SMTP account | For overdue emails. Azure blocks outbound port 25, so use port **587** (the app's default). |
| A quiet time window | About 1–2 hours with no phone check-ins while the data moves |

### 2.3 Build the installer with the Azure changes
On the build machine (see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md#2-building-the-installer)):
1. In `package.json`, change `version` to `1.0.6` or later.
2. Build:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1 -NodeZipPath "C:\path\to\node-v24.20.0-win-x64.zip"
   ```
3. The output is `dist\PhoneTrackerSetup-1.0.6.exe`.

### 2.4 Only one database moves
The database is restored from **one** PC's backup. If several kiosk PCs each run their own database today, only one of them can be moved; these tools can't merge databases. Pick the PC with the live data.

---

## 3. Create the Azure VM

### 3.1 VM settings (Azure Portal → Virtual machines → Create)
| Setting | Value |
|---|---|
| Region | The region closest to your site (e.g. Southeast Asia for the Philippines) |
| Image | **Windows Server 2022 Datacenter** or **2025 Datacenter** (x64) |
| Size | **Standard B2ms** (2 vCPU, 8 GB RAM). Minimum: B2s (2 vCPU, 4 GB). |
| OS disk | **128 GB Standard SSD** (or Premium SSD P10) |
| Administrator account | A strong password, stored in your password manager |
| Public inbound ports | None for now (you'll add NSG rules in 3.3) |
| Auto-shutdown | **Off** (the server must run 24/7 for kiosks and the overdue worker) |
| Backup | **Enable Azure Backup** (daily). The app's own backups are on the same disk as the database. |

Rough monthly cost: about USD 120–140 for B2ms Windows pay-as-you-go, or about 50–60 for B2s. Check the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/); a 1-year reservation costs less.

### 3.2 Static public IP and DNS name
1. VM → **Networking** → click the public IP → **Configuration**.
2. Set **Assignment** to **Static**.
3. Set a **DNS name label**, e.g. `cpt-tracker` → `cpt-tracker.southeastasia.cloudapp.azure.com`.
4. If you use your own domain, add a DNS **A record** (e.g. `phonetracker.company.com`) pointing at the static IP.

### 3.3 Network security group (inbound rules)
| Priority | Port | Source | Purpose |
|---|---|---|---|
| 100 | 443 (TCP) | Internet, or your office public IPs only | HTTPS for kiosks and staff |
| 110 | 80 (TCP) | Internet | Lets Caddy get and renew the HTTPS certificate |
| 120 | 3389 (TCP) | **Your admin IP only** (or use Azure Bastion instead) | Remote Desktop |

**Do not** open 5000, 5432, 54320 or 8002.

> If you restrict 80 and 443 to office IPs, Let's Encrypt can't verify the server and Caddy can't get a free certificate. In that case, use a certificate from your IT team instead (see 6.3).

---

## 4. Install the app on the VM

1. Connect with Remote Desktop and copy `PhoneTrackerSetup-1.0.6.exe` to the VM.
2. Run it as Administrator. In the wizard:
   - **Kiosk Station Code**: the code your kiosk uses today (e.g. `PHONE-KIOSK-01`).
   - **Web Server Bind Address (`APP_HOST`)**: `127.0.0.1`
   - **Network URL (`APP_URL`)**: your HTTPS address, e.g. `https://phonetracker.company.com`
   - **Kiosk Windows User Name**: leave the default. The next step removes the kiosk parts on the server.
   - **System Administrator Account**: any temporary admin. If you restore your existing data in step 7, your existing accounts replace it.
3. Finish the wizard. Ignore release-check warnings about the agent or Edge; the next step changes those.

---

## 5. Convert the VM into the central server

In an **elevated PowerShell** on the VM:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\PhoneTracker\scripts\configure-azure-server.ps1" -PublicUrl "https://phonetracker.company.com"
```

The script:
- writes `CPT_ROLE=SERVER`, `APP_URL`, `PUBLIC_APP_URL`, `APP_HOST=127.0.0.1`, `TRUST_PROXY=true` and `DISABLE_PUBLIC_TUNNEL=true` to `.env`
- stops the automatic Cloudflare quick tunnel. Email links then use your Azure address instead of a random `trycloudflare.com` one.
- removes the Edge kiosk launcher and watchdog, and the port 5000 firewall rule
- restarts the services and waits until `http://127.0.0.1:5000/api/health` reports the database `UP`

You can run it again at any time, for example after changing the address.

---

## 6. Set up HTTPS with Caddy

Caddy is a small web server that handles HTTPS and renews the certificate automatically.

### 6.1 Install
1. Download **Caddy for Windows amd64** from <https://caddyserver.com/download> and save it as `C:\caddy\caddy.exe`.
2. Copy [deploy/azure/Caddyfile](deploy/azure/Caddyfile) to `C:\caddy\Caddyfile`, then replace `phonetracker.example.com` with your DNS name.

### 6.2 Run Caddy as a Windows service
In an elevated PowerShell:
```powershell
$Nssm = "C:\Program Files\PhoneTracker\tools\nssm.exe"
& $Nssm install Caddy "C:\caddy\caddy.exe" run --config "C:\caddy\Caddyfile"
& $Nssm set Caddy AppDirectory "C:\caddy"
& $Nssm set Caddy AppStdout "C:\caddy\caddy.log"
& $Nssm set Caddy AppStderr "C:\caddy\caddy.log"
& $Nssm set Caddy Start SERVICE_AUTO_START
New-NetFirewallRule -DisplayName "Caddy HTTP/HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
Start-Service Caddy
```

Open `https://<your-dns-name>/login` in a browser. You should get a valid certificate and the login page. If not, check `C:\caddy\caddy.log`. The usual causes are DNS not pointing at the VM, or port 80/443 blocked in the NSG.

### 6.3 Using your own certificate instead (optional)
In the Caddyfile, add a line inside the site block:
```
tls C:\caddy\cert.pem C:\caddy\key.pem
```

---

## 7. Move the existing data

Do this when nobody is checking phones in or out.

### 7.1 On the current kiosk PC (the one with the live data)
In an elevated PowerShell:
```powershell
# Stop new check-ins and emails, but keep the database running for the backup
Stop-Service CPT_Web, CPT_Worker

cd "C:\Program Files\PhoneTracker"
$env:ENV_FILE_PATH = "C:\ProgramData\PhoneTracker\.env"
.\node\node.exe scripts\backup-db.mjs
```

Copy these to a USB drive or a secure file share:
- the newest `C:\ProgramData\PhoneTracker\backups\cpt_backup_<date>.json` **and** its `.json.sha256` file
- the folder `C:\ProgramData\PhoneTracker\uploads\` (incident proof photos)
- the folder `C:\ProgramData\PhoneTracker\data\` (HR incident reports)

### 7.2 On the Azure VM
1. Copy the backup files into `C:\ProgramData\PhoneTracker\backups\`.
2. Copy `uploads\` and `data\` into `C:\ProgramData\PhoneTracker\`, replacing the empty ones.
3. Restore, in an elevated PowerShell:
   ```powershell
   Stop-Service CPT_Web, CPT_Worker

   cd "C:\Program Files\PhoneTracker"
   $env:ENV_FILE_PATH = "C:\ProgramData\PhoneTracker\.env"
   $Backup = "C:\ProgramData\PhoneTracker\backups\cpt_backup_<date>.json"

   .\node\node.exe scripts\restore-db.mjs $Backup --dry-run   # checks the file, writes nothing
   .\node\node.exe scripts\restore-db.mjs $Backup             # replaces the database contents

   Start-Service CPT_Worker, CPT_Web
   ```
4. Log in at `https://<your-dns-name>/login` with your **existing** admin account. Check that employees, phones and the open custody records are there.

### 7.3 Email settings
SMTP settings saved in the app (Overdue → email settings) come across with the database. Send a test notification and check that its links start with your Azure address.

---

## 8. Convert each kiosk PC

Do these steps on **every** kiosk PC.

1. **Upgrade it to the new installer first.** Run `PhoneTrackerSetup-1.0.6.exe` as Administrator. It stays in `ALL` role and works as before, and now includes the new scripts.
2. On the **Azure VM**, open `C:\ProgramData\PhoneTracker\.env` and copy the value of `KIOSK_DEVICE_SECRET`.
3. On the kiosk PC, in an elevated PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "C:\Program Files\PhoneTracker\scripts\configure-kiosk-client.ps1" -ServerUrl "https://phonetracker.company.com"
   ```
   Type `YES` when asked, then paste the `KIOSK_DEVICE_SECRET` when prompted. The input is hidden.

   The script:
   - checks that the server is reachable
   - takes a final local backup
   - writes `CPT_ROLE=KIOSK`, `KIOSK_SERVER_URL` and `KIOSK_DEVICE_SECRET` to `.env`
   - sets the Edge policy `LocalNetworkAccessAllowedForUrls`, so the Azure page can reach the local agent without a browser prompt
   - removes the local `CPT_DB`, `CPT_Web` and `CPT_Worker` services. The local data folder stays on disk.
   - rewrites `kiosk-boot\config.js` so Edge opens the Azure address
4. **Restart the kiosk PC.** It should log in automatically and show **Ready to Scan**, loaded from the Azure address.
5. Tap a test card and check that a Time In / Time Out works.

---

## 9. Final checks

| Check | Expected |
|---|---|
| `https://<dns>/api/health` | `"database": {"status": "UP"}`, `"nfcAgent": {"status": "REMOTE"}` |
| Kiosk after a cold reboot | Boots straight into the kiosk with no keyboard or mouse |
| Card tap at each kiosk | Time In / Time Out recorded; visible in the dashboard |
| Overdue email | Links open `https://<dns>/...`, not a LAN IP or `trycloudflare.com` |
| Staff login from outside the office | Works over HTTPS |
| `edge://policy` on a kiosk | `LocalNetworkAccessAllowedForUrls` lists the server address |
| Azure Backup | First backup job succeeded |

---

## 10. After go-live

### Updating the app
- Run new installer versions **on the Azure VM only**. The `.env` (including `CPT_ROLE=SERVER`) is kept on upgrade.
- **Don't run the installer on kiosk PCs** after converting them. They only run the agent and Edge, and the installer would try to start the local database service that the kiosk script removed. The kiosk page always loads the latest version from the server.

### Backups
- The app takes database backups into `C:\ProgramData\PhoneTracker\backups` on the VM.
- For an off-VM copy, mount an **Azure Files** share and set `BACKUP_MIRROR_DIR` in `.env` to that path, then restart `CPT_Web` and `CPT_Worker`.
- Keep Azure Backup enabled for the whole VM.

### Moving a kiosk back to standalone (rollback)
On the kiosk PC: set `CPT_ROLE="ALL"` in `C:\ProgramData\PhoneTracker\.env`, then run:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\PhoneTracker\scripts\install-services.ps1" -NodePath "C:\Program Files\PhoneTracker\node\node.exe" -DataDir "C:\ProgramData\PhoneTracker" -SkipBuild
```
This recreates the local services, but they use the **old local database** from before the move. To bring current data back, restore a backup taken on the server.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Kiosk stuck on "Starting Phone Tracker… / System unavailable" | The kiosk can't reach `https://<dns>/api/health`. Check internet, DNS, the NSG 443 rule and the Caddy service. Make sure `KIOSK_SERVER_URL` in the kiosk's `.env` is right, then re-run `configure-kiosk-client.ps1`. |
| Browser certificate error | Caddy couldn't get a certificate. Check `C:\caddy\caddy.log`, port 80 open in the NSG, and the DNS record pointing at the VM. |
| Email links show a LAN IP or `trycloudflare.com` | Re-run `configure-azure-server.ps1`. It sets `PUBLIC_APP_URL` and `DISABLE_PUBLIC_TUNNEL=true`. Then restart `CPT_Worker` and `CPT_Web`. |
| Edge shows a "local network access" prompt on the kiosk | The policy is missing. Check `edge://policy`, then re-run `configure-kiosk-client.ps1`. Card taps still work through keyboard input. |
| Settings → Readers shows "Agents run on kiosk PCs" | Expected on the server. Each kiosk's agent is checked by the kiosk page itself. |
| Logs | VM: `C:\ProgramData\PhoneTracker\logs\CPT_Web.log`, `CPT_DB.log`, `CPT_Worker.log`, and `C:\caddy\caddy.log`. Kiosk: `CPT_Agent.log` and `watchdog.log`. |

---

## 12. Known limitations

- **One kiosk code for all kiosks.** Kiosk login uses the server's `KIOSK_CODE`, so every kiosk PC appears as the same kiosk station. Per-kiosk codes would need a code change in `src/app/api/kiosk/device-login/route.ts`.
- **Internet dependency.** There's no offline mode. If the site's internet or Azure is down, kiosks show "System unavailable" until the connection returns.
- **Security findings.** Section 2.1 still applies until the audit's Critical and High findings are fixed.
