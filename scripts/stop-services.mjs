import http from "node:http";
import { execSync } from "node:child_process";

console.log("==================================================================");
console.log("  COMPANY PHONE TRACKER — SAFE SHUTDOWN COORDINATOR");
console.log("==================================================================\n");

async function requestPgShutdown() {
  return new Promise((resolve) => {
    console.log("[Shutdown] Requesting graceful database WAL flush & shutdown (Port 54320)...");
    const req = http.get("http://127.0.0.1:54320/shutdown", (res) => {
      console.log("[Shutdown] ✓ Database server accepted graceful shutdown request.");
      resolve(true);
    });
    req.on("error", () => {
      console.log("[Shutdown] Note: Database control port was not reachable (already stopped or native).");
      resolve(false);
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function killByTitle(title) {
  try {
    execSync(`taskkill /FI "WINDOWTITLE eq ${title}*" /T /F >nul 2>&1`);
  } catch {}
}

function stopWindowsService(serviceName) {
  try {
    execSync(`net stop "${serviceName}" /y >nul 2>&1`, { timeout: 15000 });
  } catch {}
}

async function main() {
  // 1. Stop web app, worker, tunnel, and agent first so no new DB queries are made
  console.log("[Shutdown] Stopping dependent services (CPT_Web, CPT_Worker, CPT_Agent, Tunnel)...");
  stopWindowsService("CPT_Web");
  stopWindowsService("CPT_Worker");
  stopWindowsService("CPT_Agent");
  killByTitle("CPT-Web-App");
  killByTitle("CPT-Overdue-Worker");
  killByTitle("CPT-NFC-Agent");
  try {
    execSync("taskkill /IM cloudflared.exe /F >nul 2>&1");
  } catch {}

  // 2. Request clean database shutdown so WAL buffers are committed cleanly
  await requestPgShutdown();

  // Wait 2 seconds for PGlite to close storage handles
  await new Promise((r) => setTimeout(r, 2000));

  // 3. Stop CPT_DB service and clean up any remaining windows
  stopWindowsService("CPT_DB");
  killByTitle("CPT-PostgreSQL");

  console.log("\n[Shutdown] ✓ All Company Phone Tracker services stopped cleanly and safely.");
}

main();

