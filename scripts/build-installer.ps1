#Requires -Version 5.1
<#
.SYNOPSIS
    Builds the standalone PhoneTracker production bundle, verifies runtime dependencies
    and security exclusions, tests the standalone server from an isolated directory,
    and compiles the Inno Setup 6 installer (PhoneTrackerSetup-<version>.exe).

.PARAMETER NodeZipPath
    Path to the official portable Windows x64 Node.js .zip archive from nodejs.org
    (must match the major Node.js version used in development).

.PARAMETER IsccPath
    Optional path to Inno Setup 6 compiler (ISCC.exe). Auto-detected if omitted.

.PARAMETER SkipNpmCi
    Optional switch to skip 'npm ci' if node_modules was just installed cleanly.
#>
param(
    [Parameter(Mandatory = $true, HelpMessage = "Path to the official nodejs.org Windows x64 .zip archive")]
    [string]$NodeZipPath,

    [string]$IsccPath = "",

    [switch]$SkipNpmCi = $false
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Company Phone Tracker - Production Installer Build" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Repository Root : $RepoRoot"

# ---------------------------------------------------------------------------
# 1. Read package.json version & verify dev Node.js version
# ---------------------------------------------------------------------------
$PkgJsonPath = Join-Path $RepoRoot "package.json"
if (-not (Test-Path $PkgJsonPath)) {
    throw "package.json not found at $PkgJsonPath"
}
$PkgJson = Get-Content $PkgJsonPath -Raw | ConvertFrom-Json
$AppVersion = $PkgJson.version
if ([string]::IsNullOrWhiteSpace($AppVersion)) {
    throw "Failed to read 'version' from package.json"
}
Write-Host "App Version     : $AppVersion"

$DevNodeVersionRaw = (& node -v).Trim()
if ($DevNodeVersionRaw -notmatch '^v(\d+)\.') {
    throw "Unable to parse development Node.js version: $DevNodeVersionRaw"
}
$DevNodeMajor = [int]$Matches[1]
Write-Host "Dev Node.js     : $DevNodeVersionRaw (Major: $DevNodeMajor)"

# ---------------------------------------------------------------------------
# 2. Verify portable Node.js zip & print SHA-256 (never download in script)
# ---------------------------------------------------------------------------
if (-not (Test-Path $NodeZipPath)) {
    throw "NodeZipPath does not exist: $NodeZipPath. Please provide the local path to an official nodejs.org .zip archive."
}
$ResolvedNodeZip = (Resolve-Path $NodeZipPath).Path
$NodeZipHash = (Get-FileHash -Path $ResolvedNodeZip -Algorithm SHA256).Hash
Write-Host "Node.js Archive : $ResolvedNodeZip"
Write-Host "Node.js SHA-256 : $NodeZipHash" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Locate Inno Setup 6 Compiler (ISCC.exe)
# ---------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($IsccPath)) {
    $CandidatePaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($Candidate in $CandidatePaths) {
        if (Test-Path $Candidate) {
            $IsccPath = $Candidate
            break
        }
    }
    if ([string]::IsNullOrWhiteSpace($IsccPath)) {
        $IsccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($IsccCmd) { $IsccPath = $IsccCmd.Source }
    }
}
if ([string]::IsNullOrWhiteSpace($IsccPath) -or -not (Test-Path $IsccPath)) {
    throw "Inno Setup 6 compiler (ISCC.exe) not found. Install Inno Setup 6 or pass -IsccPath."
}
Write-Host "Inno Setup ISCC : $IsccPath"

# ---------------------------------------------------------------------------
# 4. Verify next.config.mjs has output: "standalone"
# ---------------------------------------------------------------------------
$NextConfigPath = Join-Path $RepoRoot "next.config.mjs"
$NextConfigContent = Get-Content $NextConfigPath -Raw
if ($NextConfigContent -notmatch 'output\s*:\s*["'']standalone["'']') {
    throw "next.config.mjs must configure output: 'standalone'."
}
Write-Host "[OK] next.config.mjs has output: 'standalone'" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Clean previous staging directory & run npm ci + npm run build
# ---------------------------------------------------------------------------
$DistDir = Join-Path $RepoRoot "dist"
$StageRoot = Join-Path $DistDir "stage\PhoneTracker"
$TempExtractDir = Join-Path $DistDir "temp-node-extract"

if (Test-Path $StageRoot) {
    Remove-Item -Path $StageRoot -Recurse -Force
}
if (Test-Path $TempExtractDir) {
    Remove-Item -Path $TempExtractDir -Recurse -Force
}

if (-not $SkipNpmCi) {
    Write-Host "`n[1/7] Running npm ci..." -ForegroundColor Yellow
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed with exit code $LASTEXITCODE"
    }
} else {
    Write-Host "`n[1/7] Skipping npm ci (-SkipNpmCi specified)..." -ForegroundColor Yellow
}

Write-Host "`n[2/7] Generating Prisma client and running npm run build with a clean environment (dev .env isolated, site-specific vars unset)..." -ForegroundColor Yellow

# Read site-specific values from dev .env BEFORE isolating it so Step 5 can verify none leaked into stage
$DevEnvPath = Join-Path $RepoRoot ".env"
$DevEnvSecretsAndValues = [ordered]@{}
$SiteSpecificKeysToCheck = @(
    "NEXT_PUBLIC_APP_URL",
    "APP_URL",
    "DEPLOYMENT_ID",
    "SESSION_SECRET",
    "KIOSK_DEVICE_SECRET",
    "AGENT_PAIRING_SECRET",
    "BACKUP_MIRROR_DIR"
)
if (Test-Path $DevEnvPath) {
    foreach ($rawLine in (Get-Content $DevEnvPath -ErrorAction SilentlyContinue)) {
        $trimmed = $rawLine.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $eqIdx = $trimmed.IndexOf("=")
        if ($eqIdx -le 0) { continue }
        $k = $trimmed.Substring(0, $eqIdx).Trim()
        $v = $trimmed.Substring($eqIdx + 1).Trim().Trim('"').Trim("'")
        if ($SiteSpecificKeysToCheck -contains $k -and -not [string]::IsNullOrWhiteSpace($v)) {
            $DevEnvSecretsAndValues[$k] = $v
        }
    }
}

# Temporarily move any .env* files out of $RepoRoot so `next build` cannot read dev .env
$EnvStashDir = Join-Path $env:TEMP ("cpt-env-stash-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $EnvStashDir -Force | Out-Null
$StashedEnvFiles = @()

$SiteEnvVarsToUnset = @(
    "NEXT_PUBLIC_APP_URL",
    "APP_URL",
    "DEPLOYMENT_ID",
    "SESSION_SECRET",
    "KIOSK_DEVICE_SECRET",
    "AGENT_PAIRING_SECRET",
    "KIOSK_CODE",
    "KIOSK_USERNAME",
    "BACKUP_MIRROR_DIR",
    "PG_DATA_DIR",
    "BACKUP_DIR",
    "LOG_DIR",
    "DATA_DIR",
    "UPLOAD_DIR",
    "ENV_FILE_PATH",
    "APP_HOST",
    "PORT",
    "DATABASE_URL"
)
$SavedBuildProcessEnv = @{}
foreach ($VarName in $SiteEnvVarsToUnset) {
    $SavedBuildProcessEnv[$VarName] = [Environment]::GetEnvironmentVariable($VarName, "Process")
}

try {
    foreach ($EnvFileName in @(".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local")) {
        $CandidateEnv = Join-Path $RepoRoot $EnvFileName
        if (Test-Path $CandidateEnv) {
            $StashTarget = Join-Path $EnvStashDir $EnvFileName
            Move-Item -Path $CandidateEnv -Destination $StashTarget -Force
            $StashedEnvFiles += [PSCustomObject]@{ Original = $CandidateEnv; Stashed = $StashTarget }
            Write-Host "  Temporarily isolated $EnvFileName outside repo root for clean build"
        }
    }

    foreach ($VarName in $SiteEnvVarsToUnset) {
        [Environment]::SetEnvironmentVariable($VarName, $null, "Process")
    }
    # Provide only a generic local loopback DATABASE_URL for `prisma generate` schema validation
    $env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/company_phone_tracker?pgbouncer=true&connection_limit=1"

    # Remove previous .next build output so stale chunks or webpack cache cannot carry old NEXT_PUBLIC_* values
    $DotNextDir = Join-Path $RepoRoot ".next"
    if (Test-Path $DotNextDir) {
        Remove-Item -Path $DotNextDir -Recurse -Force
    }

    & npx.cmd prisma generate
    if ($LASTEXITCODE -ne 0) {
        throw "npx prisma generate failed with exit code $LASTEXITCODE"
    }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed with exit code $LASTEXITCODE"
    }
} finally {
    foreach ($Entry in $StashedEnvFiles) {
        if (Test-Path $Entry.Stashed) {
            Move-Item -Path $Entry.Stashed -Destination $Entry.Original -Force
            Write-Host "  Restored $($Entry.Original)"
        }
    }
    Remove-Item -Path $EnvStashDir -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($VarName in $SiteEnvVarsToUnset) {
        [Environment]::SetEnvironmentVariable($VarName, $SavedBuildProcessEnv[$VarName], "Process")
    }
}

$StandaloneSrc = Join-Path $RepoRoot ".next\standalone"
if (-not (Test-Path (Join-Path $StandaloneSrc "server.js"))) {
    throw "Standalone build output not found at $StandaloneSrc\server.js"
}

# ---------------------------------------------------------------------------
# 6. Stage standalone application in dist\stage\PhoneTracker
# ---------------------------------------------------------------------------
Write-Host "`n[3/7] Staging standalone bundle in dist\stage\PhoneTracker..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

# Copy ONLY the core Next.js standalone runtime artifacts (.next, node_modules, package.json, server.js)
# so over-traced project-root folders from process.cwd() are never copied into the production bundle
foreach ($CoreItem in @(".next", "node_modules", "package.json", "server.js")) {
    $SrcItem = Join-Path $StandaloneSrc $CoreItem
    $DstItem = Join-Path $StageRoot $CoreItem
    if (-not (Test-Path $SrcItem)) {
        throw "Missing core standalone item: $SrcItem"
    }
    Copy-Item -Path $SrcItem -Destination $DstItem -Recurse -Force
}

# Remove .next/cache from staged bundle if present (build cache is not needed at runtime)
$StagedNextCache = Join-Path $StageRoot ".next\cache"
if (Test-Path $StagedNextCache) {
    Remove-Item -Path $StagedNextCache -Recurse -Force
}

# Prepend .env & APP_HOST/PORT bootstrap to server.js so standalone server loads ENV_FILE_PATH / ProgramData\.env
$ServerJsPath = Join-Path $StageRoot "server.js"
$OriginalServerJs = Get-Content $ServerJsPath -Raw
$ServerBootstrap = @'
// --- PhoneTracker Standalone Environment Bootstrap ---
(function loadPhoneTrackerEnv() {
  const fs = require("fs");
  const path = require("path");
  const candidates = [
    process.env.ENV_FILE_PATH,
    "C:\\ProgramData\\PhoneTracker\\.env",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "PhoneTracker", ".env") : null,
    path.join(__dirname, ".env"),
  ].filter(Boolean);
  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq === -1) continue;
          const key = line.slice(0, eq).trim();
          let val = line.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
        break;
      }
    } catch (_) {}
  }
  if (!process.env.TZ) process.env.TZ = "Asia/Manila";
  if (!process.env.PORT) process.env.PORT = "5000";
  if (!process.env.HOSTNAME) process.env.HOSTNAME = process.env.APP_HOST || "0.0.0.0";
})();
// -----------------------------------------------------
'@
Set-Content -Path $ServerJsPath -Value ($ServerBootstrap + "`r`n" + $OriginalServerJs) -Encoding UTF8

# Copy .next/static into standalone/.next/static
$NextStaticSrc = Join-Path $RepoRoot ".next\static"
$NextStaticDst = Join-Path $StageRoot ".next\static"
New-Item -ItemType Directory -Path $NextStaticDst -Force | Out-Null
Copy-Item -Path "$NextStaticSrc\*" -Destination $NextStaticDst -Recurse -Force

# Copy public/ into standalone/public/ (excluding public/uploads/*)
$PublicSrc = Join-Path $RepoRoot "public"
$PublicDst = Join-Path $StageRoot "public"
if (Test-Path $PublicSrc) {
    New-Item -ItemType Directory -Path $PublicDst -Force | Out-Null
    Get-ChildItem -Path $PublicSrc -Force | Where-Object { $_.Name -ne "uploads" } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $PublicDst -Recurse -Force
    }
}

# Remove any devDependencies (except 'prisma' CLI) that Next.js file tracing may have copied into node_modules
$DevDepsToPrune = @($PkgJson.devDependencies.PSObject.Properties.Name | Where-Object { $_ -ne "prisma" })
foreach ($DevDep in $DevDepsToPrune) {
    $DevDepStagePath = Join-Path $StageRoot ("node_modules\" + ($DevDep -replace '/', '\'))
    if (Test-Path $DevDepStagePath) {
        Write-Host "  Pruning traced devDependency from stage: $DevDep"
        Remove-Item -Path $DevDepStagePath -Recurse -Force
    }
}

# Ensure runtime packages needed by standalone server, worker scripts, PGlite, and Prisma CLI are present
$RuntimePackages = @(
    ".prisma",
    "@electric-sql/pglite",
    "@electric-sql/pglite-socket",
    "@prisma/client",
    "@prisma/debug",
    "@prisma/engines",
    "@prisma/engines-version",
    "@prisma/fetch-engine",
    "@prisma/get-platform",
    "bcryptjs",
    "nodemailer",
    "prisma"
)

foreach ($Pkg in $RuntimePackages) {
    $PkgSrc = Join-Path $RepoRoot ("node_modules\" + ($Pkg -replace '/', '\'))
    $PkgDst = Join-Path $StageRoot ("node_modules\" + ($Pkg -replace '/', '\'))
    if (-not (Test-Path $PkgSrc)) {
        throw "Required runtime package missing in node_modules: $PkgSrc"
    }
    $ParentDir = Split-Path -Parent $PkgDst
    if (-not (Test-Path $ParentDir)) {
        New-Item -ItemType Directory -Path $ParentDir -Force | Out-Null
    }
    if (Test-Path $PkgDst) {
        Remove-Item -Path $PkgDst -Recurse -Force
    }
    Copy-Item -Path $PkgSrc -Destination $PkgDst -Recurse -Force
}

# Verify Prisma Windows query engine, Prisma CLI, and PGlite .wasm/.data files exist in stage
$QueryEngineFile  = Join-Path $StageRoot "node_modules\.prisma\client\query_engine-windows.dll.node"
$PrismaCliFile    = Join-Path $StageRoot "node_modules\prisma\build\index.js"
$PgliteDistDir    = Join-Path $StageRoot "node_modules\@electric-sql\pglite\dist"
$PgliteWasmFiles  = @(Get-ChildItem -Path $PgliteDistDir -Filter "*.wasm" -ErrorAction SilentlyContinue)
$PgliteDataFiles  = @(Get-ChildItem -Path $PgliteDistDir -Filter "*.data" -ErrorAction SilentlyContinue)
$PgliteSocketFile = Join-Path $StageRoot "node_modules\@electric-sql\pglite-socket\dist\index.cjs"

foreach ($RequiredRuntimeFile in @($QueryEngineFile, $PrismaCliFile, $PgliteSocketFile)) {
    if (-not (Test-Path $RequiredRuntimeFile)) {
        throw "Critical runtime file missing from staged bundle: $RequiredRuntimeFile"
    }
}
if ($PgliteWasmFiles.Count -eq 0 -or $PgliteDataFiles.Count -eq 0) {
    throw "Critical PGlite .wasm or .data files missing from $PgliteDistDir"
}
Write-Host "  [OK] Prisma Windows query engine, Prisma CLI, PGlite .wasm/.data ($($PgliteWasmFiles[0].Name), $($PgliteDataFiles[0].Name)), and pglite-socket verified." -ForegroundColor Green

# Copy only required runtime files:
# - agent/reader-agent.mjs
$AgentDst = Join-Path $StageRoot "agent"
New-Item -ItemType Directory -Path $AgentDst -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "agent\reader-agent.mjs") -Destination (Join-Path $AgentDst "reader-agent.mjs") -Force

# - kiosk-boot/ (without config.js)
$KioskBootDst = Join-Path $StageRoot "kiosk-boot"
New-Item -ItemType Directory -Path $KioskBootDst -Force | Out-Null
Get-ChildItem -Path (Join-Path $RepoRoot "kiosk-boot") -File | Where-Object { $_.Name -ne "config.js" } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination (Join-Path $KioskBootDst $_.Name) -Force
}

# - prisma/schema.prisma
$PrismaDst = Join-Path $StageRoot "prisma"
New-Item -ItemType Directory -Path $PrismaDst -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "prisma\schema.prisma") -Destination (Join-Path $PrismaDst "schema.prisma") -Force

# - tools/nssm.exe & tools/cloudflared.exe
$ToolsDst = Join-Path $StageRoot "tools"
New-Item -ItemType Directory -Path $ToolsDst -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "tools\nssm.exe") -Destination (Join-Path $ToolsDst "nssm.exe") -Force
if (Test-Path (Join-Path $RepoRoot "tools\cloudflared.exe")) {
    Copy-Item -Path (Join-Path $RepoRoot "tools\cloudflared.exe") -Destination (Join-Path $ToolsDst "cloudflared.exe") -Force
}

# - src/lib/notifications/core.mjs (imported by scripts/auto-heal-db.mjs)
$NotifDst = Join-Path $StageRoot "src\lib\notifications"
New-Item -ItemType Directory -Path $NotifDst -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "src\lib\notifications\core.mjs") -Destination (Join-Path $NotifDst "core.mjs") -Force

# - Allowed scripts from scripts/
$AllowedScripts = @(
    "db-server.mjs",
    "auto-heal-db.mjs",
    "backup-db.mjs",
    "restore-db.mjs",
    "overdue-worker.mjs",
    "tunnel-manager.mjs",
    "wait-for-pg.mjs",
    "install-services.ps1",
    "uninstall-services.ps1",
    "kiosk-watchdog.ps1",
    "edge-watchdog.ps1",
    "edge-watchdog.vbs",
    "create-admin.mjs",
    "seed-kiosk-account.mjs",
    "import-supervisors.mjs",
    "release-check.mjs",
    "stop-services.mjs",
    "configure-azure-server.ps1",
    "configure-kiosk-client.ps1"
)
$ScriptsDst = Join-Path $StageRoot "scripts"
New-Item -ItemType Directory -Path $ScriptsDst -Force | Out-Null
foreach ($ScriptName in $AllowedScripts) {
    $ScriptSrcPath = Join-Path $RepoRoot "scripts\$ScriptName"
    if (-not (Test-Path $ScriptSrcPath)) {
        throw "Required runtime script not found: $ScriptSrcPath"
    }
    Copy-Item -Path $ScriptSrcPath -Destination (Join-Path $ScriptsDst $ScriptName) -Force
}

# ---------------------------------------------------------------------------
# 7. Bundle Portable Node.js Runtime from official zip
# ---------------------------------------------------------------------------
Write-Host "`n[4/7] Bundling portable Node.js runtime..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $TempExtractDir -Force | Out-Null
Expand-Archive -Path $ResolvedNodeZip -DestinationPath $TempExtractDir -Force

$ExtractedNodeExe = Get-ChildItem -Path $TempExtractDir -Filter "node.exe" -Recurse | Select-Object -First 1
if (-not $ExtractedNodeExe) {
    throw "node.exe not found inside archive: $ResolvedNodeZip"
}

$BundledNodeVersionRaw = (& $ExtractedNodeExe.FullName -v).Trim()
if ($BundledNodeVersionRaw -notmatch '^v(\d+)\.') {
    throw "Could not determine version of bundled node.exe: $BundledNodeVersionRaw"
}
$BundledNodeMajor = [int]$Matches[1]
if ($BundledNodeMajor -ne $DevNodeMajor) {
    throw "Bundled Node.js major version ($BundledNodeVersionRaw -> v$BundledNodeMajor) does not match development Node.js major version ($DevNodeVersionRaw -> v$DevNodeMajor)."
}

$NodeDstDir = Join-Path $StageRoot "node"
New-Item -ItemType Directory -Path $NodeDstDir -Force | Out-Null
Copy-Item -Path $ExtractedNodeExe.FullName -Destination (Join-Path $NodeDstDir "node.exe") -Force
$NodeLicense = Join-Path $ExtractedNodeExe.DirectoryName "LICENSE"
if (Test-Path $NodeLicense) {
    Copy-Item -Path $NodeLicense -Destination (Join-Path $NodeDstDir "LICENSE") -Force
}
Remove-Item -Path $TempExtractDir -Recurse -Force
Write-Host "  [OK] Bundled portable Node.js $BundledNodeVersionRaw (matches dev major v$DevNodeMajor)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 8. Strict Exclusion & Dev .env / IP Leak Verification
# ---------------------------------------------------------------------------
Write-Host "`n[5/7] Auditing staged output for forbidden files, devDependencies, and dev .env / IP leaks..." -ForegroundColor Yellow

$Violations = New-Object System.Collections.Generic.List[string]

# Check top-level and nested forbidden paths
$ForbiddenRelativePaths = @(
    ".env",
    ".env.local",
    ".env.production",
    "backups",
    "postgres_data",
    "logs",
    "data",
    "public\uploads",
    "kiosk-boot\config.js",
    "scripts\seed.mjs"
)
foreach ($RelPath in $ForbiddenRelativePaths) {
    $Candidate = Join-Path $StageRoot $RelPath
    if (Test-Path $Candidate) {
        $Violations.Add("Forbidden path present in stage: $RelPath")
    }
}

# Check wildcard patterns across entire stage
$ForbiddenFilePatterns = @(
    "seed.mjs",
    "cleanup-*.mjs",
    "test-*.mjs",
    "benchmark-*.mjs",
    "*_REPORT.md"
)
foreach ($Pattern in $ForbiddenFilePatterns) {
    $MatchesFound = Get-ChildItem -Path $StageRoot -Filter $Pattern -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($MatchItem in $MatchesFound) {
        $Violations.Add("Forbidden file matching '$Pattern' present in stage: $($MatchItem.FullName)")
    }
}

# Check devDependencies from package.json (except 'prisma' CLI which is explicitly required for upgrades)
$DevDepNames = @($PkgJson.devDependencies.PSObject.Properties.Name | Where-Object { $_ -ne "prisma" })
foreach ($DevDep in $DevDepNames) {
    $DevDepPath = Join-Path $StageRoot ("node_modules\" + ($DevDep -replace '/', '\'))
    if (Test-Path $DevDepPath) {
        $Violations.Add("Forbidden devDependency present in stage node_modules: $DevDep")
    }
}

# Verify scripts/ contains ONLY the 15 allowed scripts
$StagedScripts = Get-ChildItem -Path $ScriptsDst -Force
foreach ($StagedScript in $StagedScripts) {
    if ($AllowedScripts -notcontains $StagedScript.Name) {
        $Violations.Add("Unauthorized script in staged scripts/: $($StagedScript.Name)")
    }
}

# Verify scripts/seed.mjs in repo refuses to run when NODE_ENV=production
$PrevNodeEnv = $env:NODE_ENV
$PrevEap = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $env:NODE_ENV = "production"
    $SeedOutput = & node (Join-Path $RepoRoot "scripts\seed.mjs") 2>&1
    $SeedExit = $LASTEXITCODE
} finally {
    $env:NODE_ENV = $PrevNodeEnv
    $ErrorActionPreference = $PrevEap
}
if ($SeedExit -eq 0) {
    $Violations.Add("scripts/seed.mjs did NOT refuse to run when NODE_ENV=production!")
} else {
    Write-Host "  [OK] scripts/seed.mjs refused to run under NODE_ENV=production (exit code $SeedExit)" -ForegroundColor Green
}

# Scan staged output (excluding third-party node_modules and binary .exe/.dll/.wasm/.data) for "192.168." and every site-specific value from dev .env
$FilesToScanForLeaks = @(
    Get-ChildItem -Path (Join-Path $StageRoot ".next") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "scripts") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "agent") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "kiosk-boot") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "prisma") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "public") -Recurse -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Join-Path $StageRoot "src") -Recurse -File -ErrorAction SilentlyContinue
    Get-Item -Path (Join-Path $StageRoot "server.js") -ErrorAction SilentlyContinue
    Get-Item -Path (Join-Path $StageRoot "package.json") -ErrorAction SilentlyContinue
) | Where-Object { $null -ne $_ }

$IpLeakMatches = @($FilesToScanForLeaks | Select-String -SimpleMatch "192.168." -ErrorAction SilentlyContinue)
if ($IpLeakMatches.Count -gt 0) {
    foreach ($m in $IpLeakMatches) {
        $Violations.Add("Leaked LAN IP prefix '192.168.' found in staged file: $($m.Path):$($m.LineNumber)")
    }
} else {
    Write-Host "  [OK] Leak check passed: 0 occurrences of '192.168.' across $($FilesToScanForLeaks.Count) staged app/server/script files." -ForegroundColor Green
}

foreach ($Key in $DevEnvSecretsAndValues.Keys) {
    $Val = $DevEnvSecretsAndValues[$Key]
    $DisplayVal = if ($Key -match "SECRET") { "$($Val.Substring(0, 6))...<redacted>" } else { $Val }
    $LeakHits = @($FilesToScanForLeaks | Select-String -SimpleMatch $Val -ErrorAction SilentlyContinue)
    if ($LeakHits.Count -gt 0) {
        foreach ($h in $LeakHits) {
            $Violations.Add("Leaked dev .env value for $Key ($DisplayVal) found in staged file: $($h.Path):$($h.LineNumber)")
        }
    } else {
        Write-Host "  [OK] Leak check passed: dev .env $Key ($DisplayVal) not present in staged output." -ForegroundColor Green
    }
}

if ($Violations.Count -gt 0) {
    Write-Host "`n[FATAL] Stage exclusion / leak audit failed:" -ForegroundColor Red
    foreach ($v in $Violations) {
        Write-Host "  - $v" -ForegroundColor Red
    }
    throw "Build failed due to stage exclusion or dev .env leak policy violations."
}
Write-Host "  [OK] Zero forbidden files, devDependencies, or dev .env leaks in staged output." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 9. Smoke-test Standalone Server + PGlite + Prisma CLI from an external folder
# ---------------------------------------------------------------------------
Write-Host "`n[6/7] Smoke-testing standalone bundle from an external temp directory..." -ForegroundColor Yellow
$SmokeRoot = Join-Path $env:TEMP ("cpt-build-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$SmokeAppDir = Join-Path $SmokeRoot "app"
$SmokeDataDir = Join-Path $SmokeRoot "data-root"
$SmokeWorkDir = Join-Path $SmokeRoot "outside-cwd"

New-Item -ItemType Directory -Path $SmokeAppDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $SmokeDataDir "postgres_data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $SmokeDataDir "backups") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $SmokeDataDir "logs") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $SmokeDataDir "data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $SmokeDataDir "uploads") -Force | Out-Null
New-Item -ItemType Directory -Path $SmokeWorkDir -Force | Out-Null

Copy-Item -Path "$StageRoot\*" -Destination $SmokeAppDir -Recurse -Force

$SmokeEnvFile = Join-Path $SmokeDataDir ".env"
@"
NODE_ENV="production"
DEPLOYMENT_ID="smoke-test-deployment"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:15432/company_phone_tracker?pgbouncer=true&connection_limit=1"
PGHOST="127.0.0.1"
PGPORT="15432"
PG_CONTROL_PORT="15433"
SESSION_SECRET="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
KIOSK_DEVICE_SECRET="fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
AGENT_PAIRING_SECRET="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
KIOSK_CODE="SMOKE-KIOSK-01"
APP_HOST="127.0.0.1"
PORT="15000"
PG_DATA_DIR="$($SmokeDataDir -replace '\\','/')/postgres_data"
BACKUP_DIR="$($SmokeDataDir -replace '\\','/')/backups"
LOG_DIR="$($SmokeDataDir -replace '\\','/')/logs"
DATA_DIR="$($SmokeDataDir -replace '\\','/')/data"
UPLOAD_DIR="$($SmokeDataDir -replace '\\','/')/uploads"
"@ | Set-Content -Path $SmokeEnvFile -Encoding UTF8

$SmokeNodeExe = Join-Path $SmokeAppDir "node\node.exe"
$DbProc = $null
$WebProc = $null

$SavedEnv = @{
    ENV_FILE_PATH   = $env:ENV_FILE_PATH
    PG_DATA_DIR     = $env:PG_DATA_DIR
    BACKUP_DIR      = $env:BACKUP_DIR
    LOG_DIR         = $env:LOG_DIR
    DATA_DIR        = $env:DATA_DIR
    UPLOAD_DIR      = $env:UPLOAD_DIR
    DATABASE_URL    = $env:DATABASE_URL
    PGHOST          = $env:PGHOST
    PGPORT          = $env:PGPORT
    PG_CONTROL_PORT = $env:PG_CONTROL_PORT
    NODE_ENV        = $env:NODE_ENV
    PORT            = $env:PORT
    HOSTNAME        = $env:HOSTNAME
}

try {
    $env:ENV_FILE_PATH   = $SmokeEnvFile
    $env:PG_DATA_DIR     = Join-Path $SmokeDataDir "postgres_data"
    $env:BACKUP_DIR      = Join-Path $SmokeDataDir "backups"
    $env:LOG_DIR         = Join-Path $SmokeDataDir "logs"
    $env:DATA_DIR        = Join-Path $SmokeDataDir "data"
    $env:UPLOAD_DIR      = Join-Path $SmokeDataDir "uploads"
    $env:DATABASE_URL    = "postgresql://postgres:postgres@127.0.0.1:15432/company_phone_tracker?pgbouncer=true&connection_limit=1"
    $env:PGHOST          = "127.0.0.1"
    $env:PGPORT          = "15432"
    $env:PG_CONTROL_PORT = "15433"
    $env:NODE_ENV        = "production"
    $env:PORT            = "15000"
    $env:HOSTNAME        = "127.0.0.1"

    # Start PGlite db-server from outside working directory
    $DbProc = Start-Process -FilePath $SmokeNodeExe `
        -ArgumentList "`"$SmokeAppDir\scripts\db-server.mjs`"" `
        -WorkingDirectory $SmokeWorkDir `
        -PassThru -WindowStyle Hidden

    $ErrorActionPreference = "Continue"
    & $SmokeNodeExe "$SmokeAppDir\scripts\wait-for-pg.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Smoke test wait-for-pg failed" }

    # Push schema using bundled Prisma CLI
    & $SmokeNodeExe "$SmokeAppDir\node_modules\prisma\build\index.js" db push --schema="$SmokeAppDir\prisma\schema.prisma" --skip-generate
    if ($LASTEXITCODE -ne 0) { throw "Smoke test prisma db push failed" }

    # Seed kiosk account and take initial backup so /api/health is 100% healthy
    & $SmokeNodeExe "$SmokeAppDir\scripts\seed-kiosk-account.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Smoke test seed-kiosk-account failed" }

    & $SmokeNodeExe "$SmokeAppDir\scripts\backup-db.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Smoke test backup-db failed" }
    $ErrorActionPreference = "Stop"

    # Start Next.js standalone server from outside working directory
    $WebProc = Start-Process -FilePath $SmokeNodeExe `
        -ArgumentList "`"$SmokeAppDir\server.js`"" `
        -WorkingDirectory $SmokeWorkDir `
        -PassThru -WindowStyle Hidden

    $HealthOk = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $Resp = Invoke-RestMethod -Uri "http://127.0.0.1:15000/api/health" -TimeoutSec 3 -ErrorAction Stop
            if ($Resp.checks.database.status -eq "UP") {
                $HealthOk = $true
                Write-Host "  [OK] Standalone /api/health returned status=$($Resp.status), database=$($Resp.checks.database.status), backup=$($Resp.checks.backup.status)" -ForegroundColor Green
                break
            }
        } catch {}
    }
    if (-not $HealthOk) {
        throw "Smoke test standalone server /api/health did not become healthy within 30s."
    }
} finally {
    if ($WebProc -and -not $WebProc.HasExited) {
        Stop-Process -Id $WebProc.Id -Force -ErrorAction SilentlyContinue
    }
    try {
        Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:15433/shutdown" -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
    } catch {}
    Start-Sleep -Seconds 1
    if ($DbProc -and -not $DbProc.HasExited) {
        Stop-Process -Id $DbProc.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($Key in $SavedEnv.Keys) {
        Set-Item -Path "env:$Key" -Value $SavedEnv[$Key]
    }
    Remove-Item -Path $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 10. Compile Inno Setup Installer (PhoneTrackerSetup-<version>.exe)
# ---------------------------------------------------------------------------
Write-Host "`n[7/7] Compiling Inno Setup installer with ISCC.exe..." -ForegroundColor Yellow
$IssPath = Join-Path $RepoRoot "installer\PhoneTrackerSetup.iss"
if (-not (Test-Path $IssPath)) {
    throw "Inno Setup script not found at $IssPath"
}

& $IsccPath "/Qp" "/DMyAppVersion=$AppVersion" $IssPath
if ($LASTEXITCODE -ne 0) {
    throw "ISCC.exe failed with exit code $LASTEXITCODE"
}

$InstallerExe = Join-Path $DistDir "PhoneTrackerSetup-$AppVersion.exe"
if (-not (Test-Path $InstallerExe)) {
    throw "Expected installer output not found: $InstallerExe"
}
$InstallerHash = (Get-FileHash -Path $InstallerExe -Algorithm SHA256).Hash
$InstallerSizeMB = [math]::Round((Get-Item $InstallerExe).Length / 1MB, 2)

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " BUILD SUCCEEDED" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Installer Path   : $InstallerExe"
Write-Host "Installer Size   : $InstallerSizeMB MB"
Write-Host "Installer SHA256 : $InstallerHash"
Write-Host "Node.js SHA256   : $NodeZipHash"
Write-Host "==========================================================" -ForegroundColor Green
