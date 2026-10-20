#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Kiosk Edge Browser Watchdog (User Session, Headless)
.DESCRIPTION
    Registered as Scheduled Task 'CPT_Edge_Watchdog' running every 2 minutes in the
    kiosk user's interactive session via wscript.exe / conhost.exe --headless with
    window style 0 so it never flashes a console window or steals keyboard wedge focus.
    1. Checks if Microsoft Edge (msedge) is running; if not, launches kiosk-boot\launch-kiosk.bat.
    2. Defence in depth: tracks /api/health reachability in logs\edge-watchdog-state.json.
       If /api/health was unreachable during an earlier run and is reachable now,
       restarts Edge via kiosk-boot\launch-kiosk.bat (rate-limited to once per 10 minutes)
       so the boot page takes over in case Edge was sitting on its own error page.
#>
param(
    [switch]$WhatIf,
    [string]$HealthUrl = "http://localhost:5000/api/health",
    [string]$StateFilePath = ""
)

$ErrorActionPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir

function Resolve-LogDir {
    if (-not [string]::IsNullOrWhiteSpace($env:LOG_DIR)) {
        return $env:LOG_DIR.Trim()
    }
    $EnvCandidates = @(
        (Join-Path $ProjectRoot ".env"),
        "C:\ProgramData\PhoneTracker\.env"
    )
    foreach ($EnvCandidate in $EnvCandidates) {
        if (Test-Path $EnvCandidate) {
            foreach ($Line in (Get-Content $EnvCandidate -ErrorAction SilentlyContinue)) {
                if ($Line -match "^\s*LOG_DIR\s*=\s*(.+)\s*$") {
                    $Val = $Matches[1].Trim().Trim('"').Trim("'")
                    if (-not [string]::IsNullOrWhiteSpace($Val)) {
                        return $Val
                    }
                }
            }
        }
    }
    if (Test-Path "C:\ProgramData\PhoneTracker") {
        return "C:\ProgramData\PhoneTracker\logs"
    }
    return (Join-Path $ProjectRoot "logs")
}

$LogDir = Resolve-LogDir
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = Join-Path $LogDir "watchdog.log"
$StateFile = if ($StateFilePath -and $StateFilePath.Trim().Length -gt 0) {
    $StateFilePath
} else {
    Join-Path $LogDir "edge-watchdog-state.json"
}
$LaunchBat = Join-Path $ProjectRoot "kiosk-boot\launch-kiosk.bat"
$BootHtml = Join-Path $ProjectRoot "kiosk-boot\boot.html"
$RestartCooldownMinutes = 10

# When the kiosk points at a central server (e.g. Azure), watch that server's /api/health
# instead of localhost. The server URL comes from kiosk-boot\config.js (baseUrl).
if (-not $PSBoundParameters.ContainsKey("HealthUrl")) {
    $BootConfigJs = Join-Path $ProjectRoot "kiosk-boot\config.js"
    if (Test-Path $BootConfigJs) {
        $CfgRaw = Get-Content -Path $BootConfigJs -Raw -ErrorAction SilentlyContinue
        if ($CfgRaw -match 'baseUrl\s*:\s*"([^"]+)"') {
            $HealthUrl = $Matches[1].TrimEnd("/") + "/api/health"
        }
    }
}

function Write-WatchdogLog {
    param([string]$Message)
    $Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $Line = "[$Timestamp] [EdgeWatchdog] $Message"
    if ($WhatIf) {
        Write-Output $Line
    }
    try {
        Add-Content -Path $LogFile -Value $Line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

$DisableFlagFile = Join-Path $LogDir "disable-edge-watchdog.flag"
if ((Test-Path $DisableFlagFile) -or ($env:ENABLE_EDGE_WATCHDOG -eq "false") -or ($env:ENABLE_EDGE_WATCHDOG -eq "0")) {
    exit 0
}

function Start-KioskEdgeBrowser {
    $EdgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $EdgeExe)) {
        $EdgeExe = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    }
    if (-not (Test-Path $EdgeExe)) {
        $EdgeExe = "msedge.exe"
    }
    $KioskProfileDir = if ($env:LOCALAPPDATA) {
        Join-Path $env:LOCALAPPDATA "PhoneTracker\EdgeKioskProfile"
    } else {
        "C:\ProgramData\PhoneTracker\data\EdgeKioskProfile"
    }
    if (-not (Test-Path $KioskProfileDir)) {
        New-Item -ItemType Directory -Path $KioskProfileDir -Force -ErrorAction SilentlyContinue | Out-Null
    }
    if (Test-Path $BootHtml) {
        $BootUri = "file:///" + ($BootHtml -replace "\\", "/" -replace " ", "%20")
        $EdgeArgs = @(
            "--user-data-dir=`"$KioskProfileDir`"",
            "--kiosk", "`"$BootUri`"",
            "--edge-kiosk-type=fullscreen",
            "--no-first-run",
            "--no-default-browser-check",
            "--kiosk-idle-timeout-minutes=0",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--autoplay-policy=no-user-gesture-required"
        )
        Start-Process -FilePath $EdgeExe -ArgumentList ($EdgeArgs -join " ") -WorkingDirectory (Split-Path -Parent $BootHtml)
        Write-WatchdogLog "Started Edge directly pointing to $BootUri (profile=$KioskProfileDir)."
    } elseif (Test-Path $LaunchBat) {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$LaunchBat`"" -WorkingDirectory (Split-Path -Parent $LaunchBat) -WindowStyle Hidden
        Write-WatchdogLog "Executed $LaunchBat to restore kiosk browser."
    }
}

# 1. Load previous state from logs\edge-watchdog-state.json
$PrevState = $null
if (Test-Path $StateFile) {
    try {
        $RawState = Get-Content -Path $StateFile -Raw -Encoding UTF8 -ErrorAction Stop
        if ($RawState) {
            $PrevState = $RawState | ConvertFrom-Json -ErrorAction Stop
        }
    } catch {
        $PrevState = $null
    }
}

$WasUnreachable = $false
$LastEdgeRestartAt = $null
$LastUnreachableAt = $null

if ($null -ne $PrevState) {
    if ($PrevState.PSObject.Properties.Name -contains "healthReachable" -and $PrevState.healthReachable -eq $false) {
        $WasUnreachable = $true
    }
    if ($PrevState.PSObject.Properties.Name -contains "lastEdgeRestartAt" -and $PrevState.lastEdgeRestartAt) {
        $LastEdgeRestartAt = [string]$PrevState.lastEdgeRestartAt
    }
    if ($PrevState.PSObject.Properties.Name -contains "lastUnreachableAt" -and $PrevState.lastUnreachableAt) {
        $LastUnreachableAt = [string]$PrevState.lastUnreachableAt
    }
}

# 2. Check if /api/health is reachable now (any HTTP response status means server is reachable)
$IsReachable = $false
try {
    $Resp = Invoke-WebRequest -Uri $HealthUrl -Method Get -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    if ($null -ne $Resp -and $Resp.StatusCode -ge 100) {
        $IsReachable = $true
    }
} catch {
    if ($null -ne $_.Exception -and $null -ne $_.Exception.Response) {
        $IsReachable = $true
    } else {
        $IsReachable = $false
    }
}

$NowIso = (Get-Date).ToString("o")
if (-not $IsReachable) {
    $LastUnreachableAt = $NowIso
}

# 3. Evaluate Edge process state & recovery transition
# Ignore invisible background Edge Startup Boost processes (--no-startup-window) that have MainWindowHandle == 0
$VisibleEdgeProcs = @(Get-Process -Name "msedge" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })

if ($VisibleEdgeProcs.Count -eq 0) {
    if ($WhatIf) {
        Write-WatchdogLog "[WhatIf] Microsoft Edge (msedge) has no visible window -> would launch kiosk browser via kiosk-boot/launch-kiosk.bat."
    } else {
        Write-WatchdogLog "Microsoft Edge (msedge) has no visible window. Launching kiosk browser..."
        Start-KioskEdgeBrowser
        $LastEdgeRestartAt = $NowIso
    }
} elseif ($WasUnreachable -and $IsReachable) {
    # /api/health was unreachable during an earlier run and is reachable now
    $CanRestart = $true
    if ($LastEdgeRestartAt) {
        try {
            $LastRestartDt = [DateTimeOffset]::Parse($LastEdgeRestartAt).LocalDateTime
            $ElapsedMinutes = ((Get-Date) - $LastRestartDt).TotalMinutes
            if ($ElapsedMinutes -lt $RestartCooldownMinutes) {
                $CanRestart = $false
                $RemainingMin = [Math]::Round($RestartCooldownMinutes - $ElapsedMinutes, 1)
                Write-WatchdogLog "/api/health was unreachable and is now reachable, but Edge restart is rate-limited (last restart at $LastEdgeRestartAt; ${RemainingMin}m cooldown remaining)."
            }
        } catch {
            $CanRestart = $true
        }
    }

    if ($CanRestart) {
        if ($WhatIf) {
            Write-WatchdogLog "[WhatIf] /api/health was unreachable, now reachable -> would restart Edge via kiosk-boot/launch-kiosk.bat (state file: $StateFile)."
        } else {
            Write-WatchdogLog "/api/health was unreachable during an earlier run and is reachable now. Restarting Edge via kiosk-boot/launch-kiosk.bat so the boot page takes over..."
            Stop-Process -Name "msedge" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 600
            Start-KioskEdgeBrowser
            $LastEdgeRestartAt = $NowIso
        }
    }
}

# 4. Persist state to logs\edge-watchdog-state.json (unless -WhatIf dry-run)
if (-not $WhatIf) {
    $NewState = [ordered]@{
        healthReachable   = $IsReachable
        lastCheckedAt     = $NowIso
        lastUnreachableAt = $LastUnreachableAt
        lastEdgeRestartAt = $LastEdgeRestartAt
    }
    try {
        $NewState | ConvertTo-Json -Depth 4 | Set-Content -Path $StateFile -Encoding UTF8 -Force -ErrorAction SilentlyContinue
    } catch {}
}

