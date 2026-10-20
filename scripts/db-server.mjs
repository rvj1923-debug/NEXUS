import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

function loadEnvIfNeeded() {
  const candidates = [
    process.env.ENV_FILE_PATH ? path.resolve(process.cwd(), process.env.ENV_FILE_PATH) : null,
    path.join(process.cwd(), ".env"),
    path.join(APP_ROOT, ".env"),
    process.platform === "win32" ? "C:\\ProgramData\\PhoneTracker\\.env" : null,
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (envPath && fs.existsSync(envPath)) {
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
        // ignore .env read errors
      }
      break;
    }
  }
}

loadEnvIfNeeded();

const dataDir = path.resolve(APP_ROOT, process.env.PG_DATA_DIR || "postgres_data");
const port = parseInt(process.env.PGPORT || "5432", 10);
const host = process.env.PGHOST || "127.0.0.1";
const controlPort = parseInt(process.env.PG_CONTROL_PORT || "54320", 10);

let autoHealInProgress = false;

// Helper to check if a port is in use
function checkPortInUse(p, h) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(p, h);
  });
}

// Clean up stale postmaster.pid if port 5432 is free
async function cleanStalePid() {
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    const inUse = await checkPortInUse(port, host);
    if (!inUse) {
      console.log(`[PG-Server] Cleaning stale postmaster.pid (database was not shut down cleanly)...`);
      try {
        fs.unlinkSync(pidFile);
      } catch (err) {
        console.warn(`[PG-Server] Could not unlink postmaster.pid:`, err.message);
      }
    }
  }
}

// Self-heal database by pushing schema and restoring latest backup asynchronously
function selfHealRestore(reason) {
  autoHealInProgress = true;
  console.log(`[PG-Server] Database requires auto-heal (reason=${reason}). Scheduling asynchronous auto-heal in 1000ms...`);
  setTimeout(() => {
    const autoHealScript = path.join(__dirname, "auto-heal-db.mjs");
    const child = spawn(process.execPath, [autoHealScript, `--reason=${reason}`], {
      stdio: "inherit",
      cwd: APP_ROOT,
      env: process.env,
    });
    child.on("close", (code) => {
      autoHealInProgress = false;
      if (code === 0) {
        console.log(`[PG-Server] Auto-heal and restoration completed successfully (reason=${reason}).`);
      } else {
        console.error(`[PG-Server] Auto-heal exited with status ${code} (reason=${reason}).`);
      }
    });
    child.on("error", (err) => {
      autoHealInProgress = false;
      console.error(`[PG-Server] Failed to spawn auto-heal process:`, err.message);
    });
  }, 1000);
}

async function startServer() {
  const isPortBusy = await checkPortInUse(port, host);
  if (isPortBusy) {
    console.warn(`[PG-Server] Port ${port} is already in use. Another PostgreSQL instance is already active.`);
    process.exit(0);
  }

  let db = null;
  let server = null;
  let healReason = null;

  const pgVersionFile = path.join(dataDir, "PG_VERSION");
  if (!fs.existsSync(dataDir) || !fs.existsSync(pgVersionFile)) {
    console.log(`[PG-Server] Data directory ${dataDir} is missing or has no PG_VERSION. Will run auto-heal after startup (reason=missing)...`);
    healReason = "missing";
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  await cleanStalePid();

  console.log(`[PG-Server] Initializing PostgreSQL engine at ${dataDir}...`);
  try {
    db = new PGlite(dataDir);
    await Promise.race([
      db.waitReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PGlite waitReady timed out after 15000ms")), 15000)
      ),
    ]);
    console.log(`[PG-Server] PostgreSQL engine initialized successfully.`);

    if (!healReason) {
      try {
        const regRes = await db.query(
          `SELECT to_regclass('public.users') AS users_tbl, to_regclass('public.phone_assets') AS phones_tbl, to_regclass('public.custody_transactions') AS tx_tbl`
        );
        const row = regRes?.rows?.[0] || {};
        if (!row.users_tbl || !row.phones_tbl || !row.tx_tbl) {
          console.log(`[PG-Server] Core schema tables missing. Scheduling auto-heal (reason=schema)...`);
          healReason = "schema";
        }
      } catch (queryErr) {
        console.warn(
          `[PG-Server] Schema check query failed (continuing without triggering restore):`,
          queryErr.message
        );
      }
    }
  } catch (initErr) {
    console.error(`[PG-Server] ⚠ Database initialization failed with corrupted storage:`, initErr.message);
    const baseDirName = path.basename(dataDir);
    const corruptedDirName = `${baseDirName}_corrupted_${Date.now()}`;
    const backupDirPath = path.resolve(path.dirname(dataDir), corruptedDirName);
    console.log(`[PG-Server] Archiving corrupted data directory to ${backupDirPath}...`);

    try {
      if (fs.existsSync(dataDir)) {
        fs.renameSync(dataDir, backupDirPath);
      }
    } catch (renameErr) {
      console.error(`[PG-Server] Rename failed, removing corrupt files:`, renameErr.message);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }

    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[PG-Server] Initializing clean PostgreSQL instance...`);
    db = new PGlite(dataDir);
    await db.waitReady;
    console.log(`[PG-Server] Clean PostgreSQL engine initialized.`);
    healReason = "corrupt";
  }

  server = new PGLiteSocketServer({
    db,
    host,
    port,
    maxConnections: 500,
    idleTimeout: 0,
  });

  await server.start();
  console.log(`[PG-Server] PostgreSQL server listening on ${host}:${port}`);

  if (healReason) {
    selfHealRestore(healReason);
  } else {
    const markerFile = path.join(dataDir, ".cpt_initialized");
    if (!fs.existsSync(markerFile)) {
      try {
        const nowIso = new Date().toISOString();
        fs.writeFileSync(markerFile, `${nowIso}\n`, "utf8");
        console.log(`[PG-Server] Wrote install marker ${markerFile} (${nowIso}).`);
      } catch (err) {
        console.warn(`[PG-Server] Could not write install marker:`, err.message);
      }
    }
  }

  // Graceful shutdown logic (handles NSSM AppStopMethodConsole Ctrl+C / SIGINT / SIGBREAK / SIGTERM)
  let isShuttingDown = false;
  const shutdown = async (source = "SIGNAL") => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[PG-Server] Received shutdown trigger (${source}). Flushing WAL and closing cleanly...`);
    const forceExitTimer = setTimeout(() => {
      console.warn("[PG-Server] Shutdown timeout reached; forcing exit.");
      process.exit(0);
    }, 12000);
    forceExitTimer.unref();

    try {
      if (controlServer) {
        try {
          controlServer.close();
        } catch {}
      }
      if (server) {
        await Promise.race([
          server.stop(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      if (db) {
        await db.close();
      }
      const pidFile = path.join(dataDir, "postmaster.pid");
      if (fs.existsSync(pidFile)) {
        try { fs.unlinkSync(pidFile); } catch {}
      }
      console.log("[PG-Server] Database shutdown completed cleanly. Zero corruption risk.");
    } catch (err) {
      console.error("[PG-Server] Error during shutdown:", err.message);
    }
    await new Promise((resolve) => {
      process.stdout.write("", () => setTimeout(resolve, 150));
    });
    process.exit(0);
  };

  // HTTP Control Server for Graceful Remote/Script Shutdown
  const controlServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/shutdown" || url.pathname === "/api/shutdown") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "SHUTTING_DOWN", message: "Clean database shutdown initiated." }));
      setTimeout(() => shutdown("HTTP_CONTROL"), 100);
      return;
    }
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ONLINE", port, host, autoHealInProgress }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  controlServer.listen(controlPort, host, () => {
    console.log(`[PG-Server] Graceful control listener active on http://${host}:${controlPort}`);
  });

  process.on("uncaughtException", (err) => {
    if (err?.code === "ECONNRESET" || err?.message?.includes("ECONNRESET") || err?.code === "EPIPE") {
      return;
    }
    console.error("[PG-Server] Uncaught exception:", err);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGBREAK", () => shutdown("SIGBREAK"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

startServer().catch((err) => {
  console.error("[PG-Server] Fatal error on startup:", err);
  process.exit(1);
});
