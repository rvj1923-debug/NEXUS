#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Production Windows Services & Split Watchdog Installer (NSSM)
.DESCRIPTION
    Run as Administrator.
    1. Prints and verifies the SHA-256 hash of the NSSM binary (recommended: 2.24-101-g897c7ad).
    2. Sets HKLM\SYSTEM\CurrentControlSet\Control\WaitToKillServiceTimeout to "20000" (20s).
    3. Runs `npm ci` and `npm run build` (aborts if either fails).
    4. Optionally configures a dedicated least-privilege local service account (-ServiceAccount,
       e.g. "cptsvc") with Modify rights on project folders (postgres_data, logs, backups, .next)
       and SeServiceLogonRight ("Log on as a service"). Warns if defaulting to LocalSystem.
    5. Installs or updates 4 Windows Services via NSSM:
       - CPT_DB     (node.exe scripts/db-server.mjs)                         [Auto-Start, clean shutdown]
       - CPT_Web    (node.exe node_modules/next/dist/bin/next start -p 5000) [Delayed Auto-Start, depends on CPT_DB]
       - CPT_Worker (node.exe scripts/overdue-worker.mjs)                    [Auto-Start, depends on CPT_DB]
       - CPT_Agent  (node.exe agent/reader-agent.mjs)                        [Auto-Start]
    6. Registers split Scheduled Tasks so no window ever flashes or steals keyboard-wedge focus:
       - CPT_Service_Watchdog : Runs every 1 minute under SYSTEM (Session 0, non-interactive).
       - CPT_Edge_Watchdog    : Runs every 2 minutes under the kiosk user via wscript.exe (window style 0)
                                and conhost.exe --headless.
.PARAMETER NssmPath
    Path to nssm.exe. Defaults to .\tools\nssm.exe relative to the project root.
.PARAMETER KioskUser
    Windows username for the kiosk desktop session that runs CPT_Edge_Watchdog.
    Defaults to local 'KioskUser' if present, otherwise the current user ($env:USERNAME).
.PARAMETER ServiceAccount
    Optional local Windows account name (e.g. "cptsvc") to run the 4 services with least privilege.
    If omitted, services run as LocalSystem and a warning is displayed.
.PARAMETER ServicePassword
    Optional password for -ServiceAccount. If -ServiceAccount does not exist yet and -ServicePassword
    is omitted, a random 32-character password is generated automatically.
#>

param(
    [string]$NssmPath = ".\tools\nssm.exe",
    [string]$NodePath = "",
    [string]$DataDir = "",
    [string]$EnvFilePath = "",
    [switch]$SkipBuild,
    [switch]$NoStart,
    [string]$KioskUser = "",
    [string]$ServiceAccount = "",
    [string]$ServicePassword = ""
)

$ErrorActionPreference = "Stop"

# 1. Verify Administrator privileges
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "install-services.ps1 must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location -Path $ProjectRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  COMPANY PHONE TRACKER - WINDOWS SERVICE INSTALLER (NSSM)" -ForegroundColor Cyan
Write-Host "  Project Root: $ProjectRoot" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 2. Resolve NSSM executable path and print SHA-256
if ([System.IO.Path]::IsPathRooted($NssmPath)) {
    $ResolvedNssm = $NssmPath
} else {
    $ResolvedNssm = Join-Path $ProjectRoot $NssmPath
}

if (-not (Test-Path $ResolvedNssm)) {
    $PathNssm = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
    if ($null -ne $PathNssm) {
        $ResolvedNssm = $PathNssm.Source
    } else {
        Write-Error "NSSM executable not found at '$ResolvedNssm'. Provide -NssmPath or place nssm.exe in .\tools\nssm.exe."
        exit 1
    }
}
$ResolvedNssm = (Resolve-Path $ResolvedNssm).Path
$NssmHash = (Get-FileHash -Path $ResolvedNssm -Algorithm SHA256).Hash.ToUpperInvariant()
$ExpectedWin64Sha256 = "" # fill in after verifying the downloaded nssm.exe

Write-Host "[INFO] Using NSSM: $ResolvedNssm" -ForegroundColor Green
Write-Host "[INFO] NSSM SHA-256: $NssmHash" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($ExpectedWin64Sha256)) {
    Write-Host "[INFO] ExpectedWin64Sha256 is not set; skipping hash comparison." -ForegroundColor Yellow
} elseif ($NssmHash -eq $ExpectedWin64Sha256.Trim().ToUpperInvariant()) {
    Write-Host "[INFO] Verified NSSM SHA-256 matches ExpectedWin64Sha256." -ForegroundColor Green
} else {
    Write-Warning "NSSM SHA-256 ($NssmHash) does not match ExpectedWin64Sha256 ($ExpectedWin64Sha256)."
}

# 3. Configure Windows SCM WaitToKillServiceTimeout = 20000 ms and Kiosk Power Settings
Write-Host "[INFO] Setting HKLM:\SYSTEM\CurrentControlSet\Control\WaitToKillServiceTimeout = 20000..." -ForegroundColor Cyan
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control" -Name "WaitToKillServiceTimeout" -Value "20000" -Type String

Write-Host "[INFO] Applying kiosk AC power settings (USB selective suspend OFF, monitor/standby timeouts = 0)..." -ForegroundColor Cyan
$PrevEapPower = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 *> $null
& powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba4d5a0 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 *> $null
& powercfg.exe /change monitor-timeout-ac 0 *> $null
& powercfg.exe /change standby-timeout-ac 0 *> $null
& powercfg.exe /SETACTIVE SCHEME_CURRENT *> $null
$ErrorActionPreference = $PrevEapPower

# 4. Resolve node.exe path directly (prefer bundled node.exe, never use npx for services)
$NodeExe = ""
if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
    $CandidateNode = if ([System.IO.Path]::IsPathRooted($NodePath)) { $NodePath } else { Join-Path $ProjectRoot $NodePath }
    if (Test-Path $CandidateNode) {
        $NodeExe = (Resolve-Path $CandidateNode).Path
    } else {
        Write-Error "Specified -NodePath '$NodePath' not found."
        exit 1
    }
} elseif (Test-Path (Join-Path $ProjectRoot "node\node.exe")) {
    $NodeExe = (Resolve-Path (Join-Path $ProjectRoot "node\node.exe")).Path
} elseif (Test-Path (Join-Path $ProjectRoot "node.exe")) {
    $NodeExe = (Resolve-Path (Join-Path $ProjectRoot "node.exe")).Path
} else {
    $NodeCmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($null -eq $NodeCmd) {
        Write-Error "node.exe not found in .\node\node.exe or PATH. Ensure Node.js 24+ is bundled or installed."
        exit 1
    }
    $NodeExe = $NodeCmd.Source
}
Write-Host "[INFO] Using Node.js: $NodeExe" -ForegroundColor Green

# 5. Resolve Data Directory (C:\ProgramData\PhoneTracker for installed layout, or ProjectRoot in dev)
$IsStandaloneLayout = (Test-Path (Join-Path $ProjectRoot "server.js")) -and (-not (Test-Path (Join-Path $ProjectRoot "src\app")))
if ([string]::IsNullOrWhiteSpace($DataDir)) {
    if (-not [string]::IsNullOrWhiteSpace($env:CPT_DATA_DIR)) {
        $DataDir = $env:CPT_DATA_DIR.Trim()
    } elseif ($IsStandaloneLayout -or (Test-Path "C:\ProgramData\PhoneTracker\.env")) {
        $DataDir = "C:\ProgramData\PhoneTracker"
    } else {
        $DataDir = $ProjectRoot
    }
}
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
$DataDir = (Resolve-Path $DataDir).Path
Write-Host "[INFO] Using Data Directory: $DataDir" -ForegroundColor Green

if ([string]::IsNullOrWhiteSpace($EnvFilePath)) {
    if (-not [string]::IsNullOrWhiteSpace($env:ENV_FILE_PATH)) {
        $EnvFilePath = $env:ENV_FILE_PATH.Trim()
    } else {
        $EnvFilePath = Join-Path $DataDir ".env"
    }
}

function Get-EnvFileValue {
    param([string]$Key, [string]$Default = "")
    if (Test-Path $EnvFilePath) {
        foreach ($Line in (Get-Content $EnvFilePath -ErrorAction SilentlyContinue)) {
            if ($Line -match "^\s*$([Regex]::Escape($Key))\s*=\s*(.*)\s*$") {
                $Val = $Matches[1].Trim().Trim('"').Trim("'")
                if (-not [string]::IsNullOrWhiteSpace($Val)) { return $Val }
            }
        }
    }
    return $Default
}

# Deployment role (CPT_ROLE in .env):
#   ALL    = web server + database + NFC agent + Edge kiosk on this PC (default, original kiosk layout)
#   SERVER = central server (e.g. Azure VM): database, web, worker; no Edge kiosk, port 5000 not opened
#   KIOSK  = kiosk PC pointing at a central server: NFC agent + Edge kiosk only, no local database/web
$Role = (Get-EnvFileValue -Key "CPT_ROLE" -Default "ALL").ToUpperInvariant()
if ($Role -notin @("ALL", "SERVER", "KIOSK")) {
    Write-Warning "Unknown CPT_ROLE '$Role' in .env; using ALL."
    $Role = "ALL"
}
$KioskServerUrl = (Get-EnvFileValue -Key "KIOSK_SERVER_URL" -Default "http://localhost:5000").TrimEnd("/")
Write-Host "[INFO] Deployment role (CPT_ROLE): $Role" -ForegroundColor Green

$PgDataDir = Join-Path $DataDir "postgres_data"
$LogDir = Join-Path $DataDir "logs"
$BackupDir = Join-Path $DataDir "backups"
$AppDataSubDir = Join-Path $DataDir "data"
$UploadDir = if ($DataDir -eq $ProjectRoot) { Join-Path $ProjectRoot "public\uploads" } else { Join-Path $DataDir "uploads" }

$WritableDirs = @(
    $PgDataDir,
    $LogDir,
    $BackupDir,
    $AppDataSubDir,
    $UploadDir,
    (Join-Path $UploadDir "incident-proofs")
)
foreach ($Dir in $WritableDirs) {
    if (-not (Test-Path $Dir)) {
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    }
}
# Ensure KioskUser / local Users can write to logs\watchdog.log and logs\edge-watchdog-state.json
& icacls.exe $LogDir /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q | Out-Null

# 6. Ensure kiosk-boot/config.js exists (populate from .env KIOSK_DEVICE_SECRET if missing)
#    and ensure AGENT_PAIRING_SECRET (at least 32 chars) exists in .env without printing its value.
$BootConfigPath = Join-Path $ProjectRoot "kiosk-boot\config.js"
if (-not (Test-Path $EnvFilePath)) {
    New-Item -ItemType File -Path $EnvFilePath -Force | Out-Null
}
$ExistingPairingSecret = ""
$EnvLines = @(Get-Content $EnvFilePath -ErrorAction SilentlyContinue)
$HasPairingSecretLine = $false
foreach ($Line in $EnvLines) {
    if ($Line -match "^\s*AGENT_PAIRING_SECRET\s*=\s*(.*)\s*$") {
        $HasPairingSecretLine = $true
        $ExistingPairingSecret = $Matches[1].Trim().Trim('"').Trim("'")
        break
    }
}
if ([string]::IsNullOrWhiteSpace($ExistingPairingSecret) -or $ExistingPairingSecret.Length -lt 32) {
    $SecretBytes = New-Object byte[] 32
    $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $Rng.GetBytes($SecretBytes)
    $Rng.Dispose()
    $GeneratedPairingSecret = ([System.BitConverter]::ToString($SecretBytes)).Replace("-", "").ToLowerInvariant()
    if ($HasPairingSecretLine) {
        $UpdatedEnvLines = foreach ($Line in $EnvLines) {
            if ($Line -match "^\s*AGENT_PAIRING_SECRET\s*=") {
                "AGENT_PAIRING_SECRET=`"$GeneratedPairingSecret`""
            } else {
                $Line
            }
        }
        Set-Content -Path $EnvFilePath -Value ($UpdatedEnvLines -join [Environment]::NewLine) -Encoding UTF8
    } else {
        Add-Content -Path $EnvFilePath -Value "AGENT_PAIRING_SECRET=`"$GeneratedPairingSecret`"" -Encoding UTF8
    }
    Write-Host "[INFO] Generated AGENT_PAIRING_SECRET in .env." -ForegroundColor Green
}

if (Test-Path $EnvFilePath) {
    $DeviceSecret = ""
    foreach ($Line in (Get-Content $EnvFilePath)) {
        if ($Line -match "^\s*KIOSK_DEVICE_SECRET\s*=\s*(.+)\s*$") {
            $DeviceSecret = $Matches[1].Trim().Trim('"').Trim("'")
            break
        }
    }
    if ($Role -ne "SERVER" -and $DeviceSecret -and (-not (Test-Path $BootConfigPath) -or $IsStandaloneLayout -or $Role -eq "KIOSK")) {
        $BootDir = Split-Path -Parent $BootConfigPath
        if (-not (Test-Path $BootDir)) {
            New-Item -ItemType Directory -Path $BootDir -Force | Out-Null
        }
        $ConfigLines = @(
            "// Local kiosk device configuration (gitignored).",
            "window.CPT_KIOSK_CONFIG = {",
            "  baseUrl: `"$KioskServerUrl`",",
            "  deviceKey: `"$DeviceSecret`",",
            "};",
            "window.KIOSK_DEVICE_SECRET = window.CPT_KIOSK_CONFIG.deviceKey;"
        )
        Set-Content -Path $BootConfigPath -Value ($ConfigLines -join [Environment]::NewLine) -Encoding UTF8
        Write-Host "[INFO] Generated kiosk-boot\config.js from .env KIOSK_DEVICE_SECRET." -ForegroundColor Green
    }
}

# 7. Stop existing services before build / update so file locks are released
$ServiceNames = @("CPT_Web", "CPT_Worker", "CPT_Agent", "CPT_DB")
foreach ($Svc in $ServiceNames) {
    $Existing = Get-Service -Name $Svc -ErrorAction SilentlyContinue
    if ($null -ne $Existing -and $Existing.Status -ne "Stopped") {
        Write-Host "[INFO] Stopping existing service $Svc..." -ForegroundColor Yellow
        if ($Svc -eq "CPT_DB") {
            try {
                Invoke-WebRequest -Uri "http://127.0.0.1:54320/shutdown" -Method Post -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null
                Start-Sleep -Seconds 2
            } catch {}
        }
        Stop-Service -Name $Svc -Force -ErrorAction SilentlyContinue
    }
}

# 8. Run `npm ci` and `npm run build` unless -SkipBuild or standalone prebuilt layout
if ($Role -eq "KIOSK") {
    Write-Host "`n[STEP 1-2/4] Skipping build: KIOSK role runs only the NFC agent and Edge (web app is on $KioskServerUrl)." -ForegroundColor Cyan
} elseif ($SkipBuild -or $IsStandaloneLayout) {
    Write-Host "`n[STEP 1-2/4] Skipping npm ci & npm run build (using prebuilt standalone bundle)." -ForegroundColor Cyan
} else {
    Write-Host "`n[STEP 1/4] Running npm ci..." -ForegroundColor Cyan
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm ci failed with exit code $LASTEXITCODE. Aborting service installation."
        exit $LASTEXITCODE
    }

    Write-Host "`n[STEP 2/4] Running npm run build..." -ForegroundColor Cyan
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm run build failed with exit code $LASTEXITCODE. Aborting service installation."
        exit $LASTEXITCODE
    }
}

$BuildIdPath = Join-Path $ProjectRoot ".next\BUILD_ID"
if ($Role -ne "KIOSK") {
    if (-not (Test-Path $BuildIdPath)) {
        Write-Error "Production build verification failed (.next\BUILD_ID is missing). Aborting service installation."
        exit 1
    }
    Write-Host "[INFO] Production build verified (.next\BUILD_ID: $((Get-Content $BuildIdPath -Raw -ErrorAction SilentlyContinue).Trim()))." -ForegroundColor Green
}

# 9. Configure Service Account (Least Privilege vs LocalSystem default)
function Grant-LogOnAsServiceRight {
    param([string]$AccountName)
    $NtAccount = New-Object System.Security.Principal.NTAccount($AccountName)
    $Sid = $NtAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value

    $TempDir = [System.IO.Path]::GetTempPath()
    $ExportInf = Join-Path $TempDir "cpt_sec_export_$PID.inf"
    $ImportInf = Join-Path $TempDir "cpt_sec_import_$PID.inf"
    $SecDb = Join-Path $TempDir "cpt_sec_$PID.sdb"

    try {
        & secedit.exe /export /cfg $ExportInf /areas USER_RIGHTS | Out-Null
        $ExportContent = Get-Content -Path $ExportInf -Encoding Unicode -ErrorAction Stop
        $CurrentSids = ""
        foreach ($Line in $ExportContent) {
            if ($Line -match "^\s*SeServiceLogonRight\s*=\s*(.+)\s*$") {
                $CurrentSids = $Matches[1].Trim()
                break
            }
        }

        if ($CurrentSids -notmatch [Regex]::Escape("*$Sid")) {
            if ([string]::IsNullOrWhiteSpace($CurrentSids)) {
                $NewSids = "*$Sid"
            } else {
                $NewSids = "$CurrentSids,*$Sid"
            }
            $InfLines = @(
                "[Unicode]",
                "Unicode=yes",
                "[Version]",
                "signature=`"`$CHICAGO`$`"",
                "Revision=1",
                "[Privilege Rights]",
                "SeServiceLogonRight = $NewSids"
            )
            Set-Content -Path $ImportInf -Value ($InfLines -join "`r`n") -Encoding Unicode
            & secedit.exe /configure /db $SecDb /cfg $ImportInf /areas USER_RIGHTS /quiet | Out-Null
            Write-Host "[INFO] Granted SeServiceLogonRight ('Log on as a service') to $AccountName ($Sid)." -ForegroundColor Green
        } else {
            Write-Host "[INFO] Account $AccountName ($Sid) already has SeServiceLogonRight." -ForegroundColor Green
        }
    } finally {
        Remove-Item -Path $ExportInf, $ImportInf, $SecDb -Force -ErrorAction SilentlyContinue
    }
}

$UseCustomServiceAccount = -not [string]::IsNullOrWhiteSpace($ServiceAccount)
$ResolvedServiceAccount = ""
if (-not $UseCustomServiceAccount) {
    Write-Warning "No -ServiceAccount specified. Services will run as LocalSystem (NT AUTHORITY\SYSTEM). For least-privilege production deployment, re-run with -ServiceAccount 'cptsvc'."
} else {
    $ShortAccount = $ServiceAccount
    if ($ShortAccount.StartsWith(".\")) {
        $ShortAccount = $ShortAccount.Substring(2)
    }
    $ResolvedServiceAccount = ".\$ShortAccount"

    if ([string]::IsNullOrWhiteSpace($ServicePassword)) {
        Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
        $Chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+"
        $Rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
        $Bytes = New-Object byte[](28)
        $Rng.GetBytes($Bytes)
        $Generated = "Cpt!9aA"
        foreach ($b in $Bytes) {
            $Generated += $Chars[$b % $Chars.Length]
        }
        $ServicePassword = $Generated
    }

    $SecurePassword = ConvertTo-SecureString $ServicePassword -AsPlainText -Force
    $ExistingUser = Get-LocalUser -Name $ShortAccount -ErrorAction SilentlyContinue
    if ($null -eq $ExistingUser) {
        Write-Host "[INFO] Creating dedicated local service user '$ShortAccount'..." -ForegroundColor Cyan
        New-LocalUser -Name $ShortAccount `
            -Password $SecurePassword `
            -FullName "Company Phone Tracker Service Account" `
            -Description "Least-privilege service account for CPT_DB, CPT_Web, CPT_Worker, and CPT_Agent." `
            -PasswordNeverExpires `
            -UserMayNotChangePassword | Out-Null
    } else {
        Write-Host "[INFO] Updating password and flags for existing local service user '$ShortAccount'..." -ForegroundColor Cyan
        Set-LocalUser -Name $ShortAccount -Password $SecurePassword -PasswordNeverExpires $true
        Enable-LocalUser -Name $ShortAccount -ErrorAction SilentlyContinue
    }

    # Grant Read & Execute on ProjectRoot and Modify rights on writable folders
    Write-Host "[INFO] Configuring least-privilege ACLs on project and data folders for '$ShortAccount'..." -ForegroundColor Cyan
    & icacls.exe $ProjectRoot /grant "${ShortAccount}:(OI)(CI)RX" /T /C /Q | Out-Null
    & icacls.exe $DataDir /grant "${ShortAccount}:(OI)(CI)M" /T /C /Q | Out-Null
    foreach ($Dir in $WritableDirs) {
        if (-not (Test-Path $Dir)) {
            New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        }
        & icacls.exe $Dir /grant "${ShortAccount}:(OI)(CI)M" /T /C /Q | Out-Null
    }

    Grant-LogOnAsServiceRight -AccountName $ShortAccount
}

# 10. Install / Update the 4 NSSM Services (Idempotent)
Write-Host "`n[STEP 3/4] Installing and configuring NSSM services..." -ForegroundColor Cyan

$TenMegabytes = 10485760 # 10 * 1024 * 1024 bytes

# Resolve APP_HOST from environment or .env (default 0.0.0.0)
$AppHost = if (-not [string]::IsNullOrWhiteSpace($env:APP_HOST)) { $env:APP_HOST.Trim() } else { "0.0.0.0" }
if (Test-Path $EnvFilePath) {
    foreach ($Line in (Get-Content $EnvFilePath)) {
        if ($Line -match "^\s*APP_HOST\s*=\s*(.+)\s*$") {
            $ParsedHost = $Matches[1].Trim().Trim('"').Trim("'")
            if (-not [string]::IsNullOrWhiteSpace($ParsedHost)) {
                $AppHost = $ParsedHost
            }
            break
        }
    }
}
[Environment]::SetEnvironmentVariable("APP_HOST", $AppHost, "Machine")

$WebParams = if (Test-Path (Join-Path $ProjectRoot "server.js")) {
    "server.js"
} elseif (Test-Path (Join-Path $ProjectRoot ".next\standalone\server.js")) {
    ".next\standalone\server.js"
} else {
    "node_modules/next/dist/bin/next start -p 5000 -H %APP_HOST%"
}

$Services = @(
    @{
        Name        = "CPT_DB"
        DisplayName = "Company Phone Tracker - PostgreSQL (PGlite)"
        Description = "Embedded PostgreSQL (PGlite) database engine on 127.0.0.1:5432 for Company Phone Tracker."
        Params      = "scripts\db-server.mjs"
        StartType   = "SERVICE_AUTO_START"
        DependsOn   = $null
        IsDatabase  = $true
    },
    @{
        Name        = "CPT_Web"
        DisplayName = "Company Phone Tracker - Next.js Web Server"
        Description = "Next.js 15 production web server on port 5000 for Company Phone Tracker."
        Params      = $WebParams
        StartType   = "SERVICE_AUTO_START"
        DependsOn   = "CPT_DB"
        IsDatabase  = $false
    },
    @{
        Name        = "CPT_Worker"
        DisplayName = "Company Phone Tracker - Overdue Monitoring Worker"
        Description = "Background worker for 24-hour overdue phone detection and daily scheduled reports."
        Params      = "scripts\overdue-worker.mjs"
        StartType   = "SERVICE_AUTO_START"
        DependsOn   = "CPT_DB"
        IsDatabase  = $false
    },
    @{
        Name        = "CPT_Agent"
        DisplayName = "Company Phone Tracker - NFC Reader Agent"
        Description = "Local USB NFC Reader hardware bridge agent on 127.0.0.1:8002."
        Params      = "agent\reader-agent.mjs"
        StartType   = "SERVICE_AUTO_START"
        DependsOn   = $null
        IsDatabase  = $false
    }
)

if ($Role -eq "KIOSK") {
    # Remove local server services left over from an all-in-one install (already stopped above).
    # The data folder (database, backups, logs) is kept on disk.
    foreach ($OldSvc in @("CPT_Web", "CPT_Worker", "CPT_DB")) {
        if ($null -ne (Get-Service -Name $OldSvc -ErrorAction SilentlyContinue)) {
            Write-Host "  -> Removing local service $OldSvc (KIOSK role uses $KioskServerUrl)..." -ForegroundColor Yellow
            & $ResolvedNssm remove $OldSvc confirm | Out-Null
        }
    }
    $Services = @($Services | Where-Object { $_.Name -eq "CPT_Agent" })
}

$BaseEnvExtra = @(
    "NODE_ENV=production",
    "TZ=Asia/Manila",
    "ENV_FILE_PATH=$EnvFilePath",
    "PG_DATA_DIR=$PgDataDir",
    "BACKUP_DIR=$BackupDir",
    "LOG_DIR=$LogDir",
    "DATA_DIR=$AppDataSubDir",
    "UPLOAD_DIR=$UploadDir",
    "APP_HOST=$AppHost",
    "HOSTNAME=$AppHost",
    "PORT=5000"
)

foreach ($Svc in $Services) {
    $Name = $Svc.Name
    $LogFile = Join-Path $LogDir "$Name.log"
    $ExistingSvc = Get-Service -Name $Name -ErrorAction SilentlyContinue

    if ($null -eq $ExistingSvc) {
        Write-Host "  -> Installing service $Name..." -ForegroundColor Cyan
        & $ResolvedNssm install $Name $NodeExe $Svc.Params
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to install service $Name via NSSM."
            exit 1
        }
    } else {
        Write-Host "  -> Updating existing service $Name..." -ForegroundColor Yellow
        & $ResolvedNssm set $Name Application $NodeExe
        & $ResolvedNssm set $Name AppParameters $Svc.Params
    }

    if ($Name -eq "CPT_Agent") {
        $AgentEnvExtra = $BaseEnvExtra + @("AGENT_HOST=127.0.0.1")
        & $ResolvedNssm set $Name AppEnvironmentExtra @AgentEnvExtra
    } else {
        & $ResolvedNssm set $Name AppEnvironmentExtra @BaseEnvExtra
    }

    & $ResolvedNssm set $Name DisplayName $Svc.DisplayName
    & $ResolvedNssm set $Name Description $Svc.Description
    & $ResolvedNssm set $Name AppDirectory $ProjectRoot
    & $ResolvedNssm set $Name Start $Svc.StartType
    & $ResolvedNssm set $Name AppExit Default Restart
    & $ResolvedNssm set $Name AppRestartDelay 3000

    # Stdout & Stderr logging with 10MB rotation
    & $ResolvedNssm set $Name AppStdout $LogFile
    & $ResolvedNssm set $Name AppStderr $LogFile
    & $ResolvedNssm set $Name AppStdoutCreationDisposition 4
    & $ResolvedNssm set $Name AppStderrCreationDisposition 4
    & $ResolvedNssm set $Name AppRotateFiles 1
    & $ResolvedNssm set $Name AppRotateOnline 1
    & $ResolvedNssm set $Name AppRotateBytes $TenMegabytes

    # Service dependencies (CPT_Web and CPT_Worker depend on CPT_DB)
    if ($Svc.DependsOn) {
        & $ResolvedNssm set $Name DependOnService $Svc.DependsOn
    } else {
        & $ResolvedNssm reset $Name DependOnService | Out-Null
    }

    # Service account configuration
    if ($UseCustomServiceAccount) {
        & $ResolvedNssm set $Name ObjectName $ResolvedServiceAccount $ServicePassword
    } else {
        & $ResolvedNssm reset $Name ObjectName | Out-Null
    }

    # Graceful console Ctrl+C shutdown for CPT_DB so PGlite flushes WAL and closes cleanly on stop/reboot
    if ($Svc.IsDatabase) {
        & $ResolvedNssm set $Name AppStopMethodSkip 0
        & $ResolvedNssm set $Name AppStopMethodConsole 15000
        & $ResolvedNssm set $Name AppStopMethodWindow 2000
        & $ResolvedNssm set $Name AppStopMethodThreads 2000
        $SvcRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$Name"
        if (Test-Path $SvcRegPath) {
            Set-ItemProperty -Path $SvcRegPath -Name "PreshutdownTimeout" -Value 20000 -Type DWord -ErrorAction SilentlyContinue
        }
    } else {
        & $ResolvedNssm set $Name AppStopMethodSkip 0
        & $ResolvedNssm set $Name AppStopMethodConsole 5000
    }
}

# 11. Register Split Watchdog Scheduled Tasks & Edge Kiosk Launcher (No Focus Stealing)
Write-Host "`n[STEP 4/4] Registering Split Watchdog Scheduled Tasks & Kiosk Launcher..." -ForegroundColor Cyan

# Remove legacy single CPT_Kiosk_Watchdog task if present
$LegacyTask = Get-ScheduledTask -TaskName "CPT_Kiosk_Watchdog" -ErrorAction SilentlyContinue
if ($null -ne $LegacyTask) {
    Unregister-ScheduledTask -TaskName "CPT_Kiosk_Watchdog" -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[INFO] Removed legacy 'CPT_Kiosk_Watchdog' Scheduled Task." -ForegroundColor Yellow
}

# 11a. Service Health Watchdog: CPT_Service_Watchdog (Runs under SYSTEM in Session 0 every 1 minute, no window)
$ServiceWatchdogScript = Join-Path $ProjectRoot "scripts\kiosk-watchdog.ps1"
$ServiceTaskName = "CPT_Service_Watchdog"

if ($Role -eq "KIOSK") {
    # No local database or web server to watch on a KIOSK-role PC
    if ($null -ne (Get-ScheduledTask -TaskName $ServiceTaskName -ErrorAction SilentlyContinue)) {
        Unregister-ScheduledTask -TaskName $ServiceTaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "[INFO] Removed '$ServiceTaskName' (KIOSK role has no local database/web server)." -ForegroundColor Yellow
    }
} else {

$ServiceAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ServiceWatchdogScript`"" `
    -WorkingDirectory $ProjectRoot

$ServiceTriggerRepeat = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(-1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)

$ServiceTriggerBoot = New-ScheduledTaskTrigger -AtStartup

$ServicePrincipal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

$ServiceSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $ServiceTaskName `
    -Action $ServiceAction `
    -Trigger @($ServiceTriggerRepeat, $ServiceTriggerBoot) `
    -Principal $ServicePrincipal `
    -Settings $ServiceSettings `
    -Description "Every 1 minute under SYSTEM (Session 0, no window): checks TCP 127.0.0.1:5432 and /api/health; restarts CPT_DB or CPT_Web after 3 consecutive failures with 10-minute cooldown." `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $ServiceTaskName -ErrorAction SilentlyContinue | Out-Null

Write-Host "[INFO] Scheduled Task '$ServiceTaskName' registered under SYSTEM (every 1 minute, non-interactive)." -ForegroundColor Green
}

# 11b. Edge Kiosk Browser Watchdog: CPT_Edge_Watchdog (Runs under KioskUser every 2 minutes, headless zero-window)
$EdgeWatchdogVbs = Join-Path $ProjectRoot "scripts\edge-watchdog.vbs"
$EdgeTaskName = "CPT_Edge_Watchdog"
if ($Role -eq "SERVER") {
    # A central server has no kiosk screen: remove the Edge kiosk watchdog and auto-start launchers
    if ($null -ne (Get-ScheduledTask -TaskName $EdgeTaskName -ErrorAction SilentlyContinue)) {
        Unregister-ScheduledTask -TaskName $EdgeTaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "CPT_Edge_Kiosk" -ErrorAction SilentlyContinue
    $CommonStartupDirSrv = [Environment]::GetFolderPath("CommonStartup")
    if ($CommonStartupDirSrv) {
        Remove-Item -Path (Join-Path $CommonStartupDirSrv "CPT_Edge_Kiosk.cmd") -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[INFO] SERVER role: skipped Edge kiosk watchdog and launcher (removed if previously installed)." -ForegroundColor Yellow
} else {
if ([string]::IsNullOrWhiteSpace($KioskUser)) {
    $LocalKioskAccount = Get-LocalUser -Name "KioskUser" -ErrorAction SilentlyContinue
    if ($null -ne $LocalKioskAccount) {
        $KioskUser = "KioskUser"
    } else {
        $KioskUser = $env:USERNAME
    }
} else {
    # Verify that the specified KioskUser resolves on this machine; if not, fall back to current user so task registration succeeds
    $ResolvedUserOk = $false
    try {
        $NtAcct = New-Object System.Security.Principal.NTAccount($KioskUser)
        $null = $NtAcct.Translate([System.Security.Principal.SecurityIdentifier])
        $ResolvedUserOk = $true
    } catch {
        $ResolvedUserOk = $false
    }
    if (-not $ResolvedUserOk) {
        Write-Warning "Local user '$KioskUser' does not exist on this machine yet; registering CPT_Edge_Watchdog under '$($env:USERNAME)'."
        $KioskUser = $env:USERNAME
    }
}

$EdgeAction = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "//B //NoLogo `"$EdgeWatchdogVbs`"" `
    -WorkingDirectory $ProjectRoot

$EdgeTriggerRepeat = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(-1) `
    -RepetitionInterval (New-TimeSpan -Minutes 2)

$EdgeTriggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $KioskUser

$EdgePrincipal = New-ScheduledTaskPrincipal `
    -UserId $KioskUser `
    -LogonType Interactive `
    -RunLevel Limited

$EdgeSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $EdgeTaskName `
    -Action $EdgeAction `
    -Trigger @($EdgeTriggerRepeat, $EdgeTriggerLogon) `
    -Principal $EdgePrincipal `
    -Settings $EdgeSettings `
    -Description "Every 2 minutes for kiosk user via wscript.exe (window style 0) and conhost.exe --headless: relaunches Microsoft Edge in kiosk mode if not running without stealing focus." `
    -Force | Out-Null
Enable-ScheduledTask -TaskName $EdgeTaskName -ErrorAction SilentlyContinue | Out-Null

Write-Host "[INFO] Scheduled Task '$EdgeTaskName' registered for user '$KioskUser' (every 2 minutes, headless wscript/conhost)." -ForegroundColor Green

# Register Edge Kiosk Launcher in HKLM Run and Common Startup so logging into the kiosk session (or auto-restart after Windows Update) immediately starts Edge via boot.html
$LaunchBatPath = Join-Path $ProjectRoot "kiosk-boot\launch-kiosk.bat"
if (Test-Path $LaunchBatPath) {
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" `
        -Name "CPT_Edge_Kiosk" `
        -Value "wscript.exe //B //NoLogo `"$EdgeWatchdogVbs`"" `
        -Type String -ErrorAction SilentlyContinue
    Write-Host "[INFO] Registered Edge Kiosk Launcher (CPT_Edge_Kiosk) in HKLM Run." -ForegroundColor Green

    $CommonStartupDir = [Environment]::GetFolderPath("CommonStartup")
    if ($CommonStartupDir -and (Test-Path $CommonStartupDir)) {
        $StartupCmdPath = Join-Path $CommonStartupDir "CPT_Edge_Kiosk.cmd"
        $StartupCmdContent = "@echo off`r`nstart `"`" wscript.exe //B //NoLogo `"$EdgeWatchdogVbs`"`r`n"
        Set-Content -Path $StartupCmdPath -Value $StartupCmdContent -Encoding ASCII -Force -ErrorAction SilentlyContinue
        Write-Host "[INFO] Registered Edge Kiosk Launcher in Common Startup ($StartupCmdPath)." -ForegroundColor Green
    }
}
}

# 11c. Apply Windows Notification-Off, Standard Manila Time (UTC+08:00), & Post-Windows-Update Auto-Recovery Policies
Write-Host "[INFO] Setting Windows time zone to Standard Manila Time (UTC+08:00) and applying kiosk policies..." -ForegroundColor Cyan
$PrevEapNotif = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    & tzutil.exe /s "Singapore Standard Time" *> $null
    Set-Service -Name "W32Time" -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name "W32Time" -ErrorAction SilentlyContinue
    & w32tm.exe /resync /force *> $null

    # Allow inbound TCP 5000 (CPT_Web) and bundled node.exe through Windows Defender Firewall across all profiles
    # so Department Supervisors clicking Excused / Unexcused in email links can open /supervisor-form across the LAN/Wi-Fi
    & netsh.exe advfirewall firewall delete rule name="Company Phone Tracker Web (TCP 5000)" *> $null
    & netsh.exe advfirewall firewall delete rule name="Company Phone Tracker Node Runtime" *> $null
    if ($Role -eq "ALL") {
        & netsh.exe advfirewall firewall add rule name="Company Phone Tracker Web (TCP 5000)" dir=in action=allow protocol=TCP localport=5000 profile=any *> $null
        if ($NodeExe -and (Test-Path $NodeExe)) {
            & netsh.exe advfirewall firewall add rule name="Company Phone Tracker Node Runtime" dir=in action=allow program="$NodeExe" profile=any *> $null
        }
        Write-Host "[INFO] Configured Windows Firewall inbound allow rules for TCP Port 5000 (Supervisor Email Web Links)." -ForegroundColor Green
    } else {
        # SERVER: users reach the app through the HTTPS reverse proxy on 443, never port 5000 directly.
        # KIOSK: no local web server.
        Write-Host "[INFO] $Role role: Windows Firewall inbound rules for TCP 5000 removed (not needed)." -ForegroundColor Green
    }

    # Disable Microsoft Edge Startup Boost and Background Mode so invisible --no-startup-window processes never block --kiosk
    $EdgePolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
    if (-not (Test-Path $EdgePolicyPath)) { New-Item -Path $EdgePolicyPath -Force | Out-Null }
    Set-ItemProperty -Path $EdgePolicyPath -Name "StartupBoostEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $EdgePolicyPath -Name "BackgroundModeEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue

    $PushPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications"
    if (-not (Test-Path $PushPolicyPath)) { New-Item -Path $PushPolicyPath -Force | Out-Null }
    Set-ItemProperty -Path $PushPolicyPath -Name "NoToastApplicationNotification" -Value 1 -Type DWord -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $PushPolicyPath -Name "NoToastApplicationNotificationOnLockScreen" -Value 1 -Type DWord -ErrorAction SilentlyContinue

    $ExplorerPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer"
    if (-not (Test-Path $ExplorerPolicyPath)) { New-Item -Path $ExplorerPolicyPath -Force | Out-Null }
    Set-ItemProperty -Path $ExplorerPolicyPath -Name "DisableNotificationCenter" -Value 1 -Type DWord -ErrorAction SilentlyContinue

    # Enable Windows Automatic Restart Sign-On (ARSO) after Windows Update reboots and skip first-logon animations
    $SysPolicyPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
    if (-not (Test-Path $SysPolicyPath)) { New-Item -Path $SysPolicyPath -Force | Out-Null }
    Set-ItemProperty -Path $SysPolicyPath -Name "DisableAutomaticRestartSignOn" -Value 0 -Type DWord -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $SysPolicyPath -Name "DisableFirstLogonAnimation" -Value 1 -Type DWord -ErrorAction SilentlyContinue

    # Apply per-user notification suppression, RestartApps, and post-update OOBE suppression to HKCU
    foreach ($CurHive in @("HKCU:")) {
        if (Test-Path $CurHive) {
            $CurWinlogon = "$CurHive\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
            if (-not (Test-Path $CurWinlogon)) { New-Item -Path $CurWinlogon -Force | Out-Null }
            Set-ItemProperty -Path $CurWinlogon -Name "RestartApps" -Value 1 -Type DWord -ErrorAction SilentlyContinue

            $CurScoobe = "$CurHive\SOFTWARE\Microsoft\Windows\CurrentVersion\UserProfileEngagement"
            if (-not (Test-Path $CurScoobe)) { New-Item -Path $CurScoobe -Force | Out-Null }
            Set-ItemProperty -Path $CurScoobe -Name "ScoobeSystemSettingEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue

            $CurCdm = "$CurHive\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
            if (-not (Test-Path $CurCdm)) { New-Item -Path $CurCdm -Force | Out-Null }
            Set-ItemProperty -Path $CurCdm -Name "SubscribedContent-310093Enabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $CurCdm -Name "SubscribedContent-338389Enabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
        }
    }

    # Also apply per-user notification suppression, RestartApps, and OOBE suppression to KioskUser's registry hive if profile exists
    if (-not [string]::IsNullOrWhiteSpace($KioskUser)) {
        $KioskSid = $null
        try {
            $NtAcct = New-Object System.Security.Principal.NTAccount($KioskUser)
            $KioskSid = $NtAcct.Translate([System.Security.Principal.SecurityIdentifier]).Value
        } catch {}

        if ($KioskSid) {
            if (-not (Test-Path "HKU:\")) {
                New-PSDrive -Name HKU -PSProvider Registry -Root HKEY_USERS -ErrorAction SilentlyContinue | Out-Null
            }
            $HiveLoadedTemporarily = $false
            $UserHiveRoot = "HKU:\$KioskSid"
            $NtUserDat = "C:\Users\$KioskUser\NTUSER.DAT"
            if (-not (Test-Path $UserHiveRoot) -and (Test-Path $NtUserDat)) {
                & reg.exe load "HKU\$KioskSid" $NtUserDat *> $null
                if ($LASTEXITCODE -eq 0) { $HiveLoadedTemporarily = $true }
            }
            if (Test-Path $UserHiveRoot) {
                $UserPushPath = "$UserHiveRoot\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications"
                if (-not (Test-Path $UserPushPath)) { New-Item -Path $UserPushPath -Force | Out-Null }
                Set-ItemProperty -Path $UserPushPath -Name "ToastEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue

                $UserPushPolicy = "$UserHiveRoot\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\PushNotifications"
                if (-not (Test-Path $UserPushPolicy)) { New-Item -Path $UserPushPolicy -Force | Out-Null }
                Set-ItemProperty -Path $UserPushPolicy -Name "NoToastApplicationNotification" -Value 1 -Type DWord -ErrorAction SilentlyContinue

                $UserExplorerPolicy = "$UserHiveRoot\SOFTWARE\Policies\Microsoft\Windows\Explorer"
                if (-not (Test-Path $UserExplorerPolicy)) { New-Item -Path $UserExplorerPolicy -Force | Out-Null }
                Set-ItemProperty -Path $UserExplorerPolicy -Name "DisableNotificationCenter" -Value 1 -Type DWord -ErrorAction SilentlyContinue

                $UserWinlogon = "$UserHiveRoot\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
                if (-not (Test-Path $UserWinlogon)) { New-Item -Path $UserWinlogon -Force | Out-Null }
                Set-ItemProperty -Path $UserWinlogon -Name "RestartApps" -Value 1 -Type DWord -ErrorAction SilentlyContinue

                $UserScoobe = "$UserHiveRoot\SOFTWARE\Microsoft\Windows\CurrentVersion\UserProfileEngagement"
                if (-not (Test-Path $UserScoobe)) { New-Item -Path $UserScoobe -Force | Out-Null }
                Set-ItemProperty -Path $UserScoobe -Name "ScoobeSystemSettingEnabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue

                $UserCdm = "$UserHiveRoot\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"
                if (-not (Test-Path $UserCdm)) { New-Item -Path $UserCdm -Force | Out-Null }
                Set-ItemProperty -Path $UserCdm -Name "SubscribedContent-310093Enabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $UserCdm -Name "SubscribedContent-338389Enabled" -Value 0 -Type DWord -ErrorAction SilentlyContinue
            }
            if ($HiveLoadedTemporarily) {
                [gc]::Collect()
                Start-Sleep -Milliseconds 300
                & reg.exe unload "HKU\$KioskSid" *> $null
            }
        }
    }
    Write-Host "[INFO] Configured Windows Update ARSO, RestartApps, OOBE suppression, and notification-off policies." -ForegroundColor Green
} catch {
    Write-Warning "Could not apply all notification/ARSO registry keys: $($_.Exception.Message)"
} finally {
    $ErrorActionPreference = $PrevEapNotif
}

# 12. Start all 4 services in dependency order (unless -NoStart is specified)
if (-not $NoStart) {
    Write-Host "`nStarting services..." -ForegroundColor Cyan
    if ($Role -eq "KIOSK") {
        Start-Service -Name "CPT_Agent"
    } else {
        Start-Service -Name "CPT_DB"
        & $NodeExe (Join-Path $ProjectRoot "scripts\wait-for-pg.mjs")

        Start-Service -Name "CPT_Agent"
        Start-Service -Name "CPT_Worker"
        Start-Service -Name "CPT_Web"
    }
}

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  INSTALLATION COMPLETE - SERVICE STATUS" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Get-Service -Name "CPT_DB", "CPT_Web", "CPT_Worker", "CPT_Agent" -ErrorAction SilentlyContinue | Format-Table -AutoSize

