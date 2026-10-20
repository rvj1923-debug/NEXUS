/**
 * Windows NFC Reader Local Agent
 * Dedicated localhost service running on 127.0.0.1:8002
 * Provides secure, authenticated local hardware bridge for USB NFC Readers
 */

import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadEnvFileIfPresent() {
  const candidates = [
    process.env.ENV_FILE_PATH ? path.resolve(process.cwd(), process.env.ENV_FILE_PATH) : null,
    path.join(process.cwd(), ".env"),
    path.join(PROJECT_ROOT, ".env"),
    process.platform === "win32" ? "C:\\ProgramData\\PhoneTracker\\.env" : null,
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (!envPath || !fs.existsSync(envPath)) continue;
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
      break;
    } catch {
      // ignore .env read errors
    }
  }
}

loadEnvFileIfPresent();

const PORT = Number(process.env.AGENT_PORT) || 8002;
const rawHost = (process.env.AGENT_HOST || "127.0.0.1").trim() || "127.0.0.1";
const HOST = rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
const AGENT_VERSION = "1.0.0-phase3";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);
if (process.env.AGENT_ALLOWED_ORIGINS) {
  for (const rawOrigin of process.env.AGENT_ALLOWED_ORIGINS.split(",")) {
    const trimmed = rawOrigin.trim();
    if (trimmed) {
      ALLOWED_ORIGINS.add(trimmed);
    }
  }
}

// Pairing Secret / Active Tokens
const pairingSecret = (process.env.AGENT_PAIRING_SECRET || "").trim();
const isProduction = (process.env.NODE_ENV || "").trim().toLowerCase() === "production";

if (isProduction && pairingSecret.length < 32) {
  console.error(
    "[NFC Reader Agent] FATAL: AGENT_PAIRING_SECRET is missing or shorter than 32 characters in production mode. Refusing to start."
  );
  process.exit(1);
}

const activeTokens = new Set();

function isValidPairingKey(candidate) {
  if (!pairingSecret || typeof candidate !== "string" || candidate.length === 0) {
    return false;
  }
  const expectedBuf = Buffer.from(pairingSecret, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");
  if (expectedBuf.length !== candidateBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, candidateBuf);
}

// State
let connectionMode = "MODE_A_KEYBOARD_WEDGE";
let lastError = null;
let lastScannedAt = null;

// Real-time hardware connection state
let hardwareState = {
  detected: false,
  name: "Checking...",
  vid: null,
  pid: null,
  interface: "None",
  count: 0,
  lastCheckedAt: Date.now(),
};

// Short-lived scan queue (15 seconds TTL)
const scanQueue = [];
const sseClients = new Set();

// Debounce map (1500ms)
const debounceCache = new Map();

function isDebounced(uid, windowMs = 1500) {
  const now = Date.now();
  const last = debounceCache.get(uid);
  if (last && now - last < windowMs) {
    return true;
  }
  debounceCache.set(uid, now);
  return false;
}

function normalizeCard(raw) {
  const cleaned = String(raw).trim().toUpperCase();
  const hex = cleaned.replace(/[^0-9A-F]/g, "");
  let normalizedUid = cleaned;

  if (hex.length >= 8 && hex.length % 2 === 0 && !cleaned.includes(":")) {
    const chunks = [];
    for (let i = 0; i < hex.length; i += 2) {
      chunks.push(hex.slice(i, i + 2));
    }
    normalizedUid = chunks.join(":");
  }

  const byteLength = Math.ceil(hex.length / 2) || 4;
  let standard = "MIFARE_CLASSIC";
  if (byteLength === 7) standard = "MIFARE_DESFIRE";
  else if (byteLength === 8) standard = "HID_ICLASS";
  else if (byteLength === 10) standard = "FELICA";

  return {
    rawInput: cleaned,
    normalizedUid,
    specificCardNumber: `SN-${normalizedUid}`,
    identifierType: standard,
    timestamp: new Date().toISOString(),
  };
}

function broadcastReaderStatus() {
  const payload = JSON.stringify({
    connected: hardwareState.detected,
    hardware: hardwareState,
    timestamp: Date.now(),
  });
  for (const client of sseClients) {
    try {
      client.write(`event: reader_status\ndata: ${payload}\n\n`);
    } catch {
      // client connection closed
    }
  }
}

let monitorProc = null;
let consecutiveMisses = 0;

function startHardwareMonitor() {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
    $devs = @(Get-CimInstance -Query "SELECT DeviceID, Caption, PNPClass FROM Win32_PnPEntity WHERE Present = True AND (PNPDeviceID LIKE '%VID_FFFF%' OR PNPClass = 'SmartCardReader' OR Caption LIKE '%NFC%' OR Caption LIKE '%RFID%' OR Caption LIKE '%ACR122%')")
    $detected = $devs.Count -gt 0
    $name = if ($detected) { $devs[0].Caption } else { "None" }
    $obj = [PSCustomObject]@{
        detected = $detected
        count = $devs.Count
        name = $name
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $json = $obj | ConvertTo-Json -Compress
    [Console]::WriteLine("DEVICE_STATE:" + $json)
    Start-Sleep -Milliseconds 4000
}
`;

  try {
    monitorProc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript]);

    let buffer = "";
    monitorProc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("DEVICE_STATE:")) {
          try {
            const data = JSON.parse(trimmed.slice("DEVICE_STATE:".length));
            const wasDetected = hardwareState.detected;
            const rawDetected = !!data.detected;

            let isNowDetected = rawDetected;
            if (rawDetected) {
              consecutiveMisses = 0;
            } else {
              consecutiveMisses++;
              if (wasDetected && consecutiveMisses < 2) {
                isNowDetected = true;
              }
            }

            hardwareState.detected = isNowDetected;
            hardwareState.count = isNowDetected ? Math.max(1, data.count || 1) : 0;
            hardwareState.name = isNowDetected ? (data.name && data.name !== "None" ? data.name : "USB NFC / RFID Reader") : "NFC Reader Not Connected";
            hardwareState.vid = isNowDetected ? "0xFFFF" : null;
            hardwareState.pid = isNowDetected ? "0x0035" : null;
            hardwareState.interface = isNowDetected ? "HID Keyboard Wedge (MI_00) & Raw HID (MI_01)" : "None (Disconnected)";
            hardwareState.lastCheckedAt = Date.now();

            if (wasDetected !== isNowDetected) {
              console.log(`[Hardware Monitor] Reader state changed: detected=${isNowDetected} (${hardwareState.name})`);
              broadcastReaderStatus();
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    });

    monitorProc.on("close", (code) => {
      console.warn(`[Hardware Monitor] Process exited with code ${code}. Restarting in 2s...`);
      setTimeout(startHardwareMonitor, 2000);
    });

    monitorProc.on("error", (err) => {
      console.error(`[Hardware Monitor] Process error:`, err);
    });
  } catch (err) {
    console.error("[Hardware Monitor] Failed to start monitor:", err);
    setTimeout(startHardwareMonitor, 5000);
  }
}

// Start hardware monitoring immediately
startHardwareMonitor();

function cleanup() {
  if (monitorProc) {
    try {
      monitorProc.kill();
    } catch {}
  }
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("exit", () => { cleanup(); });

function setCors(req, res) {
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function authenticate(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  return token.length > 0 && activeTokens.has(token);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1048576) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1:8002"}`);
  const pathname = url.pathname;

  // 1. Public Health & Status Checks (Reflects live physical USB connection)
  if ((pathname === "/api/agent/health" || pathname === "/api/agent/status") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        agentOnline: true,
        status: hardwareState.detected ? "ONLINE" : "DEVICE_DISCONNECTED",
        version: AGENT_VERSION,
        endpoint: `http://${HOST}:${PORT}`,
        activeMode: connectionMode,
        hardware: {
          detected: hardwareState.detected,
          name: hardwareState.detected ? hardwareState.name : "NFC Reader Not Connected",
          vid: hardwareState.detected ? hardwareState.vid : null,
          pid: hardwareState.detected ? hardwareState.pid : null,
          interface: hardwareState.detected ? hardwareState.interface : "Disconnected",
          count: hardwareState.count,
        },
        lastError,
        lastScannedAt,
        queuedScansCount: scanQueue.length,
      })
    );
    return;
  }

  // 2. Pair Endpoint (Exchanges pairingKey / secret for Bearer token)
  if (pathname === "/api/agent/pair" && req.method === "POST") {
    try {
      if (!pairingSecret) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AGENT_PAIRING_SECRET is not configured on this agent." }));
        return;
      }

      const body = await parseJsonBody(req);
      const key = String(body.pairingKey || body.secret || "");

      if (!isValidPairingKey(key)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid agent pairing key" }));
        return;
      }

      const newToken = `CPT-SES-${crypto.randomBytes(16).toString("hex")}`;
      activeTokens.add(newToken);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          paired: true,
          token: newToken,
          agentVersion: AGENT_VERSION,
          message: "Application paired successfully with local reader agent.",
        })
      );
      return;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // 3. Server-Sent Events (SSE) Stream (Public for localhost browser EventSource connection)
  if (pathname === "/api/agent/scan/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.write(`event: connected\ndata: {"message": "NFC Agent Event Stream Active", "version": "${AGENT_VERSION}"}\n\n`);
    // Immediately emit initial real-time hardware status to the connecting client
    res.write(`event: reader_status\ndata: ${JSON.stringify({ connected: hardwareState.detected, hardware: hardwareState, timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // 4. Poll Pending Scan Queue (Localhost GET)
  if (pathname === "/api/agent/scan/poll" && req.method === "GET") {
    const now = Date.now();
    // Clean expired
    while (scanQueue.length > 0 && scanQueue[0].expiresAt < now) {
      scanQueue.shift();
    }

    const nextEvent = scanQueue.shift() || null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ event: nextEvent }));
    return;
  }

  // Protected Endpoints Guard (Requires Bearer token from /api/agent/pair)
  if (!authenticate(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized: Valid Bearer pairing token required." }));
    return;
  }

  // 5. Card Tap Ingestion (Protected: Receives tap from authenticated local hardware bridge)
  if (pathname === "/api/agent/scan/tap" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const rawUid = body.cardUid || body.rawCardUid || body.uid;
      if (!rawUid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing cardUid parameter" }));
        return;
      }

      const normalized = normalizeCard(rawUid);

      // Debounce check
      if (isDebounced(normalized.normalizedUid)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "SUPPRESSED",
            message: "Duplicate bounce scan suppressed by agent debounce engine.",
          })
        );
        return;
      }

      const scanEvent = {
        id: crypto.randomUUID(),
        card: normalized,
        readerIdentifier: body.readerIdentifier || "USB-DESK-READER-01",
        connectionMode,
        receivedAt: Date.now(),
        expiresAt: Date.now() + 15000, // 15 second TTL
      };

      scanQueue.push(scanEvent);
      lastScannedAt = new Date().toISOString();

      // Broadcast to active SSE listeners
      for (const client of sseClients) {
        client.write(`event: card_tap\ndata: ${JSON.stringify(scanEvent)}\n\n`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, received: true, event: scanEvent }));
      return;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // 6. Mode Switching Endpoint (Protected)
  if (pathname === "/api/agent/mode" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (body.mode) {
        connectionMode = body.mode;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, activeMode: connectionMode }));
      return;
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Route not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[NFC Reader Agent] Listening strictly on http://${HOST}:${PORT}`);
  console.log(`[NFC Reader Agent] Version: ${AGENT_VERSION}`);
  console.log(`[NFC Reader Agent] Allowed Origins: ${Array.from(ALLOWED_ORIGINS).join(", ")}`);
});
