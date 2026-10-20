#Requires -Version 5.1
<#
.SYNOPSIS
    Remotely deploys and silently upgrades Company Phone Tracker (NEXUS) on a Mini PC over the LAN.
.DESCRIPTION
    Copies dist\PhoneTrackerSetup-1.0.3.exe to the target Mini PC and runs a zero-touch silent upgrade:
      PhoneTrackerSetup-1.0.3.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLOWDOWNGRADE /LOG="C:\ProgramData\PhoneTracker\logs\install.log"
    Preserves all database records, backups, logs, and .env secrets on the Mini PC.
.EXAMPLE
    .\scripts\update-remote.ps1 -MiniPcIp "<MINI-PC-IP>" -User "Administrator"
#>
param(
    [Parameter(Mandatory = $true, HelpMessage = "IP address or hostname of the Mini PC")]
    [string]$MiniPcIp,

    [Parameter(Mandatory = $false, HelpMessage = "Windows Administrator username on the Mini PC")]
    [string]$User = "",

    [Parameter(Mandatory = $false)]
    [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $RepoRoot "dist\PhoneTrackerSetup-1.0.3.exe"
}
if (-not (Test-Path $InstallerPath)) {
    throw "Installer not found at: $InstallerPath"
}
$InstallerPath = (Resolve-Path $InstallerPath).Path
$InstallerName = Split-Path -Leaf $InstallerPath

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " NEXUS Remote Mini PC Updater" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target Mini PC : $MiniPcIp"
Write-Host "Installer File : $InstallerPath"

$Cred = $null
if (-not [string]::IsNullOrWhiteSpace($User)) {
    $Cred = Get-Credential -UserName $User -Message "Enter Windows password for $User on Mini PC ($MiniPcIp)"
}

# Ensure target IP is in TrustedHosts if using IP with WinRM
try {
    Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force -ErrorAction SilentlyContinue
} catch {}

Write-Host "`n[1/3] Connecting to Mini PC ($MiniPcIp) via PowerShell Remoting (WinRM)..." -ForegroundColor Yellow
$SessionParams = @{
    ComputerName = $MiniPcIp
    ErrorAction  = "Stop"
}
if ($Cred) { $SessionParams["Credential"] = $Cred }

$Session = New-PSSession @SessionParams
try {
    $RemoteTempExe = "C:\Windows\Temp\$InstallerName"
    Write-Host "[2/3] Uploading $InstallerName to Mini PC ($RemoteTempExe)..." -ForegroundColor Yellow
    Copy-Item -Path $InstallerPath -Destination $RemoteTempExe -ToSession $Session -Force

    Write-Host "[3/3] Running silent in-place upgrade on Mini PC (preserving database & .env)..." -ForegroundColor Yellow
    Invoke-Command -Session $Session -ScriptBlock {
        param($ExePath)
        $LogPath = "C:\ProgramData\PhoneTracker\logs\install.log"
        $LogDir = Split-Path -Parent $LogPath
        if (-not (Test-Path $LogDir)) {
            New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        }
        $Args = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLOWDOWNGRADE /LOG=`"$LogPath`""
        $Proc = Start-Process -FilePath $ExePath -ArgumentList $Args -Wait -PassThru
        Write-Host "Installer exited with code: $($Proc.ExitCode)"
        if ($Proc.ExitCode -ne 0) {
            throw "Remote installer exited with non-zero code: $($Proc.ExitCode)"
        }
        Get-Service -Name "CPT_DB", "CPT_Web", "CPT_Worker", "CPT_Agent" -ErrorAction SilentlyContinue | Format-Table -AutoSize
    } -ArgumentList $RemoteTempExe
} finally {
    if ($Session) { Remove-PSSession $Session -ErrorAction SilentlyContinue }
}

Write-Host "`nVerifying remote web health at http://${MiniPcIp}:5000/api/health ..." -ForegroundColor Cyan
try {
    $Health = Invoke-RestMethod -Uri "http://${MiniPcIp}:5000/api/health" -TimeoutSec 10
    Write-Host "[SUCCESS] Mini PC is UP and reachable across the network! Status: $($Health.status)" -ForegroundColor Green
} catch {
    Write-Warning "Upgrade finished, but could not reach http://${MiniPcIp}:5000/api/health yet: $($_.Exception.Message)"
}
