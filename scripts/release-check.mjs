#!/usr/bin/env node
/**
 * Company Phone Tracker (NEXUS) — Automated Production Release Readiness Check
 *
 * Read-only verification script for a headless kiosk mini PC deployment.
 * Prints PASS / FAIL / WARN / SKIP per item and exits non-zero on any FAIL.
 * Does NOT modify or delete any data.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  getBackupDir,
  getBackupStatusFile,
  listBackupFilesNewestFirst,
  verifyBackupFile,
  resolveEnvFilePath,
  loadEnvIfNeeded,
} from "./backup-db.mjs";

loadEnvIfNeeded();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = fs.existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))
  ? process.cwd()
  : path.resolve(__dirname, "..");
const ENV_PATH = resolveEnvFilePath();

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
  return vars;
}

const dotEnv = parseEnvFile(ENV_PATH);
const PORT = process.env.PORT || dotEnv.PORT || "5000";
const BASE_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

let passCount = 0;
let failCount = 0;
let warnCount = 0;
let skipCount = 0;
const failedItems = [];
const warnedItems = [];

function recordResult(status, label, detail = "") {
  const tag = `[${status}]`.padEnd(7, " ");
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${tag} ${label}${suffix}`);
  if (status === "PASS") passCount++;
  else if (status === "FAIL") {
    failCount++;
    failedItems.push(`${label}${suffix}`);
  } else if (status === "WARN") {
    warnCount++;
    warnedItems.push(`${label}${suffix}`);
  } else if (status === "SKIP") {
    skipCount++;
  }
}

function runCmdSafe(command) {
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8000,
    });
    return { ok: true, output: stdout || "" };
  } catch (err) {
    const stdout = err?.stdout ? String(err.stdout) : "";
    const stderr = err?.stderr ? String(err.stderr) : "";
    return {
      ok: false,
      code: err?.status ?? 1,
      output: `${stdout}\n${stderr}`.trim(),
    };
  }
}

// ============================================================================
// 1. Windows Services (CPT_DB, CPT_Web, CPT_Worker, CPT_Agent) & Watchdog Tasks
// ============================================================================
function checkWindowsServicesAndTasks() {
  console.log("\n--- 1. Windows Services & Scheduled Watchdog Tasks ---");
  const services = ["CPT_DB", "CPT_Web", "CPT_Worker", "CPT_Agent"];
  let anyServiceInstalled = false;

  for (const svc of services) {
    const res = runCmdSafe(`sc query "${svc}"`);
    const out = res.output;
    if (
      out.includes("1060") ||
      /does not exist as an installed service/i.test(out)
    ) {
      recordResult("SKIP", `Service ${svc}`, "Not installed on this machine (dev environment)");
      continue;
    }
    anyServiceInstalled = true;
    const stateMatch = out.match(/STATE\s*:\s*\d+\s+([A-Z_]+)/i);
    const state = stateMatch ? stateMatch[1].toUpperCase() : "UNKNOWN";
    if (state === "RUNNING") {
      recordResult("PASS", `Service ${svc}`, "STATE = RUNNING");
    } else {
      recordResult("FAIL", `Service ${svc}`, `Expected RUNNING, got STATE = ${state}`);
    }
  }

  const tasks = ["CPT_Service_Watchdog", "CPT_Edge_Watchdog"];
  for (const taskName of tasks) {
    const res = runCmdSafe(`schtasks /query /TN "${taskName}"`);
    if (res.ok) {
      recordResult("PASS", `Scheduled Task ${taskName}`, "Registered");
    } else if (
      !anyServiceInstalled &&
      (/cannot find the file specified/i.test(res.output) ||
        /does not exist/i.test(res.output))
    ) {
      recordResult(
        "SKIP",
        `Scheduled Task ${taskName}`,
        "Not registered on this machine (dev environment)"
      );
    } else {
      recordResult("FAIL", `Scheduled Task ${taskName}`, "Task is not registered");
    }
  }
}

// ============================================================================
// 2. /api/health -> 200, database UP, backup not stale, mirror OK if configured
// ============================================================================
async function checkHealthEndpoint() {
  console.log("\n--- 2. Health Endpoint (/api/health) ---");
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => null);

    if (res.status === 200) {
      recordResult("PASS", "GET /api/health HTTP status", `200 OK (status=${data?.status})`);
    } else {
      recordResult(
        "FAIL",
        "GET /api/health HTTP status",
        `Expected 200, got ${res.status} (status=${data?.status ?? "unknown"})`
      );
    }

    const dbStatus = data?.checks?.database?.status;
    if (dbStatus === "UP") {
      recordResult(
        "PASS",
        "/api/health database check",
        `UP (latency=${data?.checks?.database?.latencyMs ?? "?"}ms)`
      );
    } else {
      recordResult(
        "FAIL",
        "/api/health database check",
        `Expected UP, got ${dbStatus ?? "missing"}`
      );
    }

    const backupStatus = data?.checks?.backup?.status;
    if (backupStatus === "UP") {
      recordResult(
        "PASS",
        "/api/health backup freshness",
        `Not stale (lastBackupAt=${data?.lastBackupAt ?? "n/a"}, ageMinutes=${data?.checks?.backup?.ageMinutes ?? "?"})`
      );
    } else {
      recordResult(
        "FAIL",
        "/api/health backup freshness",
        `Backup check is ${backupStatus ?? "missing"} (${data?.checks?.backup?.error || "stale or missing backup"})`
      );
    }

    // Mirror check if configured
    const backupStatusFile = getBackupStatusFile();
    let statusFileJson = null;
    if (fs.existsSync(backupStatusFile)) {
      try {
        statusFileJson = JSON.parse(fs.readFileSync(backupStatusFile, "utf8"));
      } catch {}
    }
    const mirrorConfigured = Boolean(
      (process.env.BACKUP_MIRROR_DIR || dotEnv.BACKUP_MIRROR_DIR || "").trim() ||
        statusFileJson?.mirrorConfigured
    );

    if (!mirrorConfigured) {
      recordResult("PASS", "/api/health backup mirror", "Mirror not configured (optional)");
    } else if (data?.lastMirrorOk === true) {
      recordResult(
        "PASS",
        "/api/health backup mirror",
        `Mirror OK (mirrorDir=${statusFileJson?.mirrorDir || "configured"})`
      );
    } else {
      recordResult(
        "FAIL",
        "/api/health backup mirror",
        `Mirror configured but lastMirrorOk=${data?.lastMirrorOk} (error=${data?.lastMirrorError || "none"})`
      );
    }
  } catch (err) {
    recordResult(
      "FAIL",
      "GET /api/health reachable",
      `Unreachable at ${BASE_URL}/api/health: ${err.message}`
    );
  }
}

// ============================================================================
// 3. Newest backup < 1h old, matching DEPLOYMENT_ID, valid SHA-256
// ============================================================================
function checkNewestBackup() {
  console.log("\n--- 3. Newest Database Backup Verification ---");
  const backupDir = getBackupDir();
  const files = listBackupFilesNewestFirst(backupDir);
  if (files.length === 0) {
    recordResult("FAIL", "Newest backup exists", `No backup files found in ${backupDir}`);
    return;
  }

  const newestFile = files[0];
  const newestPath = path.join(backupDir, newestFile);
  const verification = verifyBackupFile(newestPath);

  if (verification.valid) {
    recordResult(
      "PASS",
      "Newest backup SHA-256 integrity",
      `${newestFile} (sha256=${verification.hash.slice(0, 16)}...)`
    );
  } else {
    recordResult(
      "FAIL",
      "Newest backup SHA-256 integrity",
      `${newestFile} failed verification: ${verification.reason}`
    );
    return;
  }

  const createdAtStr = verification.payload?.createdAt;
  const statMtimeMs = fs.statSync(newestPath).mtimeMs;
  const backupTimeMs = createdAtStr ? new Date(createdAtStr).getTime() : statMtimeMs;
  const ageMs = Date.now() - backupTimeMs;
  const ageMinutes = Math.round(ageMs / 60000);

  if (Number.isFinite(ageMs) && ageMs <= 60 * 60 * 1000) {
    recordResult(
      "PASS",
      "Newest backup age (< 1h)",
      `${ageMinutes} minute(s) old (createdAt=${createdAtStr || new Date(statMtimeMs).toISOString()})`
    );
  } else {
    recordResult(
      "FAIL",
      "Newest backup age (< 1h)",
      `Backup is ${ageMinutes} minute(s) old (> 60 minutes; createdAt=${createdAtStr || new Date(statMtimeMs).toISOString()})`
    );
  }

  const expectedDeploymentId = (
    process.env.DEPLOYMENT_ID ||
    dotEnv.DEPLOYMENT_ID ||
    ""
  ).trim();
  const backupDeploymentId = (verification.payload?.deploymentId || "").trim();

  if (expectedDeploymentId && backupDeploymentId === expectedDeploymentId) {
    recordResult(
      "PASS",
      "Newest backup DEPLOYMENT_ID match",
      `Matches .env DEPLOYMENT_ID (len ${backupDeploymentId.length})`
    );
  } else {
    recordResult(
      "FAIL",
      "Newest backup DEPLOYMENT_ID match",
      `Backup deploymentId (${backupDeploymentId || "missing"}) != expected (${expectedDeploymentId || "missing"})`
    );
  }
}

// ============================================================================
// 4. Agent listens ONLY on 127.0.0.1:8002 (not 0.0.0.0)
// ============================================================================
function checkAgentBinding() {
  console.log("\n--- 4. Local NFC Agent Network Binding (Port 8002) ---");
  const psRes = runCmdSafe(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress"`
  );

  let addresses = [];
  if (psRes.ok && psRes.output.trim()) {
    addresses = psRes.output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const netstatRes = runCmdSafe(`netstat -ano`);
    const lines = netstatRes.output.split(/\r?\n/);
    for (const line of lines) {
      if (!/LISTENING/i.test(line)) continue;
      const m = line.match(/^\s*TCP\s+(\S+):8002\s+/i);
      if (m) addresses.push(m[1]);
    }
  }

  if (addresses.length === 0) {
    recordResult("FAIL", "Agent listening on 127.0.0.1:8002", "No process listening on TCP port 8002");
    return;
  }

  const exposed = addresses.filter(
    (addr) => addr === "0.0.0.0" || addr === "::" || addr === "[::]" || addr === "*"
  );
  const loopbackOnly = addresses.every((addr) => addr === "127.0.0.1");

  if (loopbackOnly && exposed.length === 0) {
    recordResult(
      "PASS",
      "Agent bound strictly to loopback",
      `Listening on ${addresses.join(", ")}:8002 (not bound to 0.0.0.0)`
    );
  } else {
    recordResult(
      "FAIL",
      "Agent bound strictly to loopback",
      `Port 8002 is bound to [${addresses.join(", ")}] — must only bind to 127.0.0.1`
    );
  }
}

// ============================================================================
// 5. Unauthenticated POST /api/kiosk/resolve, /custody, /attended-approve -> 401
// 6. GET /api/kiosk/device-login with no key -> redirects to not-provisioned
// ============================================================================
async function checkKioskAuthConfinement() {
  console.log("\n--- 5 & 6. Kiosk Endpoint Authentication & Device-Login Guard ---");
  const protectedEndpoints = [
    { path: "/api/kiosk/resolve", body: { cardUid: "04A28B7168" } },
    { path: "/api/kiosk/custody", body: {} },
    { path: "/api/kiosk/attended-approve", body: {} },
  ];

  for (const ep of protectedEndpoints) {
    try {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ep.body),
        redirect: "manual",
      });
      if (res.status === 401) {
        recordResult("PASS", `Unauthenticated POST ${ep.path}`, "Returns 401 Unauthorized");
      } else {
        recordResult(
          "FAIL",
          `Unauthenticated POST ${ep.path}`,
          `Expected 401, got ${res.status}`
        );
      }
    } catch (err) {
      recordResult(
        "FAIL",
        `Unauthenticated POST ${ep.path}`,
        `Request failed: ${err.message}`
      );
    }
  }

  // Check /api/kiosk/device-login auto-provisioning redirect
  try {
    const res = await fetch(`${BASE_URL}/api/kiosk/device-login`, {
      method: "GET",
      redirect: "manual",
    });
    const location = res.headers.get("location") || "";
    if (
      (res.status === 307 || res.status === 302) &&
      location.includes("/kiosk")
    ) {
      recordResult(
        "PASS",
        "GET /api/kiosk/device-login (auto-provisioned)",
        `Redirects (${res.status}) to ${location}`
      );
    } else {
      recordResult(
        "FAIL",
        "GET /api/kiosk/device-login (auto-provisioned)",
        `Expected redirect to /kiosk, got status=${res.status} location=${location}`
      );
    }
  } catch (err) {
    recordResult(
      "FAIL",
      "GET /api/kiosk/device-login (auto-provisioned)",
      `Request failed: ${err.message}`
    );
  }
}

// ============================================================================
// 7. .env Production Secrets (32+ chars) & DEPLOYMENT_ID (print only lengths)
// 8. Production build present (.next/BUILD_ID)
// ============================================================================
function checkEnvSecretsAndBuild() {
  console.log("\n--- 7 & 8. Environment Secrets & Production Build Artifact ---");
  if (!fs.existsSync(ENV_PATH)) {
    recordResult("FAIL", ".env file exists", "Missing .env file in project root");
  } else {
    const requiredSecrets = [
      "SESSION_SECRET",
      "KIOSK_DEVICE_SECRET",
      "AGENT_PAIRING_SECRET",
    ];
    for (const key of requiredSecrets) {
      const val = (dotEnv[key] || "").trim();
      if (!val) {
        recordResult("FAIL", `.env ${key}`, "missing (len 0)");
      } else if (val.length < 32) {
        recordResult(
          "FAIL",
          `.env ${key}`,
          `present (len ${val.length}) — must be at least 32 chars`
        );
      } else {
        recordResult("PASS", `.env ${key}`, `present (len ${val.length})`);
      }
    }

    const deployId = (dotEnv.DEPLOYMENT_ID || "").trim();
    if (deployId.length > 0) {
      recordResult("PASS", ".env DEPLOYMENT_ID", `present (len ${deployId.length})`);
    } else {
      recordResult("FAIL", ".env DEPLOYMENT_ID", "missing (len 0)");
    }
  }

  const buildIdPath = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
  if (fs.existsSync(buildIdPath)) {
    const buildId = fs.readFileSync(buildIdPath, "utf8").trim();
    if (buildId) {
      recordResult("PASS", "Production build (.next/BUILD_ID)", `present (buildId=${buildId})`);
    } else {
      recordResult("FAIL", "Production build (.next/BUILD_ID)", ".next/BUILD_ID is empty");
    }
  } else {
    recordResult("FAIL", "Production build (.next/BUILD_ID)", "Missing .next/BUILD_ID — run npm run build");
  }
}

// ============================================================================
// 9. Database Accounts & Maintenance Card Check (Read-Only)
// ============================================================================
async function checkDatabaseState() {
  console.log("\n--- 9. Database Admin Account & Maintenance NFC Card ---");
  const prisma = new PrismaClient();
  try {
    const activeAdmins = await prisma.user.count({
      where: {
        isActive: true,
        userRoles: {
          some: {
            role: { code: "SYSTEM_ADMIN" },
          },
        },
      },
    });

    if (activeAdmins >= 1) {
      recordResult(
        "PASS",
        "Active SYSTEM_ADMIN user exists",
        `${activeAdmins} active SYSTEM_ADMIN account(s)`
      );
    } else {
      recordResult(
        "FAIL",
        "Active SYSTEM_ADMIN user exists",
        "0 active SYSTEM_ADMIN accounts found"
      );
    }

    const maintenanceCards = await prisma.nfcCard.count({
      where: {
        isMaintenanceCard: true,
        status: "ACTIVE",
      },
    });

    if (maintenanceCards >= 1) {
      recordResult(
        "PASS",
        "Maintenance NFC card enrolled",
        `${maintenanceCards} active maintenance card(s) enrolled`
      );
    } else {
      recordResult(
        "WARN",
        "Maintenance NFC card enrolled",
        "0 active maintenance cards enrolled (enroll one in /nfc-cards before unattended deployment)"
      );
    }
  } catch (err) {
    recordResult("FAIL", "Database query check", `Could not query database: ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// ============================================================================
// 10. Seeded Demo Passwords Must NOT Work (Read-Only, 1 Check Each)
// ============================================================================
async function checkDemoPasswordsRejected() {
  console.log("\n--- 10. Seeded Demo Passwords Rejected (1 Attempt Each, Read-Only) ---");
  const demoAccounts = [
    { email: "admin@company.com", password: "AdminPassword123!" },
    { email: "hr@company.com", password: "HrPassword123!" },
    { email: "kiosk@company.com", password: "KioskPassword123!" },
    { email: "custodian@company.com", password: "Custodian123!" },
    { email: "supervisor@company.com", password: "Supervisor123!" },
    { email: "itsupport@company.com", password: "ITSupport123!" },
    { email: "auditor@company.com", password: "Auditor123!" },
  ];

  const prisma = new PrismaClient();
  try {
    for (const acct of demoAccounts) {
      const user = await prisma.user.findUnique({
        where: { email: acct.email },
        select: { id: true, email: true, isActive: true, passwordHash: true },
      });

      if (!user) {
        recordResult(
          "PASS",
          `Demo password rejected for ${acct.email}`,
          "Account does not exist"
        );
        continue;
      }

      if (!user.isActive) {
        recordResult(
          "PASS",
          `Demo password rejected for ${acct.email}`,
          "Account is inactive (cannot log in)"
        );
        continue;
      }

      const matches = await bcrypt.compare(acct.password, user.passwordHash);
      if (!matches) {
        recordResult(
          "PASS",
          `Demo password rejected for ${acct.email}`,
          "Seeded demo password does not match"
        );
      } else {
        recordResult(
          "FAIL",
          `Demo password rejected for ${acct.email}`,
          `Seeded demo password (${acct.password}) is still active for ${acct.email} — MUST change password before production!`
        );
      }
    }
  } catch (err) {
    recordResult(
      "FAIL",
      "Demo password check",
      `Failed to verify demo passwords: ${err.message}`
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// ============================================================================
// 11 & 12. Windows Registry WaitToKillServiceTimeout & Power Plan Settings
// ============================================================================
function checkWindowsHostConfiguration() {
  console.log("\n--- 11 & 12. Windows Host Registry & Power Configuration ---");

  // 11. WaitToKillServiceTimeout >= 20000
  const regRes = runCmdSafe(
    `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name 'WaitToKillServiceTimeout' -ErrorAction SilentlyContinue).WaitToKillServiceTimeout"`
  );
  const timeoutVal = Number.parseInt(regRes.output.trim(), 10);
  if (Number.isFinite(timeoutVal) && timeoutVal >= 20000) {
    recordResult(
      "PASS",
      "Registry WaitToKillServiceTimeout >= 20000",
      `${timeoutVal} ms`
    );
  } else {
    recordResult(
      "FAIL",
      "Registry WaitToKillServiceTimeout >= 20000",
      `Current value is ${Number.isFinite(timeoutVal) ? `${timeoutVal} ms` : "unset"} (run scripts/install-services.ps1 as Administrator to set 20000 ms)`
    );
  }

  // 12a. USB selective suspend disabled on active power plan (warn only)
  const usbRes = runCmdSafe(
    `powercfg /query SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226`
  );
  const usbAcMatch = usbRes.output.match(/Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)/i);
  const usbAcIndex = usbAcMatch ? Number.parseInt(usbAcMatch[1], 16) : null;
  if (usbAcIndex === 0) {
    recordResult(
      "PASS",
      "USB selective suspend on AC power",
      "Disabled (0x00000000)"
    );
  } else {
    recordResult(
      "WARN",
      "USB selective suspend on AC power",
      `Enabled (0x${(usbAcIndex ?? 1).toString(16).padStart(8, "0")}) — disable on kiosk mini PC so USB NFC reader never sleeps`
    );
  }

  // 12b. Monitor timeout on AC == 0 (warn only)
  const videoRes = runCmdSafe(`powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE`);
  const videoAcMatch = videoRes.output.match(/Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)/i);
  const videoAcSec = videoAcMatch ? Number.parseInt(videoAcMatch[1], 16) : null;
  if (videoAcSec === 0) {
    recordResult("PASS", "Monitor turn-off timeout on AC", "0 seconds (Never)");
  } else {
    recordResult(
      "WARN",
      "Monitor turn-off timeout on AC",
      `${videoAcSec ?? "unknown"} seconds — set to 0 (powercfg /change monitor-timeout-ac 0) on kiosk mini PC`
    );
  }

  // 12c. Standby/sleep timeout on AC == 0 (warn only)
  const sleepRes = runCmdSafe(`powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE`);
  const sleepAcMatch = sleepRes.output.match(/Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)/i);
  const sleepAcSec = sleepAcMatch ? Number.parseInt(sleepAcMatch[1], 16) : null;
  if (sleepAcSec === 0) {
    recordResult("PASS", "System standby/sleep timeout on AC", "0 seconds (Never)");
  } else {
    recordResult(
      "WARN",
      "System standby/sleep timeout on AC",
      `${sleepAcSec ?? "unknown"} seconds — set to 0 (powercfg /change standby-timeout-ac 0) on kiosk mini PC`
    );
  }
}

async function main() {
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER (NEXUS) — RELEASE READINESS CHECK");
  console.log(`  Target URL : ${BASE_URL}`);
  console.log(`  Timestamp  : ${new Date().toISOString()}`);
  console.log("==================================================================");

  checkWindowsServicesAndTasks();
  await checkHealthEndpoint();
  checkNewestBackup();
  checkAgentBinding();
  await checkKioskAuthConfinement();
  checkEnvSecretsAndBuild();
  await checkDatabaseState();
  await checkDemoPasswordsRejected();
  checkWindowsHostConfiguration();

  console.log("\n==================================================================");
  console.log(
    `  SUMMARY: ${passCount} PASS | ${failCount} FAIL | ${warnCount} WARN | ${skipCount} SKIP`
  );
  console.log("==================================================================");

  if (failCount > 0) {
    console.log("\nFailed Checks:");
    for (const item of failedItems) {
      console.log(`  - ${item}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[FATAL] release-check.mjs encountered an unhandled error:", err);
  process.exit(1);
});
