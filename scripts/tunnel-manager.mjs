/**
 * Automated Public HTTPS Tunnel Manager (Cloudflare Quick Tunnel / Custom Token)
 * Ensures Department Supervisors and HR can access /supervisor-form and /overdue/print-report
 * from outside the local network (e.g., mobile data or home Wi-Fi) without manual router setup.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const CLOUDFLARED_DOWNLOAD_URL =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

let activeChild = null;
let currentPublicUrl = null;
let shuttingDown = false;

export function getTunnelStatusFilePath() {
  const baseDataDir = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || "data");
  return path.join(baseDataDir, "tunnel-status.json");
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readActiveTunnelUrl() {
  try {
    const statusPath = getTunnelStatusFilePath();
    if (!fs.existsSync(statusPath)) return null;
    const raw = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    if (raw?.publicUrl && typeof raw.publicUrl === "string") {
      if (raw.pid && isProcessAlive(raw.pid)) {
        return raw.publicUrl.replace(/\/$/, "");
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function writeTunnelStatus(data) {
  try {
    const statusPath = getTunnelStatusFilePath();
    const dir = path.dirname(statusPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statusPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Tunnel] Could not write tunnel-status.json:", err.message);
  }
}

function resolveCloudflaredPath() {
  const candidates = [
    path.join(PROJECT_ROOT, "tools", "cloudflared.exe"),
    path.resolve(PROJECT_ROOT, process.env.DATA_DIR || "data", "tools", "cloudflared.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function downloadFileWithRedirects(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${destPath}.download`;

    const request = (currentUrl, redirectsLeft = 5) => {
      if (redirectsLeft <= 0) {
        reject(new Error("Too many redirects downloading cloudflared.exe"));
        return;
      }
      https
        .get(currentUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            request(res.headers.location, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} downloading cloudflared.exe`));
            return;
          }
          const file = fs.createWriteStream(tempPath);
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              try {
                fs.renameSync(tempPath, destPath);
                resolve(destPath);
              } catch (err) {
                reject(err);
              }
            });
          });
          file.on("error", (err) => {
            try {
              fs.unlinkSync(tempPath);
            } catch {}
            reject(err);
          });
        })
        .on("error", (err) => {
          try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          } catch {}
          reject(err);
        });
    };

    request(url);
  });
}

async function ensureCloudflaredBinary() {
  let binPath = resolveCloudflaredPath();
  if (fs.existsSync(binPath)) {
    return binPath;
  }

  console.log("[Tunnel] Downloading cloudflared.exe for external HTTPS tunnel access...");
  try {
    await downloadFileWithRedirects(CLOUDFLARED_DOWNLOAD_URL, binPath);
    console.log(`[Tunnel] ✓ Downloaded cloudflared.exe to ${binPath}`);
    return binPath;
  } catch {
    // Fallback to writable data directory if tools/ is read-only (e.g. Program Files)
    const fallbackPath = path.resolve(
      PROJECT_ROOT,
      process.env.DATA_DIR || "data",
      "tools",
      "cloudflared.exe"
    );
    await downloadFileWithRedirects(CLOUDFLARED_DOWNLOAD_URL, fallbackPath);
    console.log(`[Tunnel] ✓ Downloaded cloudflared.exe to ${fallbackPath}`);
    return fallbackPath;
  }
}

async function persistTunnelUrlToDatabase(publicUrl, dbClient) {
  if (!dbClient || !publicUrl) return;
  try {
    await dbClient.systemSetting.upsert({
      where: { settingKey: "PUBLIC_TUNNEL_URL" },
      update: { settingValue: publicUrl },
      create: {
        settingKey: "PUBLIC_TUNNEL_URL",
        settingValue: publicUrl,
        category: "NETWORK",
        description: "Active Public HTTPS Tunnel URL for External Supervisor & HR Email Links",
      },
    });
  } catch (err) {
    console.warn("[Tunnel] Could not persist PUBLIC_TUNNEL_URL to database:", err.message);
  }
}

/**
 * Starts and supervises a background Cloudflare HTTPS Tunnel pointing to http://127.0.0.1:<PORT>.
 */
export async function startPublicTunnel({
  dbClient = null,
  port = process.env.PORT || "5000",
  detached = false,
} = {}) {
  if (process.env.DISABLE_PUBLIC_TUNNEL === "true") {
    return null;
  }

  const existingUrl = readActiveTunnelUrl();
  if (existingUrl) {
    currentPublicUrl = existingUrl;
    await persistTunnelUrlToDatabase(existingUrl, dbClient);
    return existingUrl;
  }

  let binPath;
  try {
    binPath = await ensureCloudflaredBinary();
  } catch (err) {
    console.warn("[Tunnel] Could not prepare cloudflared.exe (offline/LAN mode active):", err.message);
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finishOnce = (url) => {
      if (!resolved) {
        resolved = true;
        resolve(url);
      }
    };

    const launch = () => {
      if (shuttingDown) return;

      const existing = readActiveTunnelUrl();
      if (existing) {
        currentPublicUrl = existing;
        finishOnce(existing);
        return;
      }

      const token = (process.env.CLOUDFLARE_TUNNEL_TOKEN || "").trim();
      const args = token
        ? ["tunnel", "--no-autoupdate", "--protocol", "http2", "run", "--token", token]
        : [
            "tunnel",
            "--url",
            `http://127.0.0.1:${port}`,
            "--no-autoupdate",
            "--protocol",
            "http2",
          ];

      try {
        const child = spawn(binPath, args, {
          cwd: PROJECT_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          detached,
        });
        if (detached) {
          child.unref();
        }
        activeChild = child;

        const handleOutput = (chunk) => {
          const text = String(chunk || "");
          const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (match && match[0]) {
            const detectedUrl = match[0].replace(/\/$/, "");
            if (currentPublicUrl !== detectedUrl) {
              currentPublicUrl = detectedUrl;
              process.env.PUBLIC_TUNNEL_URL = detectedUrl;
              writeTunnelStatus({
                publicUrl: detectedUrl,
                pid: child.pid,
                port: Number(port),
                startedAt: new Date().toISOString(),
                mode: "cloudflare-quick-tunnel",
              });
              persistTunnelUrlToDatabase(detectedUrl, dbClient);
              console.log(
                `[Tunnel] ✓ Public HTTPS Tunnel Active: ${detectedUrl} -> http://127.0.0.1:${port}`
              );
              console.log(
                `[Tunnel] ✓ External Supervisor Form URL: ${detectedUrl}/supervisor-form`
              );
            }
            finishOnce(detectedUrl);
          }
        };

        child.stdout?.on("data", handleOutput);
        child.stderr?.on("data", handleOutput);

        child.on("error", (err) => {
          console.warn("[Tunnel] Process error:", err.message);
          finishOnce(null);
        });

        child.on("exit", (code) => {
          activeChild = null;
          if (!shuttingDown && !detached) {
            console.warn(
              `[Tunnel] cloudflared exited (code ${code}). Reconnecting in 10s...`
            );
            setTimeout(launch, 10000);
          }
        });
      } catch (err) {
        console.warn("[Tunnel] Failed to spawn cloudflared:", err.message);
        finishOnce(null);
      }
    };

    launch();

    // Timeout after 12s so caller doesn't block forever if internet is offline
    setTimeout(() => finishOnce(currentPublicUrl), 12000);
  });
}

export function stopPublicTunnel() {
  shuttingDown = true;
  if (activeChild) {
    try {
      activeChild.kill();
    } catch {}
    activeChild = null;
  }
}

process.on("SIGINT", () => {
  stopPublicTunnel();
});
process.on("SIGTERM", () => {
  stopPublicTunnel();
});

// Allow running standalone: `node scripts/tunnel-manager.mjs [--detach]`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const isDetach = process.argv.includes("--detach");
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER — PUBLIC HTTPS TUNNEL AGENT");
  console.log("==================================================================");
  startPublicTunnel({ detached: isDetach }).then((url) => {
    if (url) {
      console.log(`[Tunnel] Ready for outside-network access at: ${url}`);
    } else {
      console.log("[Tunnel] Waiting for internet connectivity to establish public tunnel...");
    }
    if (isDetach) {
      process.exit(0);
    }
  });
}
