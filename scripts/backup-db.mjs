/**
 * Enterprise Database Backup Utility
 * Generates consistent JSON snapshot with SHA-256 verification hash,
 * change detection on custody transactions, retention pruning (48 frequent + 30 daily),
 * and optional mirroring to BACKUP_MIRROR_DIR.
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

export function resolveEnvFilePath() {
  const candidates = [
    process.env.ENV_FILE_PATH ? path.resolve(process.cwd(), process.env.ENV_FILE_PATH) : null,
    path.join(process.cwd(), ".env"),
    path.join(APP_ROOT, ".env"),
    process.platform === "win32" ? "C:\\ProgramData\\PhoneTracker\\.env" : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "PhoneTracker", ".env")
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.env.ENV_FILE_PATH
    ? path.resolve(process.cwd(), process.env.ENV_FILE_PATH)
    : path.join(process.cwd(), ".env");
}

export function loadEnvIfNeeded() {
  const envPath = resolveEnvFilePath();
  if (!fs.existsSync(envPath)) return;
  if (!process.env.ENV_FILE_PATH) {
    process.env.ENV_FILE_PATH = envPath;
  }
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore read error
  }
}

loadEnvIfNeeded();

export function getBackupDir() {
  loadEnvIfNeeded();
  return path.resolve(APP_ROOT, process.env.BACKUP_DIR || "backups");
}

export function getBackupStatusFile(dirPath = getBackupDir()) {
  return path.join(dirPath, "backup-status.json");
}

export const BACKUP_DIR = getBackupDir();
export const BACKUP_STATUS_FILE = getBackupStatusFile(BACKUP_DIR);
export const FREQUENT_RETENTION_COUNT = 48;
export const DAILY_RETENTION_DAYS = 30;

export function getOrCreateDeploymentId() {
  loadEnvIfNeeded();
  const envFilePath = resolveEnvFilePath();
  const envVal = (process.env.DEPLOYMENT_ID || "").trim();

  if (envVal) {
    try {
      if (fs.existsSync(envFilePath)) {
        const content = fs.readFileSync(envFilePath, "utf8");
        if (!/^DEPLOYMENT_ID=/m.test(content)) {
          const prefix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
          fs.appendFileSync(envFilePath, `${prefix}DEPLOYMENT_ID="${envVal}"\n`, "utf8");
        }
      }
    } catch {
      // Ignore write error when DEPLOYMENT_ID is already in process.env
    }
    return envVal;
  }

  try {
    if (fs.existsSync(envFilePath)) {
      const content = fs.readFileSync(envFilePath, "utf8");
      const match = content.match(/^DEPLOYMENT_ID=(.+)$/m);
      if (match) {
        const parsed = match[1].trim().replace(/^["']|["']$/g, "");
        if (parsed) {
          process.env.DEPLOYMENT_ID = parsed;
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[Backup] Warning reading .env for DEPLOYMENT_ID:", err.message);
  }

  const generatedId = `cpt-deploy-${crypto.randomBytes(16).toString("hex")}`;
  process.env.DEPLOYMENT_ID = generatedId;
  try {
    let existing = "";
    if (fs.existsSync(envFilePath)) {
      existing = fs.readFileSync(envFilePath, "utf8");
    }
    const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
    fs.appendFileSync(envFilePath, `${prefix}DEPLOYMENT_ID="${generatedId}"\n`, "utf8");
    console.log(`[Backup] Generated new DEPLOYMENT_ID="${generatedId}" and saved to ${envFilePath}.`);
  } catch (err) {
    console.warn("[Backup] Could not persist generated DEPLOYMENT_ID to .env:", err.message);
  }
  return generatedId;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export const BACKUP_TABLE_SPECS = [
  { key: "departments", model: "department", tsFields: ["updatedAt", "createdAt"] },
  { key: "roles", model: "role", tsFields: ["updatedAt", "createdAt"] },
  { key: "permissions", model: "permission", tsFields: ["updatedAt", "createdAt"] },
  { key: "rolePermissions", model: "rolePermission", tsFields: [] },
  { key: "users", model: "user", tsFields: ["updatedAt", "createdAt"] },
  { key: "userRoles", model: "userRole", tsFields: ["createdAt"] },
  { key: "employees", model: "employee", tsFields: ["updatedAt", "createdAt"] },
  { key: "employeeShifts", model: "employeeShift", tsFields: ["updatedAt", "createdAt"] },
  { key: "nfcCards", model: "nfcCard", tsFields: ["updatedAt", "createdAt"] },
  { key: "nfcReaders", model: "nfcReader", tsFields: ["updatedAt", "createdAt"] },
  { key: "phoneAssets", model: "phoneAsset", tsFields: ["updatedAt", "createdAt"] },
  { key: "phoneAssignments", model: "phoneAssignment", tsFields: ["updatedAt", "createdAt"] },
  {
    key: "custodyTransactions",
    model: "custodyTransaction",
    tsFields: ["actualReturnAt", "timestamp", "createdAt"],
  },
  { key: "custodyEvents", model: "custodyEvent", tsFields: ["timestamp"] },
  { key: "returnDeadlines", model: "returnDeadline", tsFields: ["updatedAt", "createdAt"] },
  { key: "deadlineExtensions", model: "deadlineExtension", tsFields: ["createdAt"] },
  { key: "overdueCases", model: "overdueCase", tsFields: ["updatedAt", "createdAt"] },
  { key: "overdueEscalations", model: "overdueEscalation", tsFields: ["createdAt"] },
  { key: "escalationPolicies", model: "escalationPolicy", tsFields: ["updatedAt", "createdAt"] },
  {
    key: "notifications",
    model: "notification",
    tsFields: ["readAt", "acknowledgedAt", "emailSentAt", "createdAt"],
  },
  { key: "notificationRules", model: "notificationRule", tsFields: ["updatedAt", "createdAt"] },
  { key: "incidents", model: "incident", tsFields: ["updatedAt", "createdAt"] },
  { key: "incidentActions", model: "incidentAction", tsFields: ["createdAt"] },
  { key: "auditLogs", model: "auditLog", tsFields: ["timestamp"] },
  { key: "reportRuns", model: "reportRun", tsFields: ["createdAt"] },
  { key: "systemSettings", model: "systemSetting", tsFields: ["updatedAt", "createdAt"] },
  { key: "kioskDevices", model: "kioskDevice", tsFields: ["updatedAt", "createdAt"] },
  {
    key: "kioskVerificationRequests",
    model: "kioskVerificationRequest",
    tsFields: ["updatedAt", "createdAt"],
  },
];

function buildWholeDatabaseDigest(tableStats) {
  let totalCount = 0;
  let globalMaxMs = 0;
  const canonicalEntries = [];

  for (const spec of BACKUP_TABLE_SPECS) {
    const stat = tableStats[spec.key] || { count: 0, maxUpdatedAt: null };
    const count = Number(stat.count) || 0;
    const maxIso = stat.maxUpdatedAt || null;
    totalCount += count;
    if (maxIso) {
      const ms = new Date(maxIso).getTime();
      if (!Number.isNaN(ms) && ms > globalMaxMs) {
        globalMaxMs = ms;
      }
    }
    canonicalEntries.push({
      table: spec.key,
      count,
      maxUpdatedAt: maxIso,
    });
  }

  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalEntries))
    .digest("hex");

  return {
    count: totalCount,
    maxUpdatedAt: globalMaxMs > 0 ? new Date(globalMaxMs).toISOString() : null,
    digest,
    tables: Object.fromEntries(canonicalEntries.map((e) => [e.table, { count: e.count, maxUpdatedAt: e.maxUpdatedAt }])),
  };
}

export function computeDatabaseFingerprintFromData(data = {}) {
  const tableStats = {};
  for (const spec of BACKUP_TABLE_SPECS) {
    const rows = Array.isArray(data?.[spec.key]) ? data[spec.key] : [];
    let maxMs = 0;
    if (spec.tsFields.length > 0) {
      for (const row of rows) {
        for (const field of spec.tsFields) {
          const val = row?.[field];
          if (val) {
            const ms = new Date(val).getTime();
            if (!Number.isNaN(ms) && ms > maxMs) {
              maxMs = ms;
            }
          }
        }
      }
    }
    tableStats[spec.key] = {
      count: rows.length,
      maxUpdatedAt: maxMs > 0 ? new Date(maxMs).toISOString() : null,
    };
  }
  return buildWholeDatabaseDigest(tableStats);
}

export async function getDatabaseCustodyFingerprint(dbClient) {
  const results = await Promise.all(
    BACKUP_TABLE_SPECS.map(async (spec) => {
      if (spec.tsFields.length === 0) {
        const count = await dbClient[spec.model].count();
        return [spec.key, { count, maxUpdatedAt: null }];
      }
      const _max = Object.fromEntries(spec.tsFields.map((f) => [f, true]));
      const agg = await dbClient[spec.model].aggregate({
        _count: { _all: true },
        _max,
      });
      const count = agg?._count?._all ?? 0;
      let maxMs = 0;
      for (const field of spec.tsFields) {
        const val = agg?._max?.[field];
        if (val) {
          const ms = new Date(val).getTime();
          if (!Number.isNaN(ms) && ms > maxMs) {
            maxMs = ms;
          }
        }
      }
      return [
        spec.key,
        {
          count,
          maxUpdatedAt: maxMs > 0 ? new Date(maxMs).toISOString() : null,
        },
      ];
    })
  );

  return buildWholeDatabaseDigest(Object.fromEntries(results));
}

export const getDatabaseFingerprint = getDatabaseCustodyFingerprint;

export function verifyBackupFile(backupFilePath) {
  try {
    if (!fs.existsSync(backupFilePath)) {
      return { valid: false, reason: "Backup file does not exist" };
    }
    const checksumFilePath = `${backupFilePath}.sha256`;
    if (!fs.existsSync(checksumFilePath)) {
      return { valid: false, reason: "Companion .sha256 file does not exist" };
    }
    const rawJson = fs.readFileSync(backupFilePath, "utf8");
    const computedHash = crypto.createHash("sha256").update(rawJson).digest("hex");
    const checksumContent = fs.readFileSync(checksumFilePath, "utf8").trim();
    const expectedHash = checksumContent.split(/\s+/)[0];

    if (!expectedHash || computedHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return {
        valid: false,
        reason: `SHA-256 mismatch (expected ${expectedHash}, computed ${computedHash})`,
        expectedHash,
        computedHash,
      };
    }

    const payload = JSON.parse(rawJson);
    if (!payload || !payload.data || !payload.tableCounts) {
      return { valid: false, reason: "Invalid backup JSON structure" };
    }

    return {
      valid: true,
      hash: computedHash,
      payload,
    };
  } catch (err) {
    return {
      valid: false,
      reason: err?.message || String(err),
    };
  }
}

export function listBackupFilesNewestFirst(dirPath = getBackupDir()) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.startsWith("cpt_backup_") && f.endsWith(".json"))
    .sort()
    .reverse();
}

export function extractBackupDateKey(fileName, dirPath = getBackupDir()) {
  const match = fileName.match(/^cpt_backup_(\d{4}-\d{2}-\d{2})T/);
  if (match) return match[1];
  try {
    const stat = fs.statSync(path.join(dirPath, fileName));
    return stat.mtime.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export function pruneBackups(
  dirPath = getBackupDir(),
  frequentLimit = FREQUENT_RETENTION_COUNT,
  dailyDays = DAILY_RETENTION_DAYS
) {
  if (!fs.existsSync(dirPath)) return { kept: [], pruned: [] };

  const files = listBackupFilesNewestFirst(dirPath);
  const keepSet = new Set();

  // 1. Keep the newest `frequentLimit` (48) frequent backups
  for (let i = 0; i < Math.min(files.length, frequentLimit); i++) {
    keepSet.add(files[i]);
  }

  // 2. Keep 1 backup per calendar day for the last `dailyDays` (30) days
  const cutoffMs = Date.now() - dailyDays * 24 * 60 * 60 * 1000;
  const seenDays = new Set();

  for (const file of files) {
    const dateKey = extractBackupDateKey(file, dirPath);
    if (!dateKey) continue;
    const dayMs = new Date(`${dateKey}T23:59:59.999Z`).getTime();
    if (!Number.isNaN(dayMs) && dayMs >= cutoffMs) {
      if (!seenDays.has(dateKey)) {
        seenDays.add(dateKey);
        keepSet.add(file);
      }
    }
  }

  const kept = [];
  const pruned = [];

  for (const file of files) {
    if (keepSet.has(file)) {
      kept.push(file);
    } else {
      const fullJsonPath = path.join(dirPath, file);
      const fullShaPath = `${fullJsonPath}.sha256`;
      try {
        if (fs.existsSync(fullJsonPath)) fs.unlinkSync(fullJsonPath);
        if (fs.existsSync(fullShaPath)) fs.unlinkSync(fullShaPath);
        pruned.push(file);
      } catch (err) {
        console.warn(`[Backup Retention] Failed to delete old backup ${file}:`, err.message);
      }
    }
  }

  if (pruned.length > 0) {
    console.log(
      `[Backup Retention] Pruned ${pruned.length} old backup(s) in ${dirPath}; kept ${kept.length} backup(s).`
    );
  }

  return { kept, pruned };
}

export function readBackupStatus(dirPath = getBackupDir()) {
  try {
    const statusFile = getBackupStatusFile(dirPath);
    if (fs.existsSync(statusFile)) {
      return JSON.parse(fs.readFileSync(statusFile, "utf8"));
    }
  } catch {}
  return null;
}

export function writeBackupStatus(statusUpdate, dirPath = getBackupDir()) {
  try {
    ensureDir(dirPath);
    const statusFile = getBackupStatusFile(dirPath);
    const existing = readBackupStatus(dirPath) || {};
    const currentMirrorDir = (process.env.BACKUP_MIRROR_DIR || "").trim() || null;
    const merged = {
      ...existing,
      mirrorConfigured: Boolean(currentMirrorDir),
      mirrorDir: currentMirrorDir,
      ...(currentMirrorDir
        ? {}
        : {
            lastMirrorOk: null,
            lastMirrorAt: null,
            lastMirrorError: null,
          }),
      ...statusUpdate,
    };
    fs.writeFileSync(statusFile, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  } catch (err) {
    console.error("[Backup] Failed to write backup-status.json:", err.message);
    return null;
  }
}

function mirrorBackupFiles(backupFilePath, checksumFilePath, expectedHash) {
  const mirrorDir = (process.env.BACKUP_MIRROR_DIR || "").trim();
  if (!mirrorDir) {
    return {
      mirrorConfigured: false,
      mirrorDir: null,
      lastMirrorOk: null,
      lastMirrorAt: null,
      lastMirrorError: null,
    };
  }

  const nowIso = new Date().toISOString();
  const fileName = path.basename(backupFilePath);
  try {
    ensureDir(mirrorDir);
    const mirrorJsonPath = path.join(mirrorDir, fileName);
    const mirrorShaPath = path.join(mirrorDir, `${fileName}.sha256`);

    fs.copyFileSync(backupFilePath, mirrorJsonPath);
    fs.copyFileSync(checksumFilePath, mirrorShaPath);

    const mirrorCheck = verifyBackupFile(mirrorJsonPath);
    if (!mirrorCheck.valid || mirrorCheck.hash !== expectedHash) {
      throw new Error(mirrorCheck.reason || "Mirror SHA-256 verification failed");
    }

    pruneBackups(mirrorDir);
    console.log(`[Backup] ✓ Mirrored ${fileName} (+ .sha256) to BACKUP_MIRROR_DIR: ${mirrorDir}`);

    return {
      mirrorConfigured: true,
      mirrorDir,
      lastMirrorOk: true,
      lastMirrorAt: nowIso,
      lastMirrorError: null,
    };
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error(
      `[Backup] ⚠ Failed to mirror backup to BACKUP_MIRROR_DIR (${mirrorDir}): ${errMsg}`
    );
    return {
      mirrorConfigured: true,
      mirrorDir,
      lastMirrorOk: false,
      lastMirrorAt: nowIso,
      lastMirrorError: errMsg,
    };
  }
}

export async function createBackup(options = {}) {
  const {
    skipIfUnchanged = false,
    reason = "manual",
    dbClient = null,
    frequentLimit = FREQUENT_RETENTION_COUNT,
    dailyDays = DAILY_RETENTION_DAYS,
  } = options;

  const activeBackupDir = getBackupDir();
  ensureDir(activeBackupDir);
  const deploymentId = getOrCreateDeploymentId();
  const ownClient = !dbClient;
  const db = dbClient || new PrismaClient();

  try {
    const currentFingerprint = await getDatabaseCustodyFingerprint(db);

    if (skipIfUnchanged) {
      const files = listBackupFilesNewestFirst(activeBackupDir);
      for (const candidate of files) {
        const candidatePath = path.join(activeBackupDir, candidate);
        const check = verifyBackupFile(candidatePath);
        if (!check.valid) continue;

        const payload = check.payload;
        if (payload?.deploymentId !== deploymentId) {
          continue;
        }
        const hasAllTables = BACKUP_TABLE_SPECS.every((spec) =>
          Array.isArray(payload?.data?.[spec.key])
        );
        const prevFp = payload.custodyFingerprint?.tables
          ? payload.custodyFingerprint
          : computeDatabaseFingerprintFromData(payload?.data || {});

        if (
          hasAllTables &&
          prevFp &&
          prevFp.count === currentFingerprint.count &&
          prevFp.maxUpdatedAt === currentFingerprint.maxUpdatedAt &&
          prevFp.digest === currentFingerprint.digest
        ) {
          console.log(
            `[Backup (${reason})] Skipping backup: no database changes since ${candidate} (count=${currentFingerprint.count}, maxUpdatedAt=${currentFingerprint.maxUpdatedAt || "none"}, digest=${currentFingerprint.digest.slice(0, 12)}...).`
          );

          // If BACKUP_MIRROR_DIR is configured and the latest backup is missing in mirrorDir or lastMirrorOk was false, attempt mirror sync
          const mirrorDir = (process.env.BACKUP_MIRROR_DIR || "").trim();
          let mirrorState = {
            mirrorConfigured: Boolean(mirrorDir),
            mirrorDir: mirrorDir || null,
          };
          if (mirrorDir) {
            const mirrorCandidate = path.join(mirrorDir, candidate);
            const prevStatus = readBackupStatus(activeBackupDir);
            if (!fs.existsSync(mirrorCandidate) || prevStatus?.lastMirrorOk === false) {
              mirrorState = mirrorBackupFiles(candidatePath, `${candidatePath}.sha256`, check.hash);
            }
          } else {
            mirrorState = {
              mirrorConfigured: false,
              mirrorDir: null,
              lastMirrorOk: null,
              lastMirrorAt: null,
              lastMirrorError: null,
            };
          }

          writeBackupStatus(
            {
              deploymentId,
              lastCheckedAt: new Date().toISOString(),
              lastSkippedReason: "NO_DATABASE_CHANGES",
              custodyFingerprint: currentFingerprint,
              ...mirrorState,
            },
            activeBackupDir
          );

          return {
            success: true,
            skipped: true,
            deploymentId,
            latestBackupFile: candidate,
            custodyFingerprint: currentFingerprint,
          };
        }
        break;
      }
    }

    console.log("==================================================================");
    console.log(`  COMPANY PHONE TRACKER — DATABASE BACKUP UTILITY (${reason})`);
    console.log("==================================================================\n");

    const startTime = Date.now();
    const createdAtIso = new Date().toISOString();
    const timestamp = createdAtIso.replace(/[:.]/g, "-");
    const backupFileName = `cpt_backup_${timestamp}.json`;
    const backupFilePath = path.join(activeBackupDir, backupFileName);
    const checksumFilePath = `${backupFilePath}.sha256`;

    console.log(`[Backup] Initiating data snapshot at ${createdAtIso} (deploymentId=${deploymentId})...`);

    const [
      departments,
      roles,
      permissions,
      rolePermissions,
      users,
      userRoles,
      employees,
      employeeShifts,
      nfcCards,
      nfcReaders,
      phoneAssets,
      phoneAssignments,
      custodyTransactions,
      custodyEvents,
      returnDeadlines,
      deadlineExtensions,
      overdueCases,
      overdueEscalations,
      escalationPolicies,
      notifications,
      notificationRules,
      incidents,
      incidentActions,
      auditLogs,
      reportRuns,
      systemSettings,
      kioskDevices,
      kioskVerificationRequests,
    ] = await Promise.all([
      db.department.findMany(),
      db.role.findMany(),
      db.permission.findMany(),
      db.rolePermission.findMany(),
      db.user.findMany(),
      db.userRole.findMany(),
      db.employee.findMany(),
      db.employeeShift.findMany(),
      db.nfcCard.findMany(),
      db.nfcReader.findMany(),
      db.phoneAsset.findMany(),
      db.phoneAssignment.findMany(),
      db.custodyTransaction.findMany(),
      db.custodyEvent.findMany(),
      db.returnDeadline.findMany(),
      db.deadlineExtension.findMany(),
      db.overdueCase.findMany(),
      db.overdueEscalation.findMany(),
      db.escalationPolicy.findMany(),
      db.notification.findMany(),
      db.notificationRule.findMany(),
      db.incident.findMany(),
      db.incidentAction.findMany(),
      db.auditLog.findMany(),
      db.reportRun.findMany(),
      db.systemSetting.findMany(),
      db.kioskDevice.findMany(),
      db.kioskVerificationRequest.findMany(),
    ]);

    const backupPayload = {
      version: "1.1.0",
      deploymentId,
      createdAt: createdAtIso,
      timezone: "Asia/Manila (UTC+8)",
      custodyFingerprint: currentFingerprint,
      tableCounts: {
        departments: departments.length,
        roles: roles.length,
        permissions: permissions.length,
        rolePermissions: rolePermissions.length,
        users: users.length,
        userRoles: userRoles.length,
        employees: employees.length,
        employeeShifts: employeeShifts.length,
        nfcCards: nfcCards.length,
        nfcReaders: nfcReaders.length,
        phoneAssets: phoneAssets.length,
        phoneAssignments: phoneAssignments.length,
        custodyTransactions: custodyTransactions.length,
        custodyEvents: custodyEvents.length,
        returnDeadlines: returnDeadlines.length,
        deadlineExtensions: deadlineExtensions.length,
        overdueCases: overdueCases.length,
        overdueEscalations: overdueEscalations.length,
        escalationPolicies: escalationPolicies.length,
        notifications: notifications.length,
        notificationRules: notificationRules.length,
        incidents: incidents.length,
        incidentActions: incidentActions.length,
        auditLogs: auditLogs.length,
        reportRuns: reportRuns.length,
        systemSettings: systemSettings.length,
        kioskDevices: kioskDevices.length,
        kioskVerificationRequests: kioskVerificationRequests.length,
      },
      data: {
        departments,
        roles,
        permissions,
        rolePermissions,
        users,
        userRoles,
        employees,
        employeeShifts,
        nfcCards,
        nfcReaders,
        phoneAssets,
        phoneAssignments,
        custodyTransactions,
        custodyEvents,
        returnDeadlines,
        deadlineExtensions,
        overdueCases,
        overdueEscalations,
        escalationPolicies,
        notifications,
        notificationRules,
        incidents,
        incidentActions,
        auditLogs,
        reportRuns,
        systemSettings,
        kioskDevices,
        kioskVerificationRequests,
      },
    };

    const jsonString = JSON.stringify(backupPayload, null, 2);
    const hash = crypto.createHash("sha256").update(jsonString).digest("hex");

    fs.writeFileSync(backupFilePath, jsonString, "utf8");
    fs.writeFileSync(checksumFilePath, `${hash}  ${backupFileName}\n`, "utf8");

    // Verify SHA-256 on disk immediately after writing
    const postWriteCheck = verifyBackupFile(backupFilePath);
    if (!postWriteCheck.valid || postWriteCheck.hash !== hash) {
      throw new Error(
        `Post-write SHA-256 verification failed for ${backupFilePath}: ${postWriteCheck.reason || "hash mismatch"}`
      );
    }
    console.log(`[Backup] ✓ Post-write SHA-256 verified (${hash}).`);

    // Copy to BACKUP_MIRROR_DIR if configured (log and record failure without crashing)
    const mirrorResult = mirrorBackupFiles(backupFilePath, checksumFilePath, hash);

    // Prune old backups according to retention policy (last 48 frequent + 1 per day for 30 days)
    const pruneResult = pruneBackups(activeBackupDir, frequentLimit, dailyDays);

    writeBackupStatus(
      {
        deploymentId,
        lastBackupAt: createdAtIso,
        lastBackupFile: backupFileName,
        lastBackupSha256: hash,
        lastCheckedAt: createdAtIso,
        lastSkippedReason: null,
        custodyFingerprint: currentFingerprint,
        ...mirrorResult,
      },
      activeBackupDir
    );

    const totalRecords = Object.values(backupPayload.tableCounts).reduce((a, b) => a + b, 0);
    const fileSizeKb = (Buffer.byteLength(jsonString) / 1024).toFixed(2);
    const durationMs = Date.now() - startTime;

    console.log(`[Backup] SUCCESS!`);
    console.log(`  File:         ${backupFilePath}`);
    console.log(`  DeploymentId: ${deploymentId}`);
    console.log(`  Size:         ${fileSizeKb} KB`);
    console.log(`  Records:      ${totalRecords} rows across ${Object.keys(backupPayload.tableCounts).length} tables`);
    console.log(`  SHA256:       ${hash}`);
    console.log(`  Duration:     ${durationMs}ms\n`);

    return {
      success: true,
      skipped: false,
      deploymentId,
      backupFileName,
      backupFilePath,
      hash,
      totalRecords,
      custodyFingerprint: currentFingerprint,
      mirrorResult,
      pruneResult,
    };
  } catch (error) {
    console.error(`[Backup] FAILED:`, error);
    if (ownClient) {
      process.exitCode = 1;
    }
    throw error;
  } finally {
    if (ownClient) {
      await db.$disconnect();
    }
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const skipIfUnchanged = process.argv.includes("--if-changed");
  createBackup({ skipIfUnchanged, reason: skipIfUnchanged ? "cli-if-changed" : "cli-manual" }).catch(
    () => process.exit(1)
  );
}
