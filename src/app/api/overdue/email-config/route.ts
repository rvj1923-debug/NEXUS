import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  sendEmail,
  sendOverdueNotificationEmail,
  ensurePublicTunnelUrl,
  readActiveTunnelUrlFromDisk,
  resolveNetworkAppUrl,
} from "@/lib/notifications/email";
import { formatManilaDateTime } from "@/lib/custody/timezone";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let liveTunnel = readActiveTunnelUrlFromDisk();
  if (!liveTunnel) {
    void ensurePublicTunnelUrl();
  }

  const settings = await db.systemSetting.findMany({
    where: {
      settingKey: {
        in: [
          "SMTP_HOST",
          "SMTP_PORT",
          "SMTP_USER",
          "SMTP_PASS",
          "SMTP_FROM",
          "HR_DEPARTMENT_EMAIL",
          "APP_URL",
          "PUBLIC_APP_URL",
          "PUBLIC_TUNNEL_URL",
        ],
      },
    },
  });

  const map = Object.fromEntries(settings.map((s) => [s.settingKey, s.settingValue]));

  const smtpHost = map.SMTP_HOST || process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = map.SMTP_PORT || process.env.SMTP_PORT || "587";
  const smtpUser = map.SMTP_USER || process.env.SMTP_USER || "";
  const smtpPass = map.SMTP_PASS || process.env.SMTP_PASS || "";
  const smtpFrom = map.SMTP_FROM || process.env.SMTP_FROM || smtpUser || "";
  const hrEmail = map.HR_DEPARTMENT_EMAIL || process.env.HR_DEPARTMENT_EMAIL || "hr@company.com";
  liveTunnel = readActiveTunnelUrlFromDisk();
  const activeAppUrl = resolveNetworkAppUrl(
    map.PUBLIC_APP_URL || liveTunnel || map.APP_URL || map.PUBLIC_TUNNEL_URL
  );

  return NextResponse.json({
    smtpHost,
    smtpPort,
    smtpUser,
    hasPassword: Boolean(smtpPass),
    smtpFrom,
    hrEmail,
    activeAppUrl,
    publicTunnelUrl: liveTunnel,
    isConfigured: Boolean(smtpHost && smtpUser && smtpPass),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      action,
      smtpHost = "smtp.gmail.com",
      smtpPort = "587",
      smtpUser = "",
      smtpPass = "",
      smtpFrom = "",
      hrEmail = "hr@company.com",
      caseId,
    } = body;

    // Action: Resend supervisor email for a specific overdue case
    if (action === "RESEND_SUPERVISOR" && caseId) {
      const overdueCase = await db.overdueCase.findUnique({
        where: { id: caseId },
        include: {
          employee: { include: { department: true, supervisor: true, nfcCards: true } },
          phoneAsset: true,
          custodyTransaction: { include: { nfcCard: true } },
        },
      });

      if (!overdueCase) {
        return NextResponse.json({ error: "Overdue case not found." }, { status: 404 });
      }

      const recipientEmail =
        body.supervisorEmail?.trim() ||
        overdueCase.employee?.supervisorEmail ||
        overdueCase.employee?.department?.supervisorEmail ||
        overdueCase.supervisorEmail ||
        overdueCase.employee?.supervisor?.email;

      if (!recipientEmail) {
        return NextResponse.json(
          { error: "No supervisor email configured for this employee/department." },
          { status: 400 }
        );
      }

      const supervisorName =
        overdueCase.employee?.supervisorName ||
        overdueCase.employee?.department?.supervisorName ||
        (overdueCase.employee?.supervisor
          ? `${overdueCase.employee.supervisor.firstName} ${overdueCase.employee.supervisor.lastName}`.trim()
          : `${overdueCase.employee?.department?.name || "Department"} Supervisor`);

      const employeeName = overdueCase.employee
        ? `${overdueCase.employee.firstName} ${overdueCase.employee.lastName}`.trim()
        : "Unassigned Card Holder";
      const employeeCode = overdueCase.employee?.employeeCode || "N/A";
      const departmentName = overdueCase.employee?.department?.name || "Operations";
      const assetTag =
        overdueCase.phoneAsset?.assetTag ||
        overdueCase.custodyTransaction?.nfcCard?.cardNumber ||
        overdueCase.custodyTransaction?.nfcCard?.cardUid ||
        "COMPANY-PHONE";
      const phoneModel = overdueCase.phoneAsset
        ? `${overdueCase.phoneAsset.brand} ${overdueCase.phoneAsset.model}`
        : "Company Issued Phone";

      const txTimestamp = overdueCase.custodyTransaction?.timestamp
        ? new Date(overdueCase.custodyTransaction.timestamp)
        : new Date(overdueCase.detectedAt);
      const deadlineDate = overdueCase.custodyTransaction?.returnDeadlineAt
        ? new Date(overdueCase.custodyTransaction.returnDeadlineAt)
        : new Date(txTimestamp.getTime() + 24 * 60 * 60 * 1000);
      const elapsedMs = Date.now() - txTimestamp.getTime();
      const hoursElapsed = Math.max(24, Math.floor(elapsedMs / (60 * 60 * 1000)));

      const reqProto =
        req.headers.get("x-forwarded-proto") ||
        (req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "http");
      const reqHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();
      const requestAppUrl =
        reqHost &&
        !reqHost.includes("localhost") &&
        !reqHost.includes("127.0.0.1") &&
        !reqHost.includes("0.0.0.0")
          ? `${reqProto}://${reqHost}`
          : undefined;

      const emailResult = await sendOverdueNotificationEmail({
        to: recipientEmail,
        recipientRole: "DEPT_SUPERVISOR",
        supervisorName,
        employeeName,
        employeeCode,
        departmentName,
        assetTag,
        phoneModel,
        minutesOverdue: overdueCase.minutesOverdue || 60,
        hoursElapsed,
        timedInAt: formatManilaDateTime(txTimestamp),
        expectedReturn: formatManilaDateTime(deadlineDate),
        caseNumber: overdueCase.caseNumber,
        caseId: overdueCase.id,
        appUrl: requestAppUrl,
      });

      await db.overdueCase.update({
        where: { id: overdueCase.id },
        data: {
          supervisorEmail: recipientEmail,
          supervisorNotifiedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: emailResult.success,
        simulated: emailResult.simulated,
        recipientEmail,
        error: emailResult.error,
      });
    }

    // Save SMTP configuration to SystemSetting table
    const cleanHost = smtpHost.trim() || "smtp.gmail.com";
    const cleanPort = String(smtpPort).trim() || "587";
    const cleanUser = smtpUser.trim();
    const cleanPass = smtpPass.replace(/\s+/g, ""); // Strip spaces from 16-char Gmail App Passwords
    const cleanFrom = smtpFrom.trim() || (cleanUser ? `NEXUS Tracker <${cleanUser}>` : "NEXUS <alerts@nexus.local>");
    const cleanHrEmail = hrEmail.trim().toLowerCase() || "hr@company.com";

    const entries: Array<{ key: string; val: string; desc: string }> = [
      { key: "SMTP_HOST", val: cleanHost, desc: "SMTP Server Hostname" },
      { key: "SMTP_PORT", val: cleanPort, desc: "SMTP Server Port" },
      { key: "SMTP_USER", val: cleanUser, desc: "SMTP Username / Sender Email" },
      { key: "SMTP_FROM", val: cleanFrom, desc: "SMTP From Display Address" },
      { key: "HR_DEPARTMENT_EMAIL", val: cleanHrEmail, desc: "HR Department Recipient Email" },
    ];

    if (cleanPass) {
      entries.push({ key: "SMTP_PASS", val: cleanPass, desc: "SMTP App Password" });
    }

    for (const item of entries) {
      await db.systemSetting.upsert({
        where: { settingKey: item.key },
        update: { settingValue: item.val },
        create: {
          settingKey: item.key,
          settingValue: item.val,
          category: "NOTIFICATIONS",
          description: item.desc,
        },
      });
    }

    // Update process.env in memory immediately
    process.env.SMTP_HOST = cleanHost;
    process.env.SMTP_PORT = cleanPort;
    process.env.SMTP_USER = cleanUser;
    if (cleanPass) {
      process.env.SMTP_PASS = cleanPass;
    }
    process.env.SMTP_FROM = cleanFrom;
    process.env.HR_DEPARTMENT_EMAIL = cleanHrEmail;

    // Sync open OverdueCase records to reflect the configured HR email
    if (cleanHrEmail) {
      await db.overdueCase
        .updateMany({
          where: { overtimeApprovalStatus: "PENDING" },
          data: { hrEmail: cleanHrEmail },
        })
        .catch(() => null);
    }

    // Optional: send a live test email if requested
    if (action === "SAVE_AND_TEST" && cleanUser) {
      const testRecipient = body.testRecipient?.trim() || cleanUser;
      const testRes = await sendEmail({
        to: testRecipient,
        subject: "[NEXUS] SMTP Email Configuration Verified",
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h2 style="color: #059669; margin-top: 0;">✅ NEXUS Email Delivery Active</h2>
          <p>Your SMTP email configuration is working properly. 24-Hour Overdue Phone Reports to Department Supervisors and Overtime Approval Forms to HR will now be delivered directly to real email inboxes.</p>
          <p style="font-size: 12px; color: #64748b;">Sender: ${cleanFrom} | HR Default Recipient: ${cleanHrEmail}</p>
        </div>`,
      });

      if (!testRes.success) {
        return NextResponse.json(
          {
            error: `SMTP settings saved, but test email failed: ${testRes.error}. If using Gmail, make sure you use a 16-character Google App Password (not your regular Gmail login password).`,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        simulated: testRes.simulated,
        message: `SMTP configured and test email delivered to ${testRecipient}!`,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Email & HR SMTP settings saved successfully.",
    });
  } catch (err: any) {
    console.error("[POST /api/overdue/email-config] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to save email configuration." },
      { status: 500 }
    );
  }
}
