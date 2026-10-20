import nodemailer from "nodemailer";
import os from "node:os";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

// Known Gmail SMTP IPv4 fallback addresses in case local router DNS fails to resolve smtp.gmail.com
const GMAIL_SMTP_FALLBACK_IPS = ["142.250.4.108", "74.125.200.108", "64.233.184.108"];

function getTunnelStatusFilePath(): string {
  const baseDataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
  return path.join(baseDataDir, "tunnel-status.json");
}

function isPidAlive(pid?: number): boolean {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readActiveTunnelUrlFromDisk(): string | null {
  try {
    const statusPath = getTunnelStatusFilePath();
    if (!fs.existsSync(statusPath)) return null;
    const raw = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    if (raw?.publicUrl && typeof raw.publicUrl === "string") {
      if (!raw.pid || isPidAlive(raw.pid)) {
        return raw.publicUrl.replace(/\/$/, "");
      }
    }
  } catch {
    // ignore
  }
  return null;
}

let tunnelSpawnPromise: Promise<string | null> | null = null;

/**
 * Ensures a background Cloudflare HTTPS tunnel (tools/cloudflared.exe) is active
 * so external email links (/supervisor-form, /overdue/print-report) are reachable from mobile data or external Wi-Fi.
 */
export async function ensurePublicTunnelUrl(): Promise<string | null> {
  if (process.env.DISABLE_PUBLIC_TUNNEL === "true") {
    return null;
  }

  const active = readActiveTunnelUrlFromDisk();
  if (active) {
    return active;
  }

  if (tunnelSpawnPromise) {
    return tunnelSpawnPromise;
  }

  tunnelSpawnPromise = new Promise<string | null>((resolve) => {
    const port = process.env.PORT || "5000";
    const binCandidates = [
      path.resolve(process.cwd(), "tools", "cloudflared.exe"),
      path.resolve(process.cwd(), process.env.DATA_DIR || "data", "tools", "cloudflared.exe"),
    ];
    const binPath = binCandidates.find((p) => fs.existsSync(p));
    if (!binPath) {
      tunnelSpawnPromise = null;
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (url: string | null) => {
      if (!settled) {
        settled = true;
        tunnelSpawnPromise = null;
        resolve(url);
      }
    };

    try {
      const child = spawn(
        binPath,
        [
          "tunnel",
          "--url",
          `http://127.0.0.1:${port}`,
          "--no-autoupdate",
          "--protocol",
          "http2",
        ],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          detached: true,
        }
      );
      child.unref();

      const onData = (chunk: Buffer | string) => {
        const text = String(chunk || "");
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && match[0]) {
          const detectedUrl = match[0].replace(/\/$/, "");
          process.env.PUBLIC_TUNNEL_URL = detectedUrl;
          try {
            const statusPath = getTunnelStatusFilePath();
            const dir = path.dirname(statusPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(
              statusPath,
              JSON.stringify(
                {
                  publicUrl: detectedUrl,
                  pid: child.pid,
                  port: Number(port),
                  startedAt: new Date().toISOString(),
                  mode: "cloudflare-quick-tunnel",
                },
                null,
                2
              ),
              "utf-8"
            );
          } catch {
            // ignore
          }
          db.systemSetting
            .upsert({
              where: { settingKey: "PUBLIC_TUNNEL_URL" },
              update: { settingValue: detectedUrl },
              create: {
                settingKey: "PUBLIC_TUNNEL_URL",
                settingValue: detectedUrl,
                category: "NETWORK",
                description: "Active Public HTTPS Tunnel URL for External Supervisor & HR Email Links",
              },
            })
            .catch(() => null);
          finish(detectedUrl);
        }
      };

      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", () => finish(null));
      child.on("exit", () => finish(null));
    } catch {
      finish(null);
    }

    setTimeout(() => finish(readActiveTunnelUrlFromDisk()), 8000);
  });

  return tunnelSpawnPromise;
}

async function resolveSmtpHostIp(hostname: string): Promise<string> {
  // 1. Try standard OS lookup first
  try {
    const res = await dns.promises.lookup(hostname, { family: 4 });
    if (res?.address) return res.address;
  } catch {
    // OS DNS lookup failed; try public DNS servers (Google 8.8.8.8 / Cloudflare 1.1.1.1)
  }

  // 2. Try explicit public DNS resolver
  try {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
    const addresses = await resolver.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      return addresses[0];
    }
  } catch {
    // Public DNS unreachable or blocked
  }

  // 3. If hostname is smtp.gmail.com, return known Gmail SMTP IPv4 so connection can still try direct IP
  if (hostname.toLowerCase() === "smtp.gmail.com") {
    return GMAIL_SMTP_FALLBACK_IPS[0];
  }

  return hostname;
}

function classifyIpv4Octets(ip: string): { isPrivate: boolean; bonus: number } {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return { isPrivate: false, bonus: 0 };
  }
  if (parts[0] === 192 && parts[1] === 168) return { isPrivate: true, bonus: 20 };
  if (parts[0] === 10) return { isPrivate: true, bonus: 15 };
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { isPrivate: true, bonus: 10 };
  if (parts[0] === 169 && parts[1] === 254) return { isPrivate: true, bonus: -50 };
  return { isPrivate: false, bonus: 0 };
}

function getLocalIpv4Addresses(): { bestIp: string | null; allIps: Set<string> } {
  const nets = os.networkInterfaces();
  const allIps = new Set<string>();
  const candidates: Array<{ ip: string; score: number }> = [];

  for (const name of Object.keys(nets)) {
    const isVirtual = /vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|loopback|bluetooth|npcap|tap-|tun-|hamachi/i.test(
      name
    );
    const isPhysicalLan = /wi-fi|wifi|wlan|wireless|ethernet|eth|lan|local area connection|en\d/i.test(
      name
    );

    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")) {
        allIps.add(net.address);
        let score = classifyIpv4Octets(net.address).bonus;
        if (isVirtual) score -= 50;
        if (isPhysicalLan) score += 30;
        candidates.push({ ip: net.address, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    bestIp: candidates.length > 0 ? candidates[0].ip : null,
    allIps,
  };
}

function isPrivateLanIpv4(hostname: string): boolean {
  return classifyIpv4Octets(hostname).isPrivate;
}

export function resolveNetworkAppUrl(preferredBaseUrl?: string): string {
  const port = process.env.PORT || "5000";
  const { bestIp, allIps } = getLocalIpv4Addresses();
  const liveTunnelUrl = readActiveTunnelUrlFromDisk();

  const rawCandidates = [
    process.env.PUBLIC_APP_URL,
    liveTunnelUrl,
    process.env.PUBLIC_TUNNEL_URL,
    preferredBaseUrl,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];

  let firstValidLanOrigin: string | null = null;

  for (const raw of rawCandidates) {
    const configured = (raw || "").trim().replace(/\/$/, "");
    if (
      !configured ||
      configured.includes("localhost") ||
      configured.includes("127.0.0.1") ||
      configured.includes("0.0.0.0")
    ) {
      continue;
    }

    try {
      const parsed = new URL(configured.startsWith("http") ? configured : `http://${configured}`);
      // Ignore stale *.trycloudflare.com URLs if they do not match the currently running tunnel process
      if (
        parsed.hostname.endsWith(".trycloudflare.com") &&
        liveTunnelUrl &&
        parsed.origin.toLowerCase() !== liveTunnelUrl.toLowerCase()
      ) {
        continue;
      }
      if (parsed.hostname.endsWith(".trycloudflare.com") && !liveTunnelUrl) {
        continue;
      }

      if (isPrivateLanIpv4(parsed.hostname)) {
        // Only accept private LAN IP if it is still assigned to this machine
        if (allIps.size === 0 || allIps.has(parsed.hostname)) {
          if (!firstValidLanOrigin) {
            firstValidLanOrigin = parsed.origin;
          }
        }
        continue;
      }

      // Public internet hostname / tunnel URL takes highest priority so links work outside the LAN
      return parsed.origin;
    } catch {
      continue;
    }
  }

  if (firstValidLanOrigin) {
    return firstValidLanOrigin;
  }

  if (bestIp) {
    return `http://${bestIp}:${port}`;
  }
  return `http://localhost:${port}`;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

async function resolveSmtpConfig() {
  let host = process.env.SMTP_HOST || "";
  let port = parseInt(process.env.SMTP_PORT || "587", 10);
  let user = process.env.SMTP_USER || "";
  let pass = process.env.SMTP_PASS || "";
  let from = process.env.SMTP_FROM || "";
  let appUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL || "";

  try {
    const settings = await db.systemSetting.findMany({
      where: {
        settingKey: {
          in: [
            "SMTP_HOST",
            "SMTP_PORT",
            "SMTP_USER",
            "SMTP_PASS",
            "SMTP_FROM",
            "APP_URL",
            "PUBLIC_APP_URL",
            "PUBLIC_TUNNEL_URL",
          ],
        },
      },
    });
    const map = Object.fromEntries(settings.map((s) => [s.settingKey, s.settingValue]));
    if (map.SMTP_HOST) host = map.SMTP_HOST;
    if (map.SMTP_PORT) port = parseInt(map.SMTP_PORT, 10) || 587;
    if (map.SMTP_USER) user = map.SMTP_USER;
    if (map.SMTP_PASS) pass = map.SMTP_PASS;
    if (map.SMTP_FROM) from = map.SMTP_FROM;
    if (map.PUBLIC_APP_URL) {
      appUrl = map.PUBLIC_APP_URL;
    } else if (map.APP_URL) {
      appUrl = map.APP_URL;
    } else if (map.PUBLIC_TUNNEL_URL) {
      appUrl = map.PUBLIC_TUNNEL_URL;
    }
  } catch {
    // Fallback to process.env if db is unavailable
  }

  return {
    host: host || "smtp.gmail.com",
    port,
    user,
    pass,
    from: from || (user ? `NEXUS Tracker <${user}>` : "NEXUS <alerts@nexus.local>"),
    appUrl,
  };
}

/**
 * Sends an email via SMTP or simulates delivery if credentials are not configured
 * or if the local network currently has no internet access to reach smtp.gmail.com.
 */
export async function sendEmail(options: EmailOptions): Promise<{
  success: boolean;
  messageId: string;
  simulated: boolean;
  error?: string;
  offlineFallback?: boolean;
}> {
  const cfg = await resolveSmtpConfig();

  if (!cfg.user || !cfg.pass) {
    // Simulated delivery for environments without live SMTP server
    const simulatedId = `SIM-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`[Email Service (Simulated - No SMTP Configured)] To: ${options.to} | Subject: ${options.subject}`);
    return {
      success: true,
      messageId: simulatedId,
      simulated: true,
    };
  }

  try {
    const resolvedHost = await resolveSmtpHostIp(cfg.host);

    const transport = nodemailer.createTransport({
      host: resolvedHost,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 8000,
      tls: {
        servername: cfg.host,
        rejectUnauthorized: false,
      },
    });

    const uniqueEntityId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const info = await transport.sendMail({
      from: cfg.from,
      to: options.to,
      subject: options.subject,
      text: options.text || options.html.replace(/<[^>]+>/g, ""),
      html: options.html,
      attachments: options.attachments,
      headers: {
        "X-Entity-Ref-ID": uniqueEntityId,
      },
    });

    return {
      success: true,
      messageId: info.messageId,
      simulated: false,
    };
  } catch (error: any) {
    const msg = String(error?.message || "");
    const code = String(error?.code || "");

    // If DNS or Internet is unreachable on the local LAN (ENOTFOUND, EAI_AGAIN, ENETUNREACH, ETIMEDOUT, ECONNREFUSED, ESOCKET),
    // gracefully fall back to Local LAN / Offline Mode so it never blocks overdue notifications or HR workflows.
    const isNetworkOrDnsError =
      code === "EDNS" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ENETUNREACH" ||
      code === "EHOSTUNREACH" ||
      code === "ETIMEDOUT" ||
      code === "ESOCKET" ||
      code === "ECONNREFUSED" ||
      msg.includes("ENOTFOUND") ||
      msg.includes("getaddrinfo") ||
      msg.includes("EAI_AGAIN") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ENETUNREACH") ||
      msg.includes("Connection timeout");

    if (isNetworkOrDnsError) {
      const offlineId = `LOCAL-LAN-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      console.warn(
        `[Email Service (Offline/LAN Fallback — ${msg})] Logged email locally for To: ${options.to} | Subject: ${options.subject}`
      );
      return {
        success: true,
        messageId: offlineId,
        simulated: true,
        offlineFallback: true,
      };
    }

    console.error("[Email Service] Delivery Error:", error);
    return {
      success: false,
      messageId: "",
      simulated: false,
      error: error.message,
    };
  }
}

/**
 * Template: 24-Hour Overdue Phone Incident — Supervisor Action Mandatory Email
 * Matches the SecurePass / NEXUS 24-Hour Incident Escalation card design.
 */
export async function sendOverdueNotificationEmail(params: {
  to: string;
  recipientRole?: string;
  supervisorName?: string;
  employeeName: string;
  employeeCode: string;
  departmentName?: string;
  assetTag: string;
  phoneModel: string;
  minutesOverdue: number;
  hoursElapsed?: number;
  timedInAt?: string;
  expectedReturn: string;
  caseNumber: string;
  caseId?: string;
  appUrl?: string;
}) {
  const {
    to,
    supervisorName = "Department Supervisor",
    employeeName,
    employeeCode,
    departmentName = "General Department",
    assetTag,
    phoneModel,
    minutesOverdue,
    hoursElapsed = Math.max(24, Math.floor(minutesOverdue / 60) + 24),
    expectedReturn,
    timedInAt = expectedReturn,
    caseNumber,
    caseId,
    appUrl: preferredAppUrl,
  } = params;

  await ensurePublicTunnelUrl();
  const smtpCfg = await resolveSmtpConfig();
  const appUrl = resolveNetworkAppUrl(preferredAppUrl || smtpCfg.appUrl);

  const incidentRef = caseNumber.startsWith("INC-")
    ? caseNumber
    : `INC-${caseNumber}`;

  const urlParams = new URLSearchParams();
  if (caseId) urlParams.set("caseId", caseId);
  if (incidentRef) urlParams.set("ref", incidentRef);
  if (employeeName) urlParams.set("emp", employeeName);
  if (employeeCode) urlParams.set("code", employeeCode);
  if (departmentName) urlParams.set("dept", departmentName);
  if (assetTag) urlParams.set("asset", assetTag);
  if (phoneModel) urlParams.set("model", phoneModel);
  if (supervisorName) urlParams.set("sup", supervisorName);
  if (to) urlParams.set("supEmail", to);
  if (timedInAt) urlParams.set("timedIn", timedInAt);
  if (hoursElapsed) urlParams.set("hours", String(hoursElapsed));

  const qs = urlParams.toString();
  const baseFormUrl = `${appUrl}/supervisor-form${qs ? `?${qs}` : ""}`;
  const approvedUrl = `${baseFormUrl}${qs ? "&" : "?"}decision=APPROVED`;
  const disapprovedUrl = `${baseFormUrl}${qs ? "&" : "?"}decision=NOT_APPROVED`;

  const footerTimestamp = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date());

  const uniqueToken = `${caseNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const subject = `[SUPERVISOR ACTION MANDATORY] 24-Hour Overdue Phone Incident — ${employeeName} (${assetTag}) • Ref: ${incidentRef}`;

  const html = `
    <div style="background-color: #f1f5f9; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #fecdd3; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);">
        
        <!-- Deep Crimson Top Header Banner -->
        <div style="background: linear-gradient(180deg, #9f1239 0%, #be123c 55%, #dc2626 100%); background-color: #be123c; padding: 28px 24px 26px 24px; text-align: center; color: #ffffff;">
          <div style="display: inline-block; background-color: #fff1f2; color: #9f1239; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 18px; border-radius: 9999px; margin-bottom: 14px;">
            ⚠️ SUPERVISOR ACTION MANDATORY
          </div>
          <h1 style="margin: 0; font-size: 23px; font-weight: 900; letter-spacing: 0.02em; text-transform: uppercase; color: #ffffff; line-height: 1.2;">
            24-HOUR OVERDUE PHONE INCIDENT
          </h1>
          <div style="margin-top: 8px; font-size: 12px; color: #ffe4e6; font-weight: 500;">
            SecurePass NEXUS &bull; Incident Escalation &bull; Ref: ${incidentRef}
          </div>
          <span style="display:none !important; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${uniqueToken}-H</span>
        </div>

        <!-- Body Content -->
        <div style="padding: 26px 28px 24px 28px;">
          
          <!-- Soft Rose Alert Callout Box -->
          <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; padding: 16px 20px; color: #9f1239; font-size: 13.5px; line-height: 1.55; margin-bottom: 22px;">
            <strong>Attention Supervisor:</strong> A company-issued mobile phone checked out by an employee has exceeded <strong>${hoursElapsed} continuous hours</strong> without a turnstile return scan. Your evaluation (Excused / Unexcused) is urgently required to initiate HR review.
          </div>

          <!-- Gray Rounded Details Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 24px; margin-bottom: 26px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
              <tr>
                <td style="padding: 7px 0; color: #64748b; width: 38%; vertical-align: middle;">Incident Ref:</td>
                <td style="padding: 7px 0; font-family: 'Courier New', Courier, monospace; font-weight: 800; color: #e11d48; vertical-align: middle;">${incidentRef}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Employee Name:</td>
                <td style="padding: 7px 0; font-weight: 900; font-size: 15px; color: #0f172a; text-transform: uppercase; vertical-align: middle;">${employeeName}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Employee Pass / ID:</td>
                <td style="padding: 7px 0; font-family: 'Courier New', Courier, monospace; font-weight: 800; color: #0284c7; vertical-align: middle;">${employeeCode}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Company Phone:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #0f172a; vertical-align: middle;">${assetTag}${phoneModel && phoneModel !== assetTag ? ` (${phoneModel})` : ""}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Assigned Dept:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #0f172a; vertical-align: middle;">${departmentName}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Dept Supervisor:</td>
                <td style="padding: 7px 0; color: #475569; font-weight: 500; vertical-align: middle;">${supervisorName}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Check-In / Time-In:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #b45309; vertical-align: middle;">${timedInAt}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Time Overdue:</td>
                <td style="padding: 7px 0; font-weight: 800; font-size: 14.5px; color: #e11d48; vertical-align: middle;">${hoursElapsed} Hours (Limit: 24h)</td>
              </tr>
            </table>
          </div>

          <!-- Supervisor Classification Buttons -->
          <div style="text-align: center;">
            <div style="font-size: 13px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: #0f172a; margin-bottom: 16px;">
              CHOOSE SUPERVISOR CLASSIFICATION:
            </div>
            <div>
              <a href="${approvedUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #059669; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.03em; padding: 13px 28px; border-radius: 10px; text-decoration: none; margin: 4px 6px; min-width: 145px;">
                &#10004; EXCUSED
              </a>
              <a href="${disapprovedUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #be123c; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.03em; padding: 13px 28px; border-radius: 10px; text-decoration: none; margin: 4px 6px; min-width: 145px;">
                &#10006; UNEXCUSED
              </a>
            </div>
            <p style="margin: 16px 0 0 0; font-size: 11.5px; color: #64748b; line-height: 1.55;">
              Clicking either button opens the NEXUS Secure Supervisor Review form with that choice preselected.<br/>
              <span style="font-size: 11px;">Direct Web Link: <a href="${baseFormUrl}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; word-break: break-all;">${appUrl}/supervisor-form?caseId=${caseId || caseNumber}</a></span><br/>
              <strong style="color: #334155;">Security Notice:</strong> Clicking an email link will NOT modify database records without formal confirmation.
            </p>
          </div>

        </div>

        <!-- Bottom Footer Bar -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11px; color: #64748b;">
          Pampanga's Best &bull; SecurePass NEXUS &bull; Enterprise Custody &amp; Incident Workflow &bull; ${footerTimestamp}
          <span style="display:none !important; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${uniqueToken}-END</span>
        </div>

      </div>
    </div>
  `;

  return sendEmail({ to, subject, html });
}

/**
 * Template: Supervisor Overdue Phone Decision Sent to HR Department
 * Matches the same 24-Hour Overdue Phone Incident visual card layout.
 */
export async function sendHrOvertimeDecisionEmail(params: {
  to: string;
  caseId?: string;
  caseNumber: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  assetTag: string;
  phoneModel?: string;
  imei?: string;
  timedInAt: string;
  deadlineAt: string;
  minutesOverdue: number;
  decision: "APPROVED" | "NOT_APPROVED";
  supervisorName: string;
  supervisorEmail: string;
  supervisorRemarks: string;
  reviewedAt: string;
  appUrl?: string;
}) {
  const {
    to,
    caseId,
    caseNumber,
    employeeName,
    employeeCode,
    departmentName,
    assetTag,
    phoneModel = "",
    imei = "N/A",
    timedInAt,
    minutesOverdue,
    decision,
    supervisorName,
    supervisorEmail,
    supervisorRemarks,
    reviewedAt,
    appUrl: preferredAppUrl,
  } = params;

  await ensurePublicTunnelUrl();
  const smtpCfg = await resolveSmtpConfig();
  const appUrl = resolveNetworkAppUrl(preferredAppUrl || smtpCfg.appUrl);
  const printReportUrl = caseId
    ? `${appUrl}/overdue/print-report?caseId=${caseId}`
    : `${appUrl}/overdue/print-report`;
  const adminOverdueTabUrl = caseId
    ? `${appUrl}/api/auth/hr-access?caseId=${caseId}`
    : `${appUrl}/api/auth/hr-access`;

  const isApproved = decision === "APPROVED";
  const hoursElapsed = Math.max(24, Math.floor(minutesOverdue / 60) + 24);
  const incidentRef = caseNumber.startsWith("INC-")
    ? caseNumber
    : `INC-${caseNumber}`;

  const bannerGradient = isApproved
    ? "linear-gradient(180deg, #065f46 0%, #047857 55%, #059669 100%)"
    : "linear-gradient(180deg, #9f1239 0%, #be123c 55%, #dc2626 100%)";
  const bannerBgColor = isApproved ? "#059669" : "#be123c";
  const outerBorderColor = isApproved ? "#a7f3d0" : "#fecdd3";
  const pillBg = isApproved ? "#ecfdf5" : "#fff1f2";
  const pillColor = isApproved ? "#065f46" : "#9f1239";
  const pillLabel = isApproved
    ? "✓ SUPERVISOR EXCUSED • AUTO-CLOSED"
    : "⚠️ HR ACTION MANDATORY • UNEXCUSED";

  const calloutBg = isApproved ? "#ecfdf5" : "#fff1f2";
  const calloutBorder = isApproved ? "#a7f3d0" : "#fecdd3";
  const calloutText = isApproved ? "#065f46" : "#9f1239";

  const subject = isApproved
    ? `[HR OVERDUE REPORT • EXCUSED & AUTO-CLOSED] ${employeeName} (${assetTag}) • Ref: ${incidentRef}`
    : `[HR ACTION MANDATORY • UNEXCUSED OVERDUE PHONE] ${employeeName} (${assetTag}) • Ref: ${incidentRef}`;

  const uniqueToken = `${caseNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const html = `
    <div style="background-color: #f1f5f9; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid ${outerBorderColor}; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);">
        
        <!-- Top Header Banner -->
        <div style="background: ${bannerGradient}; background-color: ${bannerBgColor}; padding: 28px 24px 26px 24px; text-align: center; color: #ffffff;">
          <div style="display: inline-block; background-color: ${pillBg}; color: ${pillColor}; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 18px; border-radius: 9999px; margin-bottom: 14px;">
            ${pillLabel}
          </div>
          <h1 style="margin: 0; font-size: 23px; font-weight: 900; letter-spacing: 0.02em; text-transform: uppercase; color: #ffffff; line-height: 1.2;">
            24-HOUR OVERDUE PHONE INCIDENT
          </h1>
          <div style="margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.9); font-weight: 500;">
            SecurePass NEXUS &bull; HR Incident Escalation &bull; Ref: ${incidentRef}
          </div>
          <span style="display:none !important; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${uniqueToken}-H</span>
        </div>

        <!-- Body Content -->
        <div style="padding: 26px 28px 24px 28px;">
          
          <!-- Alert Callout Box -->
          <div style="background-color: ${calloutBg}; border: 1px solid ${calloutBorder}; border-radius: 12px; padding: 16px 20px; color: ${calloutText}; font-size: 13.5px; line-height: 1.55; margin-bottom: 22px;">
            ${
              isApproved
                ? `<strong>Attention HR Department:</strong> Department Supervisor <strong>${supervisorName}</strong> evaluated this <strong>${hoursElapsed}-hour</strong> overdue company phone incident as <strong>EXCUSED (APPROVED)</strong>. The case has been automatically closed and no incident report needs to be printed or served.`
                : `<strong>Attention HR Department:</strong> A company-issued mobile phone checked out by an employee has exceeded <strong>${hoursElapsed} continuous hours</strong> and was evaluated as <strong>UNEXCUSED (DISAPPROVED)</strong> by Supervisor <strong>${supervisorName}</strong>. Printing and serving the official Incident Report is urgently required.`
            }
          </div>

          <!-- Gray Rounded Details Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 24px; margin-bottom: 26px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
              <tr>
                <td style="padding: 7px 0; color: #64748b; width: 38%; vertical-align: middle;">Incident Ref:</td>
                <td style="padding: 7px 0; font-family: 'Courier New', Courier, monospace; font-weight: 800; color: #e11d48; vertical-align: middle;">${incidentRef}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Employee Name:</td>
                <td style="padding: 7px 0; font-weight: 900; font-size: 15px; color: #0f172a; text-transform: uppercase; vertical-align: middle;">${employeeName}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Employee Pass / ID:</td>
                <td style="padding: 7px 0; font-family: 'Courier New', Courier, monospace; font-weight: 800; color: #0284c7; vertical-align: middle;">${employeeCode}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Company Phone:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #0f172a; vertical-align: middle;">${assetTag}${phoneModel && phoneModel !== assetTag ? ` (${phoneModel})` : ""} <span style="color: #64748b; font-weight: 500; font-size: 12px;">• IMEI: ${imei}</span></td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Assigned Dept:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #0f172a; vertical-align: middle;">${departmentName}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Dept Supervisor:</td>
                <td style="padding: 7px 0; color: #475569; font-weight: 500; vertical-align: middle;">${supervisorName} (${supervisorEmail})</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Check-In / Time-In:</td>
                <td style="padding: 7px 0; font-weight: 800; color: #b45309; vertical-align: middle;">${timedInAt}</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Time Overdue:</td>
                <td style="padding: 7px 0; font-weight: 800; font-size: 14.5px; color: #e11d48; vertical-align: middle;">${hoursElapsed} Hours (Limit: 24h)</td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: middle;">Classification:</td>
                <td style="padding: 7px 0; font-weight: 800; color: ${isApproved ? "#059669" : "#be123c"}; vertical-align: middle;">
                  ${isApproved ? "✓ EXCUSED (APPROVED — AUTO-CLOSED)" : "✖ UNEXCUSED (DISAPPROVED — SERVE REPORT)"}
                </td>
              </tr>
              <tr>
                <td style="padding: 7px 0; color: #64748b; vertical-align: top;">Supervisor Remarks:</td>
                <td style="padding: 7px 0; font-weight: 700; color: #0f172a; white-space: pre-wrap; vertical-align: top;">${supervisorRemarks}</td>
              </tr>
            </table>
          </div>

          <!-- HR Action Buttons -->
          <div style="text-align: center;">
            <div style="font-size: 13px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: #0f172a; margin-bottom: 16px;">
              HR DEPARTMENT INCIDENT WORKFLOW:
            </div>
            <div>
              ${
                isApproved
                  ? `<a href="${adminOverdueTabUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #059669; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.03em; padding: 13px 28px; border-radius: 10px; text-decoration: none; margin: 4px 6px;">
                      🛡️ OPEN HR OVERDUE PORTAL
                    </a>`
                  : `<a href="${printReportUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0f172a; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.03em; padding: 13px 24px; border-radius: 10px; text-decoration: none; margin: 4px 6px;">
                      🖨️ PRINT INCIDENT REPORT
                    </a>
                    <a href="${adminOverdueTabUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #be123c; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.03em; padding: 13px 24px; border-radius: 10px; text-decoration: none; margin: 4px 6px;">
                      🛡️ OPEN HR OVERDUE PORTAL
                    </a>`
              }
            </div>
            <p style="margin: 16px 0 0 0; font-size: 11.5px; color: #64748b; line-height: 1.55;">
              Clicking a workflow button opens the NEXUS HR Overdue Compliance Portal.<br/>
              <strong style="color: #334155;">Security Notice:</strong> Clicking an email link will NOT modify database records without formal confirmation.
            </p>
          </div>

        </div>

        <!-- Bottom Footer Bar -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11px; color: #64748b;">
          Pampanga's Best &bull; SecurePass NEXUS &bull; Enterprise Custody &amp; Incident Workflow &bull; ${reviewedAt}
          <span style="display:none !important; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${uniqueToken}-END</span>
        </div>

      </div>
    </div>
  `;

  return sendEmail({ to, subject, html });
}

/**
 * Template: Scheduled Daily Report Delivery
 */
export async function sendDailyReportEmail(params: {
  to: string;
  reportDate: string;
  summary: {
    totalRegistered: number;
    available: number;
    issuedDuringPeriod: number;
    returnedDuringPeriod: number;
    onTimeReturns: number;
    lateReturns: number;
    stillOutstanding: number;
    activeOverdueCases: number;
  };
  csvBuffer?: Buffer;
}) {
  const { to, reportDate, summary, csvBuffer } = params;

  const subject = `[Daily Custody Report] NEXUS — ${reportDate}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <div style="background-color: #1e3a8a; color: white; padding: 12px 16px; border-radius: 6px; font-weight: bold; font-size: 16px;">
        📊 NEXUS — Daily Custody Summary
      </div>
      <p style="margin-top: 14px; color: #334155; font-size: 14px;">
        Automated daily phone custody audit report for <strong>${reportDate}</strong> (${COMPANY_TIMEZONE}).
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Total Registered Fleet:</td><td style="font-weight: bold; text-align: right;">${summary.totalRegistered}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Available in Depot:</td><td style="font-weight: bold; text-align: right;">${summary.available}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Devices Issued:</td><td style="font-weight: bold; text-align: right;">${summary.issuedDuringPeriod}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #64748b;">Devices Returned:</td><td style="font-weight: bold; text-align: right;">${summary.returnedDuringPeriod}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #16a34a;">On-Time Returns:</td><td style="font-weight: bold; color: #16a34a; text-align: right;">${summary.onTimeReturns}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #dc2626;">Late Returns:</td><td style="font-weight: bold; color: #dc2626; text-align: right;">${summary.lateReturns}</td></tr>
        <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; color: #2563eb;">Currently Outstanding Balance:</td><td style="font-weight: bold; color: #2563eb; text-align: right;">${summary.stillOutstanding}</td></tr>
        <tr><td style="padding: 8px 0; color: #d97706;">Active Overdue Cases (&gt;24h):</td><td style="font-weight: bold; color: #d97706; text-align: right;">${summary.activeOverdueCases}</td></tr>
      </table>
      <p style="color: #64748b; font-size: 11px;">
        Generated automatically by NEXUS (NFC-Enabled Exchange &amp; Usage System) at 23:59 ${COMPANY_TIMEZONE}. CSV attachment enclosed.
      </p>
    </div>
  `;

  const attachments = csvBuffer
    ? [
        {
          filename: `custody-report-${reportDate}.csv`,
          content: csvBuffer,
          contentType: "text/csv",
        },
      ]
    : undefined;

  return sendEmail({ to, subject, html, attachments });
}
