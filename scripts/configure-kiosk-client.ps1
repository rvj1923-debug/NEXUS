#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Point a kiosk PC at the central (Azure) server.
.DESCRIPTION
    Run as Administrator on each kiosk mini PC that already has PhoneTrackerSetup-<version>.exe installed.
    Do this only AFTER the data has been moved to the server (see AZURE_DEPLOYMENT.md).

    1. Takes a final local database backup (if the local database is still running).
    2. Writes these keys to C:\ProgramData\PhoneTracker\.env:
         CPT_ROLE=KIOSK, KIOSK_SERVER_URL, KIOSK_DEVICE_SECRET (copied from the server),
         AGENT_ALLOWED_ORIGINS (adds the server address), DISABLE_PUBLIC_TUNNEL=true
    3. Allows the server page to talk to the local NFC agent without a browser prompt
       (Edge policy LocalNetworkAccessAllowedForUrls).
    4. Re-runs scripts\install-services.ps1, which removes the local CPT_DB / CPT_Web / CPT_Worker
       services, keeps CPT_Agent and the Edge kiosk, and rewrites kiosk-boot\config.js to open the server.
       The local data folder is NOT deleted.
.PARAMETER ServerUrl
    Public address of the central server, e.g. https://phonetracker.example.com
.PARAMETER Force
    Skip the confirmation prompt.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File "C:\Program Files\PhoneTracker\scripts\configure-kiosk-client.ps1" -ServerUrl "https://phonetracker.example.com"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ServerUrl,
    [string]$DataDir = "C:\ProgramData\PhoneTracker",
    [string]$AppDir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "configure-kiosk-client.ps1 must be run as Administrator."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
}

$ServerUrl = $ServerUrl.Trim().TrimEnd("/")
if ($ServerUrl -notmatch "^https?://[^/\s]+$") {
    Write-Error "-ServerUrl must be an address with no path, e.g. https://phonetracker.example.com"
    exit 1
}
if ($ServerUrl -notmatch "^https://") {
    Write-Warning "ServerUrl is not https://. Use HTTPS for anything reachable over the internet."
}

$EnvPath = Join-Path $DataDir ".env"
if (-not (Test-Path $EnvPath)) {
    Write-Error "$EnvPath not found. Install PhoneTrackerSetup-<version>.exe on this kiosk PC first."
    exit 1
}

function Get-EnvFileValue {
    param([string]$Path, [string]$Key)
    foreach ($Line in (Get-Content -Path $Path -ErrorAction SilentlyContinue)) {
        if ($Line -match "^\s*$([Regex]::Escape($Key))\s*=\s*(.*)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvFileValues {
    param([string]$Path, [hashtable]$Values)
    $Lines = @()
    if (Test-Path $Path) { $Lines = @(Get-Content -Path $Path -ErrorAction SilentlyContinue) }
    $Seen = @{}
    $Out = foreach ($Line in $Lines) {
        $Replaced = $false
        foreach ($Key in $Values.Keys) {
            if ($Line -match "^\s*$([Regex]::Escape($Key))\s*=") {
                $Seen[$Key] = $true
                $Replaced = $true
                "$Key=`"$($Values[$Key])`""
                break
            }
        }
        if (-not $Replaced) { $Line }
    }
    foreach ($Key in $Values.Keys) {
        if (-not $Seen.ContainsKey($Key)) { $Out += "$Key=`"$($Values[$Key])`"" }
    }
    Set-Content -Path $Path -Value ($Out -join [Environment]::NewLine) -Encoding UTF8
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  COMPANY PHONE TRACKER - CONFIGURE KIOSK PC FOR CENTRAL SERVER" -ForegroundColor Cyan
Write-Host "  Server: $ServerUrl" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 0. Check the server is reachable before changing anything
try {
    $Resp = Invoke-WebRequest -Uri "$ServerUrl/api/health" -UseBasicParsing -TimeoutSec 10
    $Json = $Resp.Content | ConvertFrom-Json
    if ($Json.checks.database.status -ne "UP") {
        Write-Warning "Server answered but its database is not UP (status: $($Json.checks.database.status))."
    } else {
        Write-Host "[0/5] Server $ServerUrl is reachable and its database is UP." -ForegroundColor Green
    }
} catch {
    Write-Error "Cannot reach $ServerUrl/api/health from this PC: $($_.Exception.Message). Fix the network/DNS/HTTPS first."
    exit 1
}

if (-not $Force) {
    Write-Host ""
    Write-Host "This removes the LOCAL database and web services from this PC (the data folder is kept)." -ForegroundColor Yellow
    Write-Host "Only continue if this PC's data has already been restored on the server." -ForegroundColor Yellow
    $Answer = Read-Host "Type YES to continue"
    if ($Answer -ne "YES") {
        Write-Host "Cancelled. Nothing was changed."
        exit 0
    }
}

# 1. Final local backup while the local database is still running
$NodeExe = Join-Path $AppDir "node\node.exe"
$LocalDb = Get-Service -Name "CPT_DB" -ErrorAction SilentlyContinue
if ($null -ne $LocalDb -and $LocalDb.Status -eq "Running") {
    Write-Host "[1/5] Taking a final local backup before removing the local database..." -ForegroundColor Cyan
    Push-Location $AppDir
    $env:ENV_FILE_PATH = $EnvPath
    & $NodeExe (Join-Path $AppDir "scripts\backup-db.mjs")
    Pop-Location
    Write-Host "[1/5] Final backup saved in $DataDir\backups." -ForegroundColor Green
} else {
    Write-Host "[1/5] Local database not running; no final backup taken." -ForegroundColor Yellow
}

# 2. Kiosk device key from the server (.env KIOSK_DEVICE_SECRET on the Azure VM)
$SecureKey = Read-Host -AsSecureString "Paste KIOSK_DEVICE_SECRET from the server's C:\ProgramData\PhoneTracker\.env"
$Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try {
    $DeviceKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
}
if ($DeviceKey.Length -lt 32) {
    Write-Error "KIOSK_DEVICE_SECRET must be at least 32 characters. Nothing was changed."
    exit 1
}

$ServerOrigin = ([Uri]$ServerUrl).GetLeftPart([UriPartial]::Authority)
$Origins = @((Get-EnvFileValue -Path $EnvPath -Key "AGENT_ALLOWED_ORIGINS") -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Origins -notcontains $ServerOrigin) { $Origins += $ServerOrigin }

$KioskValues = @{
    "CPT_ROLE"              = "KIOSK"
    "KIOSK_SERVER_URL"      = $ServerUrl
    "KIOSK_DEVICE_SECRET"   = $DeviceKey
    "AGENT_ALLOWED_ORIGINS" = ($Origins -join ",")
    "DISABLE_PUBLIC_TUNNEL" = "true"
}
Set-EnvFileValues -Path $EnvPath -Values $KioskValues
$AppEnvPath = Join-Path $AppDir ".env"
if (Test-Path $AppEnvPath) {
    Set-EnvFileValues -Path $AppEnvPath -Values $KioskValues
}
Write-Host "[2/5] Updated .env: CPT_ROLE=KIOSK, KIOSK_SERVER_URL=$ServerUrl, KIOSK_DEVICE_SECRET set." -ForegroundColor Green

# 3. Let the server page reach the local NFC agent (http://127.0.0.1:8002) without a browser permission prompt
$LnaPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls"
if (-not (Test-Path $LnaPolicyPath)) { New-Item -Path $LnaPolicyPath -Force | Out-Null }
$LnaProps = Get-ItemProperty -Path $LnaPolicyPath -ErrorAction SilentlyContinue
$ExistingLna = @()
$MaxIndex = 0
if ($null -ne $LnaProps) {
    foreach ($Prop in $LnaProps.PSObject.Properties) {
        if ($Prop.Name -match "^\d+$") {
            $ExistingLna += [string]$Prop.Value
            if ([int]$Prop.Name -gt $MaxIndex) { $MaxIndex = [int]$Prop.Name }
        }
    }
}
if ($ExistingLna -notcontains $ServerOrigin) {
    Set-ItemProperty -Path $LnaPolicyPath -Name ([string]($MaxIndex + 1)) -Value $ServerOrigin -Type String
}
Write-Host "[3/5] Edge policy LocalNetworkAccessAllowedForUrls includes $ServerOrigin." -ForegroundColor Green

# 4. Stop the old Cloudflare quick tunnel and re-apply services for the KIOSK role
$TunnelProcs = @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue)
foreach ($Proc in $TunnelProcs) {
    if ($Proc.ExecutablePath -and $Proc.ExecutablePath -like "*PhoneTracker*") {
        Stop-Process -Id $Proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
$KioskUser = Get-EnvFileValue -Path $EnvPath -Key "KIOSK_USERNAME"
if ([string]::IsNullOrWhiteSpace($KioskUser)) { $KioskUser = "KioskUser" }
$InstallServices = Join-Path $AppDir "scripts\install-services.ps1"
Write-Host "[4/5] Re-applying Windows services for KIOSK role..." -ForegroundColor Cyan
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $InstallServices `
    -NodePath $NodeExe -DataDir $DataDir -EnvFilePath $EnvPath -KioskUser $KioskUser -SkipBuild
if ($LASTEXITCODE -ne 0) {
    Write-Error "install-services.ps1 failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

# 5. Check the local agent
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:8002/api/agent/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "[5/5] Local NFC agent is running on 127.0.0.1:8002." -ForegroundColor Green
} catch {
    Write-Warning "Local NFC agent did not answer on 127.0.0.1:8002. Card taps still work through keyboard-wedge mode; check $DataDir\logs\CPT_Agent.log."
}

Write-Host ""
Write-Host "Done. Restart this PC so Edge opens $ServerUrl in kiosk mode, then tap a test card." -ForegroundColor Cyan
