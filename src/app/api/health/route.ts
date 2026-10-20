import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";
import { isRemoteAgentDeployment } from "@/lib/deployment";

const ALLOWED_HEALTH_ORIGINS = new Set([
  "null",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

const BACKUP_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function buildHealthHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Vary: "Origin",
  };
  const origin = req.headers.get("origin");
  if (origin && ALLOWED_HEALTH_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function parseTimestampFromBackupFilename(fileName: string, fullPath: string): string | null {
  const match = fileName.match(
    /^cpt_backup_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/
  );
  if (match) {
    const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
    const ms = new Date(iso).getTime();
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  try {
    return fs.statSync(fullPath).mtime.toISOString();
  } catch {
    return null;
  }
}

function getBackupTelemetry() {
  const backupDir = path.resolve(process.cwd(), process.env.BACKUP_DIR || "backups");
  const statusFilePath = path.join(backupDir, "backup-status.json");
  const configuredMirrorDir = (process.env.BACKUP_MIRROR_DIR || "").trim();

  let statusJson: Record<string, any> | null = null;
  try {
    if (fs.existsSync(statusFilePath)) {
      statusJson = JSON.parse(fs.readFileSync(statusFilePath, "utf8"));
    }
  } catch {
    statusJson = null;
  }

  let newestFile: string | null = null;
  let lastBackupAt: string | null = null;

  try {
    if (fs.existsSync(backupDir)) {
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("cpt_backup_") && f.endsWith(".json"))
        .sort()
        .reverse();

      for (const candidate of files) {
        const candidatePath = path.join(backupDir, candidate);
        const shaPath = `${candidatePath}.sha256`;
        if (fs.existsSync(shaPath)) {
          newestFile = candidate;
          lastBackupAt = parseTimestampFromBackupFilename(candidate, candidatePath);
          break;
        }
      }

      if (!newestFile && files.length > 0) {
        newestFile = files[0];
        lastBackupAt = parseTimestampFromBackupFilename(files[0], path.join(backupDir, files[0]));
      }
    }
  } catch {
    // ignore fs read errors
  }

  if (!lastBackupAt && typeof statusJson?.lastBackupAt === "string") {
    lastBackupAt = statusJson.lastBackupAt;
  }

  const mirrorConfigured = Boolean(configuredMirrorDir || statusJson?.mirrorConfigured);
  let lastMirrorOk: boolean | null = null;
  let lastMirrorError: string | null = null;

  if (typeof statusJson?.lastMirrorOk === "boolean") {
    lastMirrorOk = statusJson.lastMirrorOk;
    lastMirrorError = statusJson.lastMirrorError || null;
  } else if (configuredMirrorDir) {
    try {
      if (newestFile && fs.existsSync(path.join(configuredMirrorDir, newestFile))) {
        lastMirrorOk = true;
      } else {
        lastMirrorOk = false;
        lastMirrorError = "Mirror directory is missing latest backup snapshot";
      }
    } catch {
      lastMirrorOk = false;
      lastMirrorError = "Mirror directory is unreachable";
    }
  }

  const ageMs = lastBackupAt ? Date.now() - new Date(lastBackupAt).getTime() : null;
  const ageMinutes = ageMs !== null && !Number.isNaN(ageMs) ? Math.max(0, Math.floor(ageMs / 60000)) : null;
  const isStale = ageMs === null || Number.isNaN(ageMs) || ageMs > BACKUP_STALE_THRESHOLD_MS;

  return {
    lastBackupAt,
    lastBackupFile: newestFile,
    ageMinutes,
    isStale,
    mirrorConfigured,
    lastMirrorOk,
    lastMirrorError,
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildHealthHeaders(req),
  });
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const checks: Record<string, { status: "UP" | "DOWN" | "DEGRADED" | "REMOTE"; latencyMs?: number; details?: any }> = {};

  // 1. Database Health Check
  try {
    const dbStart = Date.now();
    await db.$queryRaw`SELECT 1`;
    checks.database = {
      status: "UP",
      latencyMs: Date.now() - dbStart,
    };
  } catch (error: unknown) {
    console.error("[HealthCheck] Database health check failed:", error);
    checks.database = {
      status: "DOWN",
      details: "Database unreachable",
    };
  }

  // 2. Local NFC Reader Agent Health Check (Port 8002)
  if (isRemoteAgentDeployment()) {
    checks.nfcAgent = {
      status: "REMOTE",
      details: "Central server deployment: NFC reader agents run on each kiosk PC and are not checked from the server.",
    };
  } else try {
    const agentStart = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const agentRes = await fetch("http://127.0.0.1:8002/api/agent/health", {
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (agentRes && agentRes.ok) {
      const agentData = await agentRes.json();
      checks.nfcAgent = {
        status: "UP",
        latencyMs: Date.now() - agentStart,
        details: agentData,
      };
    } else {
      checks.nfcAgent = {
        status: "DEGRADED",
        details: "Local agent offline or not responding. Keyboard wedge mode active as fallback.",
      };
    }
  } catch {
    checks.nfcAgent = {
      status: "DEGRADED",
      details: "Agent check skipped or timed out.",
    };
  }

  // 3. System Counters (only query when database is UP)
  if (checks.database.status === "UP") {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [accountsWithNfc, openTransactions, activeOverdue] = await Promise.all([
        db.employee.count({
          where: {
            isActive: true,
            nfcCards: { some: { status: "ACTIVE" } },
          },
        }),
        db.custodyTransaction.count({
          where: {
            transactionType: { in: ["TIME_IN", "ISSUANCE"] },
            actualReturnAt: null,
            status: { in: ["ISSUED", "OVERDUE"] },
          },
        }),
        db.custodyTransaction.count({
          where: {
            transactionType: { in: ["TIME_IN", "ISSUANCE"] },
            actualReturnAt: null,
            status: { in: ["ISSUED", "OVERDUE"] },
            timestamp: { lt: twentyFourHoursAgo },
          },
        }),
      ]);

      checks.metrics = {
        status: "UP",
        details: {
          totalPhones: accountsWithNfc,
          openTransactions,
          activeOverdue,
        },
      };
    } catch (err: unknown) {
      console.error("[HealthCheck] Metrics query failed:", err);
      checks.metrics = {
        status: "DOWN",
        details: "Metrics query failed",
      };
      checks.database = {
        status: "DOWN",
        details: "Database query failed",
      };
    }
  } else {
    checks.metrics = {
      status: "DOWN",
      details: "Skipped because database is DOWN",
    };
  }

  // 4. Database Backup & Mirror Telemetry
  const backupTelemetry = getBackupTelemetry();
  checks.backup = {
    status: backupTelemetry.isStale || backupTelemetry.lastMirrorOk === false ? "DEGRADED" : "UP",
    details: backupTelemetry,
  };

  const isHealthy = checks.database.status === "UP";
  const overallStatus = isHealthy
    ? checks.nfcAgent.status === "DEGRADED" || checks.backup.status === "DEGRADED"
      ? "DEGRADED"
      : "HEALTHY"
    : "UNHEALTHY";

  return NextResponse.json(
    {
      status: overallStatus,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      timezone: `${COMPANY_TIMEZONE} (UTC+8)`,
      totalLatencyMs: Date.now() - startTime,
      lastBackupAt: backupTelemetry.lastBackupAt,
      lastBackupFile: backupTelemetry.lastBackupFile,
      lastMirrorOk: backupTelemetry.lastMirrorOk,
      lastMirrorError: backupTelemetry.lastMirrorError,
      checks,
    },
    {
      status: isHealthy ? 200 : 503,
      headers: buildHealthHeaders(req),
    }
  );
}
