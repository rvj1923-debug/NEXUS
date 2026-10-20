/**
 * Persistent Background 24-Hour Overdue Monitoring & Scheduled Report Worker
 * Runs independently on the server without browser or kiosk dependencies.
 *
 * Capabilities:
 * 1. Periodic scan of open custody transactions (>24 hours not timed out or surrendered) every 60s.
 * 2. Issues email & notification to the Department Supervisor to fill out the Overtime Usage Approval Form.
 * 3. Daily scheduled report generation at 23:59 Asia/Manila.
 */

import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";
import os from "node:os";
import { execSync } from "node:child_process";
import { createBackup, loadEnvIfNeeded } from "./backup-db.mjs";
import { startPublicTunnel, readActiveTunnelUrl } from "./tunnel-manager.mjs";

loadEnvIfNeeded();

const db = new PrismaClient();
const COMPANY_TIMEZONE = "Asia/Manila";
const SCAN_INTERVAL_MS = 60 * 1000; // 60 seconds
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes
const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_HR_EMAIL = process.env.HR_DEPARTMENT_EMAIL || "hr@company.com";

function classifyIpv4Octets(ip) {
  const parts = String(ip).split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return { isPrivate: false, bonus: 0 };
  }
  if (parts[0] === 192 && parts[1] === 168) return { isPrivate: true, bonus: 20 };
  if (parts[0] === 10) return { isPrivate: true, bonus: 15 };
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return { isPrivate: true, bonus: 10 };
  if (parts[0] === 169 && parts[1] === 254) return { isPrivate: true, bonus: -50 };
  return { isPrivate: false, bonus: 0 };
}

function getLocalIpv4Addresses() {
  const nets = os.networkInterfaces();
  const allIps = new Set();
  const candidates = [];

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

function isPrivateLanIpv4(hostname) {
  return classifyIpv4Octets(hostname).isPrivate;
}

function resolveNetworkAppUrl(preferredBaseUrl = "") {
  const port = process.env.PORT || "5000";
  const { bestIp, allIps } = getLocalIpv4Addresses();
  const liveTunnelUrl = readActiveTunnelUrl();

  const rawCandidates = [
    process.env.PUBLIC_APP_URL,
    liveTunnelUrl,
    process.env.PUBLIC_TUNNEL_URL,
    preferredBaseUrl,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];

  let firstValidLanOrigin = null;

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
        if (allIps.size === 0 || allIps.has(parsed.hostname)) {
          if (!firstValidLanOrigin) {
            firstValidLanOrigin = parsed.origin;
          }
        }
        continue;
      }

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

let lastDailyReportDate = "";

function getManilaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COMPANY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatManilaDateTime(date) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

function getManilaTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { hour, minute };
}

async function resolveDepartmentSupervisor(employee) {
  const deptName = employee?.department?.name || "Operations";
  if (employee?.supervisorEmail || employee?.department?.supervisorEmail) {
    const splitEmails = (val) => (val ? String(val).split(/[,;|]+/).map((s) => s.trim()).filter(Boolean) : []);
    const splitNames = (val) => (val ? String(val).split(/\s*(?:\/|&|;|\band\b)\s*|,\s*/i).map((s) => s.trim()).filter(Boolean) : []);

    const empEmails = splitEmails(employee?.supervisorEmail);
    const deptEmails = splitEmails(employee?.department?.supervisorEmail);
    const empNames = splitNames(employee?.supervisorName);
    const deptNames = splitNames(employee?.department?.supervisorName);

    const mergedEmails = [];
    const mergedNames = [];

    for (let i = 0; i < empEmails.length; i++) {
      const email = empEmails[i];
      if (!mergedEmails.some((e) => e.toLowerCase() === email.toLowerCase())) {
        mergedEmails.push(email);
        mergedNames.push(empNames[i] || deptNames[i] || "");
      }
    }
    for (let i = 0; i < deptEmails.length; i++) {
      const email = deptEmails[i];
      if (!mergedEmails.some((e) => e.toLowerCase() === email.toLowerCase()) && mergedEmails.length < 2) {
        mergedEmails.push(email);
        mergedNames.push(deptNames[i] || "");
      }
    }

    const finalEmails = mergedEmails.join(", ");
    const finalNames = mergedNames.filter(Boolean).join(" / ");

    return {
      supervisorEmail: finalEmails || employee?.supervisorEmail || employee?.department?.supervisorEmail,
      supervisorName:
        finalNames ||
        employee?.supervisorName ||
        employee?.department?.supervisorName ||
        (employee?.supervisor ? `${employee.supervisor.firstName} ${employee.supervisor.lastName}`.trim() : `${deptName} Supervisor`),
      supervisorUserId: employee?.department?.supervisorId || null,
    };
  }
  if (employee?.supervisor?.email) {
    return {
      supervisorEmail: employee.supervisor.email,
      supervisorName: `${employee.supervisor.firstName} ${employee.supervisor.lastName}`.trim(),
      supervisorUserId: null,
    };
  }
  if (employee?.departmentId) {
    const deptSup = await db.user.findFirst({
      where: {
        departmentId: employee.departmentId,
        isActive: true,
        userRoles: { some: { role: { code: "DEPT_SUPERVISOR" } } },
      },
    });
    if (deptSup) {
      return {
        supervisorEmail: deptSup.email,
        supervisorName: deptSup.fullName,
        supervisorUserId: deptSup.id,
      };
    }
  }
  const fallbackSup = await db.user.findFirst({
    where: {
      isActive: true,
      userRoles: { some: { role: { code: "DEPT_SUPERVISOR" } } },
    },
  });
  if (fallbackSup) {
    return {
      supervisorEmail: fallbackSup.email,
      supervisorName: fallbackSup.fullName,
      supervisorUserId: fallbackSup.id,
    };
  }
  return {
    supervisorEmail: "supervisor@company.com",
    supervisorName: `${deptName} Supervisor`,
    supervisorUserId: null,
  };
}

async function dispatchSupervisorEmail({
  to,
  supervisorName,
  employeeName,
  employeeCode,
  departmentName,
  assetTag,
  phoneModel = "",
  timedInAt,
  expectedReturn,
  hoursElapsed,
  minutesOverdue,
  caseNumber,
  caseId,
}) {
  let host = process.env.SMTP_HOST || "smtp.gmail.com";
  let port = parseInt(process.env.SMTP_PORT || "587", 10);
  let user = process.env.SMTP_USER || "";
  let pass = process.env.SMTP_PASS || "";
  let from = process.env.SMTP_FROM || "";
  let dbAppUrl = "";

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
      dbAppUrl = map.PUBLIC_APP_URL;
    } else if (map.APP_URL) {
      dbAppUrl = map.APP_URL;
    } else if (map.PUBLIC_TUNNEL_URL) {
      dbAppUrl = map.PUBLIC_TUNNEL_URL;
    }
  } catch {
    // Fallback to process.env
  }

  await startPublicTunnel({ dbClient: db }).catch(() => null);
  const appUrl = resolveNetworkAppUrl(dbAppUrl);
  const incidentRef = caseNumber.startsWith("INC-") ? caseNumber : `INC-${caseNumber}`;

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
  const footerTimestamp = formatManilaDateTime(new Date());
  const uniqueToken = `${caseNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const subject = `[SUPERVISOR ACTION MANDATORY] 24-Hour Overdue Phone Incident — ${employeeName} (${assetTag}) • Ref: ${incidentRef}`;

  const html = `
    <div style="background-color: #f1f5f9; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #fecdd3; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);">
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

        <div style="padding: 26px 28px 24px 28px;">
          <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 12px; padding: 16px 20px; color: #9f1239; font-size: 13.5px; line-height: 1.55; margin-bottom: 22px;">
            <strong>Attention Supervisor:</strong> A company-issued mobile phone checked out by an employee has exceeded <strong>${hoursElapsed} continuous hours</strong> without a turnstile return scan. Your evaluation (Excused / Unexcused) is urgently required to initiate HR review.
          </div>

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

        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11px; color: #64748b;">
          Pampanga's Best &bull; SecurePass NEXUS &bull; Enterprise Custody &amp; Incident Workflow &bull; ${footerTimestamp}
          <span style="display:none !important; font-size:0; line-height:0; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${uniqueToken}-END</span>
        </div>
      </div>
    </div>
  `;

  if (!user || !pass) {
    console.log(`[Worker Email (Simulated - No SMTP Configured)] To Supervisor: ${to} | Subject: ${subject} | Form URL: ${baseFormUrl}`);
    return;
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({
      from: from || `NEXUS Tracker <${user}>`,
      to,
      subject,
      html,
      text: `Overdue Phone Report (${incidentRef}): ${employeeName} (${employeeCode}) in ${departmentName} has not timed out or surrendered ${assetTag} after 24 hours (${hoursElapsed}h elapsed, +${minutesOverdue}m past 24h). Timed in at ${timedInAt}. Please fill out the Supervisor Overtime Usage Approval Form at: ${baseFormUrl}`,
    });
    console.log(`[Worker Email (DELIVERED via SMTP)] To Supervisor: ${to}`);
  } catch (err) {
    console.error("[Worker Email] Delivery Error:", err.message);
  }
}

async function resolveConfiguredHrEmail() {
  try {
    const settings = await db.systemSetting.findMany({
      where: { settingKey: { in: ["HR_DEPARTMENT_EMAIL", "SMTP_USER"] } },
    });
    const map = Object.fromEntries(settings.map((s) => [s.settingKey, s.settingValue?.trim()]));
    if (map.HR_DEPARTMENT_EMAIL && map.HR_DEPARTMENT_EMAIL.toLowerCase() !== "hr@company.com") {
      return map.HR_DEPARTMENT_EMAIL;
    }
    if (
      process.env.HR_DEPARTMENT_EMAIL &&
      process.env.HR_DEPARTMENT_EMAIL.trim().toLowerCase() !== "hr@company.com"
    ) {
      return process.env.HR_DEPARTMENT_EMAIL.trim();
    }
    if (map.HR_DEPARTMENT_EMAIL) return map.HR_DEPARTMENT_EMAIL;
    if (map.SMTP_USER) return map.SMTP_USER;
  } catch {
    // ignore
  }
  return DEFAULT_HR_EMAIL;
}

async function performOverdueScan() {
  const now = new Date();
  console.log(`[Worker ${now.toISOString()}] Executing 24-hour overdue scan...`);

  try {
    const configuredHrEmail = await resolveConfiguredHrEmail();
    const openTransactions = await db.custodyTransaction.findMany({
      where: {
        actualReturnAt: null,
        status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
        transactionType: { in: ["ISSUANCE", "TIME_IN"] },
      },
      include: {
        employee: { include: { department: true, supervisor: true } },
        phoneAsset: true,
        nfcCard: {
          include: {
            phoneAsset: true,
            employee: { include: { department: true, supervisor: true } },
          },
        },
        returnDeadline: true,
        overdueCases: {
          orderBy: { detectedAt: "desc" },
        },
      },
    });

    let newlyOverdueCount = 0;

    for (const tx of openTransactions) {
      const deadline = tx.returnDeadline;
      if (deadline && deadline.isExempt) continue;

      const phoneAsset = tx.phoneAsset || tx.nfcCard?.phoneAsset || null;
      const employee = tx.employee || tx.nfcCard?.employee || null;
      const phoneAssetId = tx.phoneAssetId || phoneAsset?.id || null;
      const employeeId = tx.employeeId || employee?.id || null;

      const twentyFourHourMark = new Date(new Date(tx.timestamp).getTime() + OVERDUE_THRESHOLD_MS);
      const effectiveDeadline =
        deadline?.extendedReturnAt && deadline.extendedReturnAt.getTime() > twentyFourHourMark.getTime()
          ? deadline.extendedReturnAt
          : twentyFourHourMark;

      if (now.getTime() >= effectiveDeadline.getTime()) {
        const minutesOverdue = Math.max(
          1,
          Math.floor((now.getTime() - effectiveDeadline.getTime()) / (60 * 1000))
        );
        const hoursElapsed = Math.max(
          24,
          Math.floor((now.getTime() - new Date(tx.timestamp).getTime()) / (60 * 60 * 1000))
        );

        let overdueCase = tx.overdueCases[0] || null;

        // Never duplicate an OverdueCase if one already exists and was resolved/closed or approved
        if (
          overdueCase &&
          (overdueCase.status === "RESOLVED" ||
            overdueCase.overtimeApprovalStatus === "APPROVED" ||
            tx.overdueCases.some(
              (c) => c.status === "RESOLVED" || c.overtimeApprovalStatus === "APPROVED"
            ))
        ) {
          continue;
        }

        if (!overdueCase) {
          const caseNumber = `OVD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(10000 + Math.random() * 90000)}`;
          const supContact = await resolveDepartmentSupervisor(employee);

          overdueCase = await db.overdueCase.create({
            data: {
              caseNumber,
              phoneAssetId,
              employeeId,
              custodyTransactionId: tx.id,
              detectedAt: now,
              status: "OPEN",
              escalationTier: 0,
              minutesOverdue,
              lastEscalatedAt: now,
              assignedSupervisorId: employee?.supervisorId || null,
              supervisorEmail: supContact.supervisorEmail,
              supervisorNotifiedAt: now,
              overtimeApprovalStatus: "PENDING",
              hrEmail: configuredHrEmail,
            },
          });

          newlyOverdueCount++;

          await db.custodyTransaction.update({
            where: { id: tx.id },
            data: {
              status: "OVERDUE",
              overdueMinutes: minutesOverdue,
              returnDeadlineAt: effectiveDeadline,
            },
          });

          if (deadline) {
            await db.returnDeadline.update({
              where: { id: deadline.id },
              data: { status: "OVERDUE" },
            });
          }

          if (phoneAssetId && employeeId) {
            await db.custodyEvent.create({
              data: {
                transactionId: tx.id,
                phoneAssetId,
                employeeId,
                eventType: "MARKED_OVERDUE",
                details: `[Worker] Device unreturned after 24 hours (${hoursElapsed}h elapsed). Overdue report ${caseNumber} emailed to Department Supervisor (${supContact.supervisorEmail}).`,
              },
            });
          }

          const empName = employee
            ? `${employee.firstName} ${employee.lastName}`.trim()
            : "Assigned Employee";
          const empCode = employee?.employeeCode || "N/A";
          const deptName = employee?.department?.name || "Operations";
          const assetTag =
            phoneAsset?.assetTag || tx.nfcCard?.cardNumber || tx.nfcCard?.cardUid || "Company Phone";

          await db.notification.create({
            data: {
              recipientUserId: supContact.supervisorUserId,
              recipientRoleCode: "DEPT_SUPERVISOR",
              title: `24-Hour Overdue Phone — Overtime Approval Form Required (${assetTag})`,
              message: `${empName} (${deptName}) has not timed out or surrendered ${assetTag} after 24 hours. Please fill out the Supervisor Overtime Usage Approval Form for HR.`,
              type: "URGENT",
              severity: "HIGH",
              linkUrl: `/overdue?reviewCaseId=${overdueCase.id}`,
              employeeId,
              phoneAssetId,
              overdueCaseId: overdueCase.id,
            },
          });

          await dispatchSupervisorEmail({
            to: supContact.supervisorEmail,
            supervisorName: supContact.supervisorName,
            employeeName: empName,
            employeeCode: empCode,
            departmentName: deptName,
            assetTag,
            timedInAt: formatManilaDateTime(tx.timestamp),
            expectedReturn: formatManilaDateTime(effectiveDeadline),
            hoursElapsed,
            minutesOverdue,
            caseNumber,
            caseId: overdueCase.id,
          });
        } else {
          await db.overdueCase.update({
            where: { id: overdueCase.id },
            data: {
              minutesOverdue,
              ...(!overdueCase.hrEmail || overdueCase.hrEmail === "hr@company.com"
                ? { hrEmail: configuredHrEmail }
                : {}),
            },
          });

          await db.custodyTransaction.update({
            where: { id: tx.id },
            data: { status: "OVERDUE", overdueMinutes: minutesOverdue },
          });
        }
      }
    }

    console.log(
      `[Worker] 24h Scan complete: ${openTransactions.length} open transactions checked. Newly overdue (>24h): ${newlyOverdueCount}`
    );
  } catch (error) {
    console.error("[Worker] Error during overdue scan:", error);
  }
}

async function checkAndTriggerScheduledReport() {
  const now = new Date();
  const todayStr = getManilaDateString(now);
  const { hour, minute } = getManilaTimeParts(now);

  if (hour === 23 && minute >= 58 && lastDailyReportDate !== todayStr) {
    console.log(`[Worker] Triggering scheduled daily custody report for ${todayStr}...`);
    try {
      const admin = await db.user.findFirst({
        where: { userRoles: { some: { role: { code: "SYSTEM_ADMIN" } } } },
      });

      if (admin) {
        const totalTx = await db.custodyTransaction.count();
        const activeOverdue = await db.overdueCase.count({ where: { status: "OPEN" } });

        await db.reportRun.create({
          data: {
            reportName: `Daily Custody Audit Report — ${todayStr}`,
            reportType: "DAILY_CUSTODY",
            reportDate: todayStr,
            generatedByUserId: admin.id,
            recordCount: totalTx,
            fileFormat: "CSV",
            isScheduled: true,
            status: "SUCCESS",
            summaryMetrics: JSON.stringify({
              reportDate: todayStr,
              activeOverdue,
              generatedAt: now.toISOString(),
            }),
          },
        });

        lastDailyReportDate = todayStr;
        console.log(`[Worker] Scheduled daily report for ${todayStr} recorded successfully.`);
      }
    } catch (err) {
      console.error("[Worker] Failed to create scheduled daily report:", err);
    }
  }
}

async function isAutoHealOrRestoreRunning() {
  const controlPort = parseInt(process.env.PG_CONTROL_PORT || "54320", 10);
  const host = process.env.PGHOST || "127.0.0.1";
  try {
    const res = await fetch(`http://${host}:${controlPort}/health`);
    if (res.ok) {
      const body = await res.json();
      if (body?.autoHealInProgress === true) {
        return true;
      }
    }
  } catch {
    // Control listener not up yet or unreachable
  }

  if (process.platform === "win32") {
    try {
      const cmd =
        'powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'node.exe\'\\" | Where-Object { $_.CommandLine -match \'auto-heal-db\\.mjs|restore-db\\.mjs\' } | Select-Object -ExpandProperty ProcessId"';
      const out = execSync(cmd, { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out.length > 0) {
        return true;
      }
    } catch {
      // Ignore process query errors
    }
  }
  return false;
}

async function waitForDatabase(maxRetries = 30, delayMs = 2000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      if (await isAutoHealOrRestoreRunning()) {
        console.log(
          `[Worker] Waiting while auto-heal-db.mjs / restore-db.mjs is running (attempt ${i}/${maxRetries})...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      await db.$queryRaw`SELECT 1`;
      console.log("[Worker] Database connection established.");
      return true;
    } catch (err) {
      console.log(`[Worker] Waiting for database server connectivity (attempt ${i}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to database after multiple retries.");
}

async function performScheduledBackup(reason = "scheduled-30m") {
  try {
    await createBackup({
      skipIfUnchanged: true,
      reason,
      dbClient: db,
    });
  } catch (err) {
    console.error(`[Worker Backup (${reason})] Error during backup cycle:`, err.message);
  }
}

async function main() {
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER — 24-HOUR OVERDUE MONITORING & BACKUP WORKER");
  console.log("  Rule: >24h Not Surrendered -> Supervisor Form -> HR Email");
  console.log("  Timezone: Asia/Manila (UTC+8) | Scan: 60s | Backup: 30m");
  console.log("==================================================================\n");

  await waitForDatabase();

  const isOnce = process.argv.includes("--once");

  if (!isOnce) {
    await startPublicTunnel({ dbClient: db }).catch((err) =>
      console.warn("[Worker] Public tunnel init warning:", err.message)
    );
  }

  try {
    await performOverdueScan();
    await checkAndTriggerScheduledReport();
    await performScheduledBackup("startup");
  } catch (err) {
    console.error("[Worker] Error during initial scan/backup:", err.message);
  }

  if (isOnce) {
    console.log("[Worker] One-shot scan & startup backup completed. Exiting.");
    await db.$disconnect();
    process.exit(0);
  }

  setInterval(async () => {
    try {
      await performOverdueScan();
      await checkAndTriggerScheduledReport();
    } catch (err) {
      console.error("[Worker] Error during periodic scan cycle:", err.message);
    }
  }, SCAN_INTERVAL_MS);

  setInterval(async () => {
    await performScheduledBackup("scheduled-30m");
  }, BACKUP_INTERVAL_MS);
}

main().catch(async (e) => {
  console.error("[Worker] Fatal error:", e.message);
  await db.$disconnect();
  process.exit(1);
});
