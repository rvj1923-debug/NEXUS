#Requires -Version 5.1
<#
.SYNOPSIS
    Company Phone Tracker - Service Health Watchdog (Runs under SYSTEM)
.DESCRIPTION
    Registered as Scheduled Task 'CPT_Service_Watchdog' running every 1 minute under
    NT AUTHORITY\SYSTEM (Session 0, non-interactive, never creates a desktop window
    or steals keyboard focus from Edge).

    Watchdog Logic:
    1. If /api/health responds with checks.database.status !== "UP", OR 127.0.0.1:5432
       does not accept TCP for 3 consecutive checks, restarts CPT_DB (NOT CPT_Web).
       First requests a clean shutdown via POST http://127.0.0.1:54320/shutdown.
    2. Restarts CPT_Web ONLY when /api/health does not respond at all (connection
       refused or timeout) 3 times in a row.
    3. Startup Grace Period & Restore Protection:
       - Skips all restart decisions for a service if its process started less than
         180 seconds ago (via Win32_Service ProcessId -> NSSM child node.exe / Get-Process StartTime).
       - Skips CPT_DB restarts while scripts/auto-heal-db.mjs or scripts/restore-db.mjs
         is running.
    4. Enforces a per-service cooldown: no more than 1 restart per service per 10 minutes
       (600 seconds). Logs every action to logs\watchdog.log.
#>

param(
    [string]$HealthUrl = "http://localhost:5000/api/health",
    [string]$DbHost = "127.0.0.1",
    [int]$DbPort = 5432,
    [string]$DbShutdownUrl = "http://127.0.0.1:54320/shutdown",
    [string]$DbServiceName = "CPT_DB",
    [string]$WebServiceName = "CPT_Web",
    [int]$FailureThreshold = 3,
    [int]$MaxChecksPerRun = 3,
    [int]$RetryDelaySeconds = 2,
    [int]$CooldownSeconds = 600,
    [int]$StartupGracePeriodSeconds = 180,
    [string]$StateFilePath = ""
)

$ErrorActionPreference = "Continue"

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
if ([string]::IsNullOrWhiteSpace($StateFilePath)) {
    $StateFile = Join-Path $LogDir "watchdog-state.json"
} else {
    $StateFile = $StateFilePath
}

function Write-WatchdogLog {
    param([string]$Message)
    $Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $Line = "[$Timestamp] [ServiceWatchdog] $Message"
    try {
        Add-Content -Path $LogFile -Value $Line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

function Get-UnixEpochSeconds {
    return [int][Math]::Floor(([DateTime]::UtcNow - (New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc))).TotalSeconds)
}

function Read-WatchdogState {
    $DefaultState = @{
        dbFailures     = 0
        webFailures    = 0
        lastDbRestart  = 0
        lastWebRestart = 0
    }
    if (Test-Path $StateFile) {
        try {
            $Raw = Get-Content -Path $StateFile -Raw -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($Raw)) {
                $Parsed = $Raw | ConvertFrom-Json -ErrorAction Stop
                if ($null -ne $Parsed.dbFailures)     { $DefaultState.dbFailures     = [int]$Parsed.dbFailures }
                if ($null -ne $Parsed.webFailures)    { $DefaultState.webFailures    = [int]$Parsed.webFailures }
                if ($null -ne $Parsed.lastDbRestart)  { $DefaultState.lastDbRestart  = [int]$Parsed.lastDbRestart }
                if ($null -ne $Parsed.lastWebRestart) { $DefaultState.lastWebRestart = [int]$Parsed.lastWebRestart }
            }
        } catch {}
    }
    return $DefaultState
}

function Save-WatchdogState {
    param([hashtable]$State)
    try {
        $Json = $State | ConvertTo-Json -Compress
        Set-Content -Path $StateFile -Value $Json -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

function Get-ActiveDbRestoreProcess {
    try {
        $NodeProcs = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
        foreach ($Proc in $NodeProcs) {
            $CmdLine = [string]$Proc.CommandLine
            if ($CmdLine -match "(auto-heal-db\.mjs|restore-db\.mjs)") {
                return @{
                    ProcessId   = [int]$Proc.ProcessId
                    CommandLine = $CmdLine.Trim()
                }
            }
        }
    } catch {}
    return $null
}

function Get-ServiceProcessAge {
    param([string]$ServiceName)
    try {
        # 1. Check Win32_Service ProcessId and any NSSM child node.exe process
        $SvcCim = Get-CimInstance -ClassName Win32_Service -Filter "Name = '$ServiceName'" -ErrorAction SilentlyContinue
        if ($null -ne $SvcCim -and [int]$SvcCim.ProcessId -gt 0) {
            $SvcPid = [int]$SvcCim.ProcessId
            $ChildNodes = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $SvcPid AND Name = 'node.exe'" -ErrorAction SilentlyContinue)
            foreach ($Child in $ChildNodes) {
                $ChildProc = Get-Process -Id ([int]$Child.ProcessId) -ErrorAction SilentlyContinue
                if ($null -ne $ChildProc -and $null -ne $ChildProc.StartTime) {
                    $AgeSec = [int][Math]::Max(0, [Math]::Floor(((Get-Date) - $ChildProc.StartTime).TotalSeconds))
                    return @{
                        ProcessId  = [int]$ChildProc.Id
                        StartTime  = $ChildProc.StartTime
                        AgeSeconds = $AgeSec
                        Source     = "NSSM child node.exe"
                    }
                }
            }

            $SvcProc = Get-Process -Id $SvcPid -ErrorAction SilentlyContinue
            if ($null -ne $SvcProc -and $null -ne $SvcProc.StartTime) {
                $AgeSec = [int][Math]::Max(0, [Math]::Floor(((Get-Date) - $SvcProc.StartTime).TotalSeconds))
                return @{
                    ProcessId  = [int]$SvcProc.Id
                    StartTime  = $SvcProc.StartTime
                    AgeSeconds = $AgeSec
                    Source     = "Win32_Service ProcessId"
                }
            }
        }

        # 2. Fallback: inspect running node.exe processes matching the service entry script
        $Pattern = ""
        if ($ServiceName -eq "CPT_DB") {
            $Pattern = "db-server\.mjs"
        } elseif ($ServiceName -eq "CPT_Web") {
            $Pattern = "next.*start|server\.js"
        } elseif ($ServiceName -eq "CPT_Worker") {
            $Pattern = "overdue-worker\.mjs"
        } elseif ($ServiceName -eq "CPT_Agent") {
            $Pattern = "reader-agent\.mjs"
        }

        if (-not [string]::IsNullOrWhiteSpace($Pattern)) {
            $NodeProcs = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
            foreach ($NodeItem in $NodeProcs) {
                $CmdLine = [string]$NodeItem.CommandLine
                if ($CmdLine -match $Pattern) {
                    $ProcObj = Get-Process -Id ([int]$NodeItem.ProcessId) -ErrorAction SilentlyContinue
                    if ($null -ne $ProcObj -and $null -ne $ProcObj.StartTime) {
                        $AgeSec = [int][Math]::Max(0, [Math]::Floor(((Get-Date) - $ProcObj.StartTime).TotalSeconds))
                        return @{
                            ProcessId  = [int]$ProcObj.Id
                            StartTime  = $ProcObj.StartTime
                            AgeSeconds = $AgeSec
                            Source     = "node.exe process"
                        }
                    }
                }
            }
        }
    } catch {}
    return $null
}

function Test-TcpConnection {
    param(
        [string]$TargetHost,
        [int]$TargetPort,
        [int]$TimeoutMs = 1500
    )
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
        $AsyncResult = $Client.BeginConnect($TargetHost, $TargetPort, $null, $null)
        $WaitOk = $AsyncResult.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($WaitOk -and $Client.Connected) {
            $Client.EndConnect($AsyncResult)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        try { $Client.Close() } catch {}
    }
}

function Invoke-HealthCheck {
    param([string]$Url)
    $Result = @{
        WebResponded = $false
        StatusCode   = 0
        DbStatus     = "UNKNOWN"
        ErrorMessage = ""
    }

    try {
        $Req = [System.Net.HttpWebRequest]::Create($Url)
        $Req.Method = "GET"
        $Req.Timeout = 4000
        $Req.ReadWriteTimeout = 4000
        $Req.KeepAlive = $false

        try {
            $Resp = [System.Net.HttpWebResponse]$Req.GetResponse()
        } catch [System.Net.WebException] {
            if ($null -ne $_.Exception.Response) {
                $Resp = [System.Net.HttpWebResponse]$_.Exception.Response
            } else {
                $Result.ErrorMessage = $_.Exception.Message
                return $Result
            }
        }

        if ($null -ne $Resp) {
            $Result.WebResponded = $true
            $Result.StatusCode = [int]$Resp.StatusCode
            $Stream = $Resp.GetResponseStream()
            if ($null -ne $Stream) {
                $Reader = New-Object System.IO.StreamReader($Stream)
                $Body = $Reader.ReadToEnd()
                $Reader.Close()
                $Stream.Close()
                if (-not [string]::IsNullOrWhiteSpace($Body)) {
                    $Json = $Body | ConvertFrom-Json -ErrorAction SilentlyContinue
                    if ($null -ne $Json -and $null -ne $Json.checks -and $null -ne $Json.checks.database -and $null -ne $Json.checks.database.status) {
                        $Result.DbStatus = [string]$Json.checks.database.status
                    }
                }
            }
            $Resp.Close()
        }
    } catch {
        $Result.ErrorMessage = $_.Exception.Message
    }

    return $Result
}

function Restart-ManagedService {
    param(
        [string]$ServiceName,
        [switch]$GracefulDbShutdown
    )

    if ($GracefulDbShutdown) {
        Write-WatchdogLog "Sending graceful shutdown request to CPT_DB via POST $DbShutdownUrl..."
        try {
            $ShutdownReq = [System.Net.HttpWebRequest]::Create($DbShutdownUrl)
            $ShutdownReq.Method = "POST"
            $ShutdownReq.Timeout = 5000
            $ShutdownReq.ContentLength = 0
            $ShutdownResp = $ShutdownReq.GetResponse()
            if ($null -ne $ShutdownResp) {
                $ShutdownResp.Close()
            }
            Write-WatchdogLog "Graceful DB shutdown endpoint responded; waiting 2s for WAL flush..."
            Start-Sleep -Seconds 2
        } catch {
            Write-WatchdogLog "Graceful DB shutdown endpoint did not respond ($($_.Exception.Message)); proceeding with service restart."
        }
    }

    try {
        $Svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($null -ne $Svc) {
            Restart-Service -Name $ServiceName -Force -ErrorAction Stop
            Write-WatchdogLog "Service $ServiceName restarted successfully via Restart-Service."
        } else {
            & sc.exe stop $ServiceName | Out-Null
            Start-Sleep -Seconds 2
            & sc.exe start $ServiceName | Out-Null
            Write-WatchdogLog "Service $ServiceName restart triggered via sc.exe."
        }
    } catch {
        Write-WatchdogLog "Restart-Service for $ServiceName failed ($($_.Exception.Message)); attempting sc.exe fallback..."
        & sc.exe stop $ServiceName | Out-Null
        Start-Sleep -Seconds 2
        & sc.exe start $ServiceName | Out-Null
        Write-WatchdogLog "Service $ServiceName restart fallback completed via sc.exe."
    }
}

$State = Read-WatchdogState

# Immediately start any stopped CPT service (e.g., right after Windows boot) without waiting for failure thresholds
foreach ($SvcToStart in @($DbServiceName, "CPT_Agent", "CPT_Worker", $WebServiceName)) {
    $SvcObj = Get-Service -Name $SvcToStart -ErrorAction SilentlyContinue
    if ($null -ne $SvcObj -and $SvcObj.Status -eq "Stopped") {
        Write-WatchdogLog "Service $SvcToStart is currently Stopped; starting it immediately..."
        try {
            Start-Service -Name $SvcToStart -ErrorAction Stop
            if ($SvcToStart -eq $DbServiceName) {
                Start-Sleep -Seconds 3
            }
        } catch {
            & sc.exe start $SvcToStart | Out-Null
        }
    }
}

for ($CheckIndex = 1; $CheckIndex -le $MaxChecksPerRun; $CheckIndex++) {
    $TcpOk = Test-TcpConnection -TargetHost $DbHost -TargetPort $DbPort -TimeoutMs 1500
    $Health = Invoke-HealthCheck -Url $HealthUrl

    $IsDbFailure = (-not $TcpOk) -or ($Health.WebResponded -and $Health.DbStatus -ne "UP")
    $IsWebFailure = (-not $Health.WebResponded) -and $TcpOk

    if (-not $IsDbFailure -and -not $IsWebFailure) {
        if ($State.dbFailures -gt 0 -or $State.webFailures -gt 0) {
            Write-WatchdogLog "All checks healthy (TCP ${DbHost}:${DbPort}=UP, /api/health=HTTP $($Health.StatusCode), database.status=$($Health.DbStatus)). Resetting failure counters."
            $State.dbFailures = 0
            $State.webFailures = 0
            Save-WatchdogState -State $State
        }
        break
    }

    if ($IsDbFailure) {
        $State.dbFailures++
        $State.webFailures = 0
        Save-WatchdogState -State $State
        Write-WatchdogLog "DB check failed (attempt $CheckIndex/$MaxChecksPerRun; consecutive DB failures: $($State.dbFailures)/$FailureThreshold; tcp5432=$TcpOk; healthResponded=$($Health.WebResponded); httpStatus=$($Health.StatusCode); dbStatus=$($Health.DbStatus))."

        if ($State.dbFailures -ge $FailureThreshold) {
            $RestoreProc = Get-ActiveDbRestoreProcess
            if ($null -ne $RestoreProc) {
                Write-WatchdogLog "Skipping $DbServiceName restart: restore in progress (PID $($RestoreProc.ProcessId): $($RestoreProc.CommandLine))."
                break
            }

            $DbProcAge = Get-ServiceProcessAge -ServiceName $DbServiceName
            if ($null -ne $DbProcAge -and $DbProcAge.AgeSeconds -lt $StartupGracePeriodSeconds) {
                Write-WatchdogLog "Skipping $DbServiceName restart: service is within startup grace period ($($DbProcAge.Source) PID $($DbProcAge.ProcessId) started $($DbProcAge.AgeSeconds)s ago < ${StartupGracePeriodSeconds}s grace period)."
                break
            }

            $Now = Get-UnixEpochSeconds
            $Elapsed = $Now - $State.lastDbRestart
            if ($State.lastDbRestart -gt 0 -and $Elapsed -lt $CooldownSeconds) {
                $Remaining = $CooldownSeconds - $Elapsed
                Write-WatchdogLog "Cooldown active for $DbServiceName (last restart ${Elapsed}s ago, cooldown ${CooldownSeconds}s, ${Remaining}s remaining). Skipping $DbServiceName restart."
            } else {
                Write-WatchdogLog "DB failed $($State.dbFailures) consecutive checks (>= $FailureThreshold). Restarting $DbServiceName (NOT $WebServiceName)..."
                $State.lastDbRestart = $Now
                $State.dbFailures = 0
                Save-WatchdogState -State $State
                Restart-ManagedService -ServiceName $DbServiceName -GracefulDbShutdown
            }
            break
        }
    } elseif ($IsWebFailure) {
        $State.webFailures++
        $State.dbFailures = 0
        Save-WatchdogState -State $State
        Write-WatchdogLog "Web check failed: /api/health did not respond (attempt $CheckIndex/$MaxChecksPerRun; consecutive Web failures: $($State.webFailures)/$FailureThreshold; error: $($Health.ErrorMessage))."

        if ($State.webFailures -ge $FailureThreshold) {
            $WebProcAge = Get-ServiceProcessAge -ServiceName $WebServiceName
            if ($null -ne $WebProcAge -and $WebProcAge.AgeSeconds -lt $StartupGracePeriodSeconds) {
                Write-WatchdogLog "Skipping $WebServiceName restart: service is within startup grace period ($($WebProcAge.Source) PID $($WebProcAge.ProcessId) started $($WebProcAge.AgeSeconds)s ago < ${StartupGracePeriodSeconds}s grace period)."
                break
            }

            $Now = Get-UnixEpochSeconds
            $Elapsed = $Now - $State.lastWebRestart
            if ($State.lastWebRestart -gt 0 -and $Elapsed -lt $CooldownSeconds) {
                $Remaining = $CooldownSeconds - $Elapsed
                Write-WatchdogLog "Cooldown active for $WebServiceName (last restart ${Elapsed}s ago, cooldown ${CooldownSeconds}s, ${Remaining}s remaining). Skipping $WebServiceName restart."
            } else {
                Write-WatchdogLog "/api/health failed to respond $($State.webFailures) times in a row (>= $FailureThreshold). Restarting $WebServiceName..."
                $State.lastWebRestart = $Now
                $State.webFailures = 0
                Save-WatchdogState -State $State
                Restart-ManagedService -ServiceName $WebServiceName
            }
            break
        }
    }

    if ($CheckIndex -lt $MaxChecksPerRun) {
        Start-Sleep -Seconds $RetryDelaySeconds
    }
}
