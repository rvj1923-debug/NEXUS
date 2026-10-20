#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Windows Services & Split Watchdog Uninstaller
.DESCRIPTION
    Run as Administrator.
    1. Unregisters CPT_Service_Watchdog, CPT_Edge_Watchdog, and legacy CPT_Kiosk_Watchdog Scheduled Tasks.
    2. Gracefully stops and removes CPT_Web, CPT_Worker, CPT_Agent, and CPT_DB.
.PARAMETER NssmPath
    Path to nssm.exe. Defaults to .\tools\nssm.exe relative to the project root.
#>

param(
    [string]$NssmPath = ".\tools\nssm.exe"
)

$ErrorActionPreference = "Continue"

$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "uninstall-services.ps1 must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location -Path $ProjectRoot

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  COMPANY PHONE TRACKER - WINDOWS SERVICE UNINSTALLER" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# Resolve NSSM executable path if available
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
        $ResolvedNssm = $null
    }
}

# 1. Remove Watchdog Scheduled Tasks and Run Launcher
Remove-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "CPT_Edge_Kiosk" -ErrorAction SilentlyContinue
$CommonStartupDir = [Environment]::GetFolderPath("CommonStartup")
if ($CommonStartupDir) {
    Remove-Item -Path (Join-Path $CommonStartupDir "CPT_Edge_Kiosk.cmd") -Force -ErrorAction SilentlyContinue
}
$TaskNames = @("CPT_Service_Watchdog", "CPT_Edge_Watchdog", "CPT_Kiosk_Watchdog")
foreach ($TaskName in $TaskNames) {
    $ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $ExistingTask) {
        Write-Host "[INFO] Removing Scheduled Task '$TaskName'..." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "[INFO] Scheduled Task '$TaskName' removed." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Scheduled Task '$TaskName' is not registered." -ForegroundColor Gray
    }
}

# 2. Stop and remove services in reverse dependency order (dependents first, CPT_DB last)
$ServiceNames = @("CPT_Web", "CPT_Worker", "CPT_Agent", "CPT_DB")

foreach ($SvcName in $ServiceNames) {
    $Svc = Get-Service -Name $SvcName -ErrorAction SilentlyContinue
    if ($null -eq $Svc) {
        Write-Host "[INFO] Service '$SvcName' is not installed; skipping." -ForegroundColor Gray
        continue
    }

    Write-Host "[INFO] Stopping service '$SvcName'..." -ForegroundColor Yellow
    if ($SvcName -eq "CPT_DB") {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:54320/shutdown" -Method Post -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null
            Start-Sleep -Seconds 2
        } catch {}
    }

    if ($null -ne $ResolvedNssm) {
        & $ResolvedNssm stop $SvcName | Out-Null
    }
    Stop-Service -Name $SvcName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    Write-Host "[INFO] Removing service '$SvcName'..." -ForegroundColor Yellow
    if ($null -ne $ResolvedNssm) {
        & $ResolvedNssm remove $SvcName confirm
    } else {
        & sc.exe delete $SvcName | Out-Null
    }
    Write-Host "[INFO] Service '$SvcName' removed." -ForegroundColor Green
}

# 3. Ensure any lingering node.exe running from $ProjectRoot is terminated so files are not locked during uninstall
try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
        if ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}
Start-Sleep -Seconds 1

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  UNINSTALLATION COMPLETE" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
