#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Convert an installed copy into a central server (Azure VM).
.DESCRIPTION
    Run as Administrator on the Azure VM AFTER PhoneTrackerSetup-<version>.exe has been installed.
    See AZURE_DEPLOYMENT.md for the full procedure.

    1. Writes these keys to C:\ProgramData\PhoneTracker\.env (and the app folder copy):
         CPT_ROLE=SERVER              -> no Edge kiosk, no port 5000 firewall rule, agent checks skipped
         APP_URL / PUBLIC_APP_URL     -> the public HTTPS address used in email links and cookies
         APP_HOST=127.0.0.1           -> web server only reachable through the local HTTPS reverse proxy
         TRUST_PROXY=true             -> real client IPs from the reverse proxy (login rate limiting)
         DISABLE_PUBLIC_TUNNEL=true   -> stops the automatic Cloudflare quick tunnel
    2. Stops any running cloudflared.exe started by the app.
    3. Re-runs scripts\install-services.ps1 so services and scheduled tasks match the SERVER role.
    4. Waits for http://127.0.0.1:5000/api/health to report the database UP.

    Safe to re-run (for example after changing the public address).
.PARAMETER PublicUrl
    Public HTTPS address of the server, e.g. https://phonetracker.example.com
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File "C:\Program Files\PhoneTracker\scripts\configure-azure-server.ps1" -PublicUrl "https://phonetracker.example.com"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$PublicUrl,
    [string]$DataDir = "C:\ProgramData\PhoneTracker",
    [string]$AppDir = ""
)

$ErrorActionPreference = "Stop"

$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "configure-azure-server.ps1 must be run as Administrator."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($AppDir)) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
}

$PublicUrl = $PublicUrl.Trim().TrimEnd("/")
if ($PublicUrl -notmatch "^https://[^/\s]+$") {
    Write-Error "-PublicUrl must be an https:// address with no path, e.g. https://phonetracker.example.com"
    exit 1
}

$EnvPath = Join-Path $DataDir ".env"
if (-not (Test-Path $EnvPath)) {
    Write-Error "$EnvPath not found. Install PhoneTrackerSetup-<version>.exe on this VM first."
    exit 1
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
Write-Host "  COMPANY PHONE TRACKER - CONFIGURE AS CENTRAL (AZURE) SERVER" -ForegroundColor Cyan
Write-Host "  App folder : $AppDir" -ForegroundColor Cyan
Write-Host "  Data folder: $DataDir" -ForegroundColor Cyan
Write-Host "  Public URL : $PublicUrl" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Write SERVER role settings to .env (data folder copy is the one services read; app folder copy kept in sync)
$ServerValues = @{
    "CPT_ROLE"              = "SERVER"
    "APP_URL"               = $PublicUrl
    "PUBLIC_APP_URL"        = $PublicUrl
    "APP_HOST"              = "127.0.0.1"
    "TRUST_PROXY"           = "true"
    "DISABLE_PUBLIC_TUNNEL" = "true"
}
Set-EnvFileValues -Path $EnvPath -Values $ServerValues
$AppEnvPath = Join-Path $AppDir ".env"
if (Test-Path $AppEnvPath) {
    Set-EnvFileValues -Path $AppEnvPath -Values $ServerValues
}
Write-Host "[1/4] Updated .env: CPT_ROLE=SERVER, APP_URL=$PublicUrl, APP_HOST=127.0.0.1, TRUST_PROXY=true, DISABLE_PUBLIC_TUNNEL=true" -ForegroundColor Green

# 2. Stop the automatic Cloudflare quick tunnel if it is running
$TunnelProcs = @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue)
foreach ($Proc in $TunnelProcs) {
    if ($Proc.ExecutablePath -and $Proc.ExecutablePath -like "*PhoneTracker*") {
        Stop-Process -Id $Proc.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[2/4] Stopped cloudflared.exe (PID $($Proc.ProcessId))." -ForegroundColor Yellow
    }
}
Write-Host "[2/4] Cloudflare quick tunnel disabled." -ForegroundColor Green

# 3. Re-apply services and scheduled tasks for the SERVER role
$NodeExe = Join-Path $AppDir "node\node.exe"
$InstallServices = Join-Path $AppDir "scripts\install-services.ps1"
Write-Host "[3/4] Re-applying Windows services for SERVER role..." -ForegroundColor Cyan
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $InstallServices `
    -NodePath $NodeExe -DataDir $DataDir -EnvFilePath $EnvPath -SkipBuild
if ($LASTEXITCODE -ne 0) {
    Write-Error "install-services.ps1 failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

# 4. Wait for the web server and database
Write-Host "[4/4] Waiting for http://127.0.0.1:5000/api/health ..." -ForegroundColor Cyan
$Healthy = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        $Resp = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/health" -UseBasicParsing -TimeoutSec 5
        $Json = $Resp.Content | ConvertFrom-Json
        if ($Json.checks.database.status -eq "UP") { $Healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
}

if ($Healthy) {
    Write-Host "[4/4] Web server and database are UP." -ForegroundColor Green
} else {
    Write-Warning "Health check did not report the database UP within 2 minutes. Check $DataDir\logs\CPT_Web.log and CPT_DB.log."
}

Write-Host ""
Write-Host "Next steps (see AZURE_DEPLOYMENT.md):" -ForegroundColor Cyan
Write-Host "  - Install the HTTPS reverse proxy (Caddy) so $PublicUrl forwards to http://127.0.0.1:5000"
Write-Host "  - Copy KIOSK_DEVICE_SECRET from $EnvPath; each kiosk PC needs it for configure-kiosk-client.ps1"
