import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { CustodyError } from "@/lib/custody/engine";
import { formatManilaDateTime } from "@/lib/custody/timezone";
import { createNotification } from "@/lib/notifications/service";
import {
  sendOverdueNotificationEmail,
  sendHrOvertimeDecisionEmail,
} from "@/lib/notifications/email";
import { recordAuditLog } from "@/lib/audit";

export const OVERDUE_THRESHOLD_HOURS = 24;
export const OVERDUE_THRESHOLD_MS = OVERDUE_THRESHOLD_HOURS * 60 * 60 * 1000;
export const DEFAULT_HR_EMAIL = process.env.HR_DEPARTMENT_EMAIL || "hr@company.com";

export async function resolveConfiguredHrEmail(): Promise<string> {
  try {
    const settings = await db.systemSetting.findMany({
      where: {
        settingKey: { in: ["HR_DEPARTMENT_EMAIL", "SMTP_USER"] },
      },
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
    if (map.HR_DEPARTMENT_EMAIL) {
      return map.HR_DEPARTMENT_EMAIL;
    }
    if (map.SMTP_USER) {
      return map.SMTP_USER;
    }
  } catch {
    // Fallback to process.env if db is unavailable
  }
  return DEFAULT_HR_EMAIL;
}

export interface HrIncidentMetaRecord {
  caseId: string;
  incidentReportStatus: "PENDING_SUPERVISOR" | "NO_NEED_TO_SERVE" | "OPEN" | "CLOSED";
  proofImageUrl?: string | null;
  hrOfficerName?: string | null;
  hrEmail?: string | null;
  hrUpdatedAt?: string | null;
  hrRemarks?: string | null;
}

function getHrIncidentStorePath(): string {
  const baseDataDir = path.resolve(process.cwd(), process.env.DATA_DIR || "data");
  return path.join(baseDataDir, "hr-incident-reports.json");
}

function readHrIncidentStore(): Record<string, HrIncidentMetaRecord> {
  try {
    const storePath = getHrIncidentStorePath();
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, "utf-8");
      return JSON.parse(raw) || {};
    }
  } catch {
    // ignore
  }
  return {};
}

function writeHrIncidentStore(store: Record<string, HrIncidentMetaRecord>) {
  try {
    const storePath = getHrIncidentStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[writeHrIncidentStore] Failed to persist HR incident metadata:", err);
  }
}

function saveServedProofImage(caseId: string, proofImageInput: string): string {
  // If it's a base64 data URL, save it to UPLOAD_DIR/incident-proofs/ (or public/uploads/incident-proofs/) and return the public URL (and keep fallback)
  if (proofImageInput.startsWith("data:image/")) {
    try {
      const matches = proofImageInput.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const baseUploadDir = path.resolve(
          process.cwd(),
          process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join("public", "uploads")
        );
        const uploadDir = path.join(baseUploadDir, "incident-proofs");
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const fileName = `served-proof-${caseId}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, buffer);
        return `/uploads/incident-proofs/${fileName}`;
      }
    } catch (err) {
      console.error("[saveServedProofImage] Error writing image file, falling back to dataUrl:", err);
    }
  }
  return proofImageInput;
}

export interface ScanResult {
  scannedCount: number;
  newlyOverdueCount: number;
  activeOverdueCount: number;
  cases: any[];
}

/**
 * Resolves the Department Supervisor(s)' email(s) and name(s) for a given employee/department.
 * Supports up to 2 supervisors per department/employee so both are contacted simultaneously.
 */
export async function resolveDepartmentSupervisorContact(employee: any): Promise<{
  supervisorEmail: string;
  supervisorName: string;
  supervisorUserId: string | null;
}> {
  const deptName = employee?.department?.name || "Operations";

  const rawEmails = [
    employee?.supervisorEmail || "",
    employee?.department?.supervisorEmail || "",
  ]
    .flatMap((v) => String(v).split(/[,;]+/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const uniqueEmails = Array.from(new Set(rawEmails)).slice(0, 2);

  const rawNames = [
    employee?.supervisorName || "",
    employee?.department?.supervisorName || "",
  ]
    .flatMap((v) => String(v).split(/\s*(?:\/|;|,|\s&\s)\s*/))
    .map((n) => n.trim())
    .filter(Boolean);
  const uniqueNames: string[] = [];
  for (const name of rawNames) {
    if (!uniqueNames.some((u) => u.toLowerCase() === name.toLowerCase())) {
      uniqueNames.push(name);
    }
  }

  // 1 & 2. Direct supervisor email(s) configured on Employee and/or Department
  if (uniqueEmails.length > 0) {
    return {
      supervisorEmail: uniqueEmails.join(", "),
      supervisorName:
        uniqueNames.slice(0, 2).join(" / ") ||
        (employee?.supervisor
          ? `${employee.supervisor.firstName} ${employee.supervisor.lastName}`.trim()
          : `${deptName} Supervisor`),
      supervisorUserId: employee?.department?.supervisorId || null,
    };
  }

  // 3. Linked supervisor employee record
  if (employee?.supervisor?.email) {
    return {
      supervisorEmail: employee.supervisor.email,
      supervisorName: `${employee.supervisor.firstName} ${employee.supervisor.lastName}`.trim(),
      supervisorUserId: null,
    };
  }

  // 4. Find User(s) in the same department with role DEPT_SUPERVISOR
  if (employee?.departmentId) {
    const deptSupervisorUsers = await db.user.findMany({
      where: {
        departmentId: employee.departmentId,
        isActive: true,
        userRoles: {
          some: { role: { code: "DEPT_SUPERVISOR" } },
        },
      },
      take: 2,
    });
    if (deptSupervisorUsers.length > 0) {
      return {
        supervisorEmail: deptSupervisorUsers.map((u) => u.email).join(", "),
        supervisorName: deptSupervisorUsers.map((u) => u.fullName).join(" / "),
        supervisorUserId: deptSupervisorUsers[0].id,
      };
    }
  }

  // 5. Fallback to any active DEPT_SUPERVISOR user
  const fallbackSupervisor = await db.user.findFirst({
    where: {
      isActive: true,
      userRoles: {
        some: { role: { code: "DEPT_SUPERVISOR" } },
      },
    },
  });

  if (fallbackSupervisor) {
    return {
      supervisorEmail: fallbackSupervisor.email,
      supervisorName: fallbackSupervisor.fullName,
      supervisorUserId: fallbackSupervisor.id,
    };
  }

  return {
    supervisorEmail: "supervisor@company.com",
    supervisorName: `${deptName} Supervisor`,
    supervisorUserId: null,
  };
}

/**
 * Evaluates all open custody transactions against the 24-hour return rule.
 * Once the system detects an overdue phone (>24h), it reports/issues a notice to the
 * Department Supervisor to explain why the phone was overdue and choose whether to
 * Approve or Disapprove the overdue phone incident before sending it to HR.
 */
export async function scanAndProcessOverdueCases(): Promise<ScanResult> {
  const now = new Date();
  const configuredHrEmail = await resolveConfiguredHrEmail();

  // 1. Fetch all open custody transactions (not yet timed out or surrendered)
  const openTransactions = await db.custodyTransaction.findMany({
    where: {
      actualReturnAt: null,
      status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
      transactionType: { in: ["ISSUANCE", "TIME_IN"] },
    },
    include: {
      employee: {
        include: { department: true, supervisor: true },
      },
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
  const processedCases: any[] = [];

  for (const tx of openTransactions) {
    const deadline = tx.returnDeadline;
    if (deadline?.isExempt) {
      continue;
    }

    const phoneAsset = tx.phoneAsset || tx.nfcCard?.phoneAsset || null;
    const employee = tx.employee || tx.nfcCard?.employee || null;
    const phoneAssetId = tx.phoneAssetId || phoneAsset?.id || null;
    const employeeId = tx.employeeId || employee?.id || null;

    // 24-hour deadline from Time In / Issuance timestamp (or extendedReturnAt if extended beyond 24h)
    const twentyFourHourMark = new Date(new Date(tx.timestamp).getTime() + OVERDUE_THRESHOLD_MS);
    const effectiveDeadline =
      deadline?.extendedReturnAt && deadline.extendedReturnAt.getTime() > twentyFourHourMark.getTime()
        ? deadline.extendedReturnAt
        : twentyFourHourMark;

    // Only report overdue after 24 hours of not being timed out or surrendered
    if (now.getTime() >= effectiveDeadline.getTime()) {
      const minutesOverdue = Math.max(
        1,
        Math.floor((now.getTime() - effectiveDeadline.getTime()) / (60 * 1000))
      );
      const totalHoursElapsed = Math.max(
        24,
        Math.floor((now.getTime() - new Date(tx.timestamp).getTime()) / (60 * 60 * 1000))
      );

      let overdueCase = tx.overdueCases[0] || null;

      // If an overdue case already exists and was APPROVED by the supervisor or RESOLVED/CLOSED, skip it
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
        // Double-check DB directly to prevent race-condition duplicates
        const existingForTx = await db.overdueCase.findFirst({
          where: { custodyTransactionId: tx.id },
          orderBy: { detectedAt: "desc" },
        });
        if (existingForTx) {
          if (
            existingForTx.status === "RESOLVED" ||
            existingForTx.overtimeApprovalStatus === "APPROVED"
          ) {
            continue;
          }
          overdueCase = existingForTx;
        }
      }

      if (!overdueCase) {
        const caseNumber = `OVD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(10000 + Math.random() * 90000)}`;

        const supervisorContact = await resolveDepartmentSupervisorContact(employee);

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
            supervisorEmail: supervisorContact.supervisorEmail,
            supervisorNotifiedAt: now,
            overtimeApprovalStatus: "PENDING",
            hrEmail: configuredHrEmail,
            acknowledgedNotes: "[PENDING_SUPERVISOR_REVIEW]",
          },
        });

        newlyOverdueCount++;

        // Record initial state in HR Incident Store as PENDING_SUPERVISOR
        const store = readHrIncidentStore();
        store[overdueCase.id] = {
          caseId: overdueCase.id,
          incidentReportStatus: "PENDING_SUPERVISOR",
        };
        writeHrIncidentStore(store);

        // Update CustodyTransaction to OVERDUE
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
              details: `Device unreturned after 24 hours (${totalHoursElapsed}h elapsed). Overdue notice ${caseNumber} issued to Department Supervisor (${supervisorContact.supervisorEmail}).`,
            },
          });
        }

        const empFullName = employee
          ? `${employee.firstName} ${employee.lastName}`.trim()
          : "Assigned Employee";
        const empCode = employee?.employeeCode || "N/A";
        const deptName = employee?.department?.name || "Operations";
        const assetTag = phoneAsset?.assetTag || tx.nfcCard?.cardNumber || tx.nfcCard?.cardUid || "Company Phone";
        const phoneModel = phoneAsset ? `${phoneAsset.brand || ""} ${phoneAsset.model || ""}`.trim() : assetTag;

        // Create In-App Notification for Department Supervisor with direct link to Supervisor Form
        await createNotification({
          recipientUserId: supervisorContact.supervisorUserId,
          recipientRoleCode: "DEPT_SUPERVISOR",
          title: `24-Hour Overdue Phone Notice — Supervisor Review Required (${assetTag})`,
          message: `${empFullName} (${deptName}) has not timed out or surrendered ${assetTag} after 24 hours. Please explain why the phone was overdue and Approve or Disapprove the incident to forward to HR.`,
          type: "URGENT",
          severity: "HIGH",
          linkUrl: `/overdue?reviewCaseId=${overdueCase.id}`,
          employeeId,
          phoneAssetId,
          overdueCaseId: overdueCase.id,
        });

        // Issue email notice to Department Supervisor requesting explanation + Approve/Disapprove
        await sendOverdueNotificationEmail({
          to: supervisorContact.supervisorEmail,
          recipientRole: "Department Supervisor",
          supervisorName: supervisorContact.supervisorName,
          employeeName: empFullName,
          employeeCode: empCode,
          departmentName: deptName,
          assetTag,
          phoneModel,
          minutesOverdue,
          hoursElapsed: totalHoursElapsed,
          timedInAt: formatManilaDateTime(tx.timestamp),
          expectedReturn: formatManilaDateTime(effectiveDeadline),
          caseNumber,
          caseId: overdueCase.id,
        }).catch((err) => console.error("Supervisor email notification error:", err));
      } else {
        // Update elapsed overdue minutes on existing open case
        overdueCase = await db.overdueCase.update({
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
          data: {
            status: "OVERDUE",
            overdueMinutes: minutesOverdue,
          },
        });
      }

      processedCases.push(overdueCase);
    }
  }

  const activeOverdueCount = await db.overdueCase.count({
    where: { status: { in: ["OPEN", "ESCALATED"] } },
  });

  return {
    scannedCount: openTransactions.length,
    newlyOverdueCount,
    activeOverdueCount,
    cases: processedCases,
  };
}

/**
 * Submits the Department Supervisor's explanation of why the phone was overdue
 * and their choice to APPROVE or DISAPPROVE the overdue phone incident, then sends it to HR.
 * - If APPROVED: No need to serve the Incident Report (incidentReportStatus = "NO_NEED_TO_SERVE").
 * - If DISAPPROVED (NOT_APPROVED): Incident Report is OPEN (incidentReportStatus = "OPEN") and HR must print & serve it with photo proof to close.
 */
export async function submitSupervisorOvertimeForm(params: {
  caseId: string;
  userId?: string | null;
  decision: "APPROVED" | "NOT_APPROVED";
  supervisorName?: string;
  supervisorEmail?: string;
  supervisorRemarks: string;
  hrEmail?: string;
}) {
  const {
    caseId,
    userId,
    decision,
    supervisorRemarks,
  } = params;

  if (!supervisorRemarks || supervisorRemarks.trim().length < 5) {
    throw new CustodyError(
      "Please fill out the text box explaining why the phone was overdue (at least 5 characters).",
      400
    );
  }

  const cleanRef = caseId.replace(/^INC-/i, "");
  const existing = await db.overdueCase.findFirst({
    where: {
      OR: [{ id: caseId }, { caseNumber: caseId }, { caseNumber: cleanRef }],
    },
    include: {
      employee: { include: { department: true, supervisor: true } },
      phoneAsset: true,
      custodyTransaction: { include: { nfcCard: true } },
    },
  });

  if (!existing) {
    throw new CustodyError("Overdue case not found.", 404);
  }

  const supContact = await resolveDepartmentSupervisorContact(existing.employee);
  const configuredHrEmail = await resolveConfiguredHrEmail();

  const supervisorName =
    (params.supervisorName && params.supervisorName.trim().length >= 2
      ? params.supervisorName.trim()
      : "") ||
    existing.supervisorReviewedBy ||
    supContact.supervisorName ||
    `${existing.employee?.department?.name || "Department"} Supervisor`;

  const supervisorEmail =
    (params.supervisorEmail && params.supervisorEmail.includes("@")
      ? params.supervisorEmail.trim()
      : "") ||
    existing.supervisorEmail ||
    supContact.supervisorEmail ||
    "supervisor@company.com";

  // Always prefer the HR Department email configured in the SMTP settings (SystemSetting.HR_DEPARTMENT_EMAIL)
  const hrEmail =
    (configuredHrEmail && configuredHrEmail.toLowerCase() !== "hr@company.com"
      ? configuredHrEmail
      : "") ||
    (params.hrEmail &&
    params.hrEmail.includes("@") &&
    params.hrEmail.trim().toLowerCase() !== "hr@company.com"
      ? params.hrEmail.trim()
      : "") ||
    (existing.hrEmail &&
    existing.hrEmail.includes("@") &&
    existing.hrEmail.trim().toLowerCase() !== "hr@company.com"
      ? existing.hrEmail.trim()
      : "") ||
    configuredHrEmail ||
    DEFAULT_HR_EMAIL;

  const now = new Date();
  const empName = existing.employee
    ? `${existing.employee.firstName} ${existing.employee.lastName}`.trim()
    : "Assigned Employee";
  const empCode = existing.employee?.employeeCode || "N/A";
  const deptName = existing.employee?.department?.name || "Operations";
  const assetTag =
    existing.phoneAsset?.assetTag ||
    existing.custodyTransaction?.nfcCard?.cardNumber ||
    existing.custodyTransaction?.nfcCard?.cardUid ||
    "Company Phone";
  const phoneModel = existing.phoneAsset
    ? `${existing.phoneAsset.brand || ""} ${existing.phoneAsset.model || ""}`.trim()
    : "";
  const imei = existing.phoneAsset?.imei || "N/A";

  const twentyFourHourDeadline =
    existing.custodyTransaction?.returnDeadlineAt ||
    new Date(new Date(existing.custodyTransaction.timestamp).getTime() + OVERDUE_THRESHOLD_MS);

  // 1. Send email report to HR Department (with Print Incident Report + Direct Admin Overdue Reports Tab access)
  const emailResult = await sendHrOvertimeDecisionEmail({
    to: hrEmail.trim(),
    caseId: existing.id,
    caseNumber: existing.caseNumber,
    employeeName: empName,
    employeeCode: empCode,
    departmentName: deptName,
    assetTag,
    phoneModel,
    imei,
    timedInAt: formatManilaDateTime(existing.custodyTransaction?.timestamp),
    deadlineAt: formatManilaDateTime(twentyFourHourDeadline),
    minutesOverdue: existing.minutesOverdue,
    decision,
    supervisorName: supervisorName.trim(),
    supervisorEmail: supervisorEmail.trim(),
    supervisorRemarks: supervisorRemarks.trim(),
    reviewedAt: formatManilaDateTime(now),
  });

  // 2. Determine Incident Report & Case status based on Supervisor's Approve vs Disapprove choice:
  // - APPROVED: Case is AUTOMATICALLY CLOSED (status = "RESOLVED") and no need for printing or serving an Incident Report.
  // - NOT_APPROVED (Disapproved): Case & Incident Report remain OPEN and HR must print & serve it with photo proof to close.
  const isApproved = decision === "APPROVED";
  const incidentStatusTag = isApproved
    ? "[INCIDENT_REPORT_NO_NEED_TO_SERVE]"
    : "[INCIDENT_REPORT_OPEN]";
  const resolutionType = isApproved ? "OVERTIME_APPROVED" : "OVERTIME_NOT_APPROVED";

  const store = readHrIncidentStore();
  store[existing.id] = {
    caseId: existing.id,
    incidentReportStatus: isApproved ? "NO_NEED_TO_SERVE" : "OPEN",
    proofImageUrl: store[existing.id]?.proofImageUrl || null,
    hrOfficerName: isApproved ? `Auto-Closed (Supervisor ${supervisorName.trim()} Approved)` : null,
    hrEmail: hrEmail.trim(),
    hrUpdatedAt: formatManilaDateTime(now),
    hrRemarks: isApproved
      ? "Supervisor approved overdue report — Case automatically closed; no need for printing or serving of the report."
      : "Supervisor disapproved overdue phone — Incident Report is OPEN and must be printed & served to employee.",
  };
  writeHrIncidentStore(store);

  const updatedCase = await db.overdueCase.update({
    where: { id: existing.id },
    data: {
      status: isApproved ? "RESOLVED" : "OPEN",
      resolvedAt: isApproved ? now : null,
      overtimeApprovalStatus: decision,
      supervisorReviewedBy: supervisorName.trim(),
      supervisorEmail: supervisorEmail.trim(),
      supervisorReviewedAt: now,
      supervisorRemarks: supervisorRemarks.trim(),
      hrEmail: hrEmail.trim(),
      hrEmailSentAt: now,
      acknowledgedAt: now,
      acknowledgedByUserId: userId || null,
      acknowledgedNotes: `${incidentStatusTag} [Supervisor Decision: ${decision}] Reason Overdue: ${supervisorRemarks.trim()}`,
      resolutionType,
      resolutionNotes: isApproved
        ? `[AUTOMATICALLY CLOSED — NO NEED TO PRINT OR SERVE REPORT] Supervisor ${supervisorName.trim()} APPROVED the overdue phone incident. Case automatically closed. Sent to HR (${hrEmail.trim()}). Reason: ${supervisorRemarks.trim()}`
        : `[INCIDENT REPORT OPEN — TO BE PRINTED & SERVED] Supervisor ${supervisorName.trim()} DISAPPROVED the overdue phone incident. Sent to HR (${hrEmail.trim()}). Reason: ${supervisorRemarks.trim()}`,
    },
    include: {
      employee: { include: { department: true } },
      phoneAsset: true,
      custodyTransaction: true,
    },
  });

  // 2b. Sync Incident record in DB
  try {
    const existingIncident = await db.incident.findFirst({
      where: {
        custodyTransactionId: existing.custodyTransactionId,
        incidentType: "OVERDUE_PHONE",
      },
    });

    if (!isApproved) {
      // Disapproved -> Ensure Incident Report is REPORTED (OPEN)
      if (!existingIncident) {
        const reporterUser =
          (userId ? await db.user.findUnique({ where: { id: userId } }) : null) ||
          (await db.user.findFirst({ where: { isActive: true } }));

        if (reporterUser) {
          const incNumber = `INC-OVD-${existing.caseNumber.replace("OVD-", "")}`;
          await db.incident.create({
            data: {
              incidentNumber: incNumber,
              phoneAssetId: existing.phoneAssetId,
              employeeId: existing.employeeId,
              reportedByUserId: reporterUser.id,
              custodyTransactionId: existing.custodyTransactionId,
              incidentType: "OVERDUE_PHONE",
              severity: "HIGH",
              description: `INCIDENT REPORT OPEN (Disapproved by Supervisor ${supervisorName.trim()}) — Overdue Phone (${assetTag}) for ${empName} (${empCode}). Reason: ${supervisorRemarks.trim()}`,
              status: "REPORTED",
            },
          }).catch(() => null);
        }
      } else {
        await db.incident.update({
          where: { id: existingIncident.id },
          data: {
            status: "REPORTED",
            description: `INCIDENT REPORT OPEN (Disapproved by Supervisor ${supervisorName.trim()}) — Overdue Phone (${assetTag}) for ${empName} (${empCode}). Reason: ${supervisorRemarks.trim()}`,
          },
        }).catch(() => null);
      }
    } else if (existingIncident && existingIncident.status !== "CLOSED") {
      // Approved -> Automatically close any open incident
      await db.incident.update({
        where: { id: existingIncident.id },
        data: { status: "CLOSED" },
      }).catch(() => null);
    }
  } catch {
    // Non-blocking
  }

  // 3. Log Escalation / Dispatch entry for audit trail
  await db.overdueEscalation.create({
    data: {
      overdueCaseId: existing.id,
      escalationTier: 0,
      channel: "EMAIL",
      recipientRole: "HR_DEPARTMENT",
      recipientEmail: hrEmail.trim(),
      message: isApproved
        ? `Supervisor ${supervisorName.trim()} APPROVED overdue phone (${assetTag}). Overdue case automatically closed — no need for printing or serving of the report. Emailed to HR (${hrEmail.trim()}).`
        : `Supervisor ${supervisorName.trim()} DISAPPROVED overdue phone (${assetTag}). Incident Report is OPEN (must be printed & served by HR with photo proof). Emailed to HR (${hrEmail.trim()}).`,
      status: emailResult.success ? "SENT" : "FAILED",
      failureReason: emailResult.error || null,
    },
  });

  // 4. Create In-App Notification confirming HR report dispatch
  await createNotification({
    recipientRoleCode: "SYSTEM_ADMIN",
    title: isApproved
      ? `Overdue Approved by Supervisor — Case Automatically Closed: ${assetTag}`
      : `Overdue DISAPPROVED — Incident Report Open for HR to Print & Serve: ${assetTag}`,
    message: isApproved
      ? `Supervisor ${supervisorName.trim()} APPROVED the overdue phone for ${empName} (${assetTag}). The overdue case is automatically closed and does not need printing or serving of the report.`
      : `Supervisor ${supervisorName.trim()} DISAPPROVED the overdue phone for ${empName} (${assetTag}). HR must print & serve the Incident Report and upload a proof photo to close it.`,
    type: isApproved ? "INFO" : "ALERT",
    severity: isApproved ? "LOW" : "HIGH",
    linkUrl: `/overdue?hrCaseId=${existing.id}`,
    employeeId: existing.employeeId,
    phoneAssetId: existing.phoneAssetId,
    overdueCaseId: existing.id,
  });

  // 5. Audit log
  await recordAuditLog({
    userId: userId || undefined,
    action: "SUPERVISOR_OVERTIME_FORM_SUBMITTED",
    entityType: "OVERDUE_CASE",
    entityId: existing.id,
    changes: {
      caseNumber: existing.caseNumber,
      employeeName: empName,
      assetTag,
      decision,
      caseStatus: isApproved ? "RESOLVED" : "OPEN",
      incidentReportStatus: isApproved ? "NO_NEED_TO_SERVE" : "OPEN",
      supervisorName: supervisorName.trim(),
      supervisorEmail: supervisorEmail.trim(),
      hrEmail: hrEmail.trim(),
      supervisorRemarks: supervisorRemarks.trim(),
      emailSimulated: emailResult.simulated,
    },
  });

  return {
    success: true,
    message: isApproved
      ? `Supervisor APPROVED overdue report. The case (${existing.caseNumber}) has been automatically closed — no need for printing or serving of the report. Notification sent to HR (${hrEmail.trim()}).`
      : `Supervisor DISAPPROVED overdue report. Incident Report is now OPEN and sent to HR (${hrEmail.trim()}) for printing & serving.`,
    case: updatedCase,
    emailResult,
  };
}

/**
 * Helper to check whether an OverdueCase currently has an OPEN Incident Report that needs to be served by HR.
 */
export function isIncidentReportIssued(c: {
  id?: string;
  status?: string | null;
  overtimeApprovalStatus?: string | null;
  hrEmailSentAt?: Date | string | null;
  acknowledgedNotes?: string | null;
  resolutionType?: string | null;
}): boolean {
  if (!c) return false;
  const info = getHrIncidentStatus(c);
  return info.incidentReportStatus === "OPEN";
}

/**
 * Extracts structured HR Incident Report status, whether serving a report is required,
 * and proof picture metadata from an OverdueCase.
 */
export function getHrIncidentStatus(c: {
  id?: string;
  status?: string | null;
  overtimeApprovalStatus?: string | null;
  hrEmailSentAt?: Date | string | null;
  acknowledgedAt?: Date | string | null;
  acknowledgedNotes?: string | null;
  resolutionType?: string | null;
  resolutionNotes?: string | null;
}) {
  const store = readHrIncidentStore();
  const stored = c?.id ? store[c.id] : undefined;

  let incidentReportStatus: "PENDING_SUPERVISOR" | "NO_NEED_TO_SERVE" | "OPEN" | "CLOSED" =
    "PENDING_SUPERVISOR";

  if (stored?.incidentReportStatus) {
    incidentReportStatus = stored.incidentReportStatus;
  } else if (
    c?.resolutionType === "INCIDENT_REMOVED_BY_HR" ||
    c?.resolutionType === "INCIDENT_CLOSED_BY_HR" ||
    (c?.acknowledgedNotes && c.acknowledgedNotes.includes("[HR_INCIDENT_REMOVED")) ||
    (c?.acknowledgedNotes && c.acknowledgedNotes.includes("[HR_INCIDENT_CLOSED"))
  ) {
    incidentReportStatus = "CLOSED";
  } else if (
    c?.overtimeApprovalStatus === "APPROVED" ||
    (c?.acknowledgedNotes && c.acknowledgedNotes.includes("[INCIDENT_REPORT_NO_NEED_TO_SERVE]"))
  ) {
    incidentReportStatus = "NO_NEED_TO_SERVE";
  } else if (
    c?.overtimeApprovalStatus === "NOT_APPROVED" ||
    (c?.acknowledgedNotes && c.acknowledgedNotes.includes("[INCIDENT_REPORT_OPEN]")) ||
    (c?.acknowledgedNotes && c.acknowledgedNotes.includes("[INCIDENT_REPORT_ISSUED]"))
  ) {
    incidentReportStatus = "OPEN";
  } else {
    incidentReportStatus = "PENDING_SUPERVISOR";
  }

  const requiresServingReport = c?.overtimeApprovalStatus === "NOT_APPROVED" || incidentReportStatus === "OPEN";
  const issued = incidentReportStatus === "OPEN";
  const removedByHr = incidentReportStatus === "CLOSED";

  const hrClearedBy = stored?.hrOfficerName || (removedByHr ? "HR Department" : null);
  const hrClearedAt = stored?.hrUpdatedAt || null;
  const hrClearanceRemarks = stored?.hrRemarks || null;
  const proofImageUrl = stored?.proofImageUrl || null;

  let incidentStatusLabel = "PENDING SUPERVISOR REVIEW";
  if (incidentReportStatus === "NO_NEED_TO_SERVE") {
    incidentStatusLabel = "APPROVED BY SUPERVISOR — NO NEED TO SERVE REPORT";
  } else if (incidentReportStatus === "OPEN") {
    incidentStatusLabel = "INCIDENT REPORT OPEN (TO BE SERVED BY HR)";
  } else if (incidentReportStatus === "CLOSED") {
    incidentStatusLabel = proofImageUrl
      ? "INCIDENT REPORT CLOSED (SERVED PROOF ATTACHED)"
      : "INCIDENT REPORT CLOSED BY HR";
  }

  return {
    incidentReportStatus,
    requiresServingReport,
    incidentReportIssued: issued,
    incidentRemovedByHr: removedByHr,
    incidentStatusLabel,
    hrClearedBy,
    hrClearedAt,
    hrClearanceRemarks,
    proofImageUrl,
  };
}

/**
 * HR Department Admin Action: Open or Close an Overdue Phone Incident Report.
 * - If closing a DISAPPROVED report (`overtimeApprovalStatus !== "APPROVED"`), HR MUST present a picture (`proofImage`)
 *   proving that they served the Incident Report to the employee.
 * - If the Supervisor APPROVED the overdue report (`overtimeApprovalStatus === "APPROVED"`), no need to serve the report or upload a picture.
 */
export async function removeIncidentReportByHr(params: {
  caseId?: string;
  employeeId?: string;
  userId?: string | null;
  action?: "OPEN" | "CLOSE";
  proofImage?: string | null;
  hrOfficerName?: string;
  hrEmail?: string;
  remarks?: string;
}) {
  const {
    caseId,
    employeeId,
    userId,
    action = "CLOSE",
    proofImage,
    hrOfficerName = "HR Department Admin",
    hrEmail = DEFAULT_HR_EMAIL,
    remarks = "",
  } = params;

  if (!caseId && !employeeId) {
    throw new CustodyError("Either Overdue Case ID or Employee ID is required.", 400);
  }

  const targetCases = await db.overdueCase.findMany({
    where: caseId
      ? { id: caseId }
      : {
          employeeId: employeeId!,
        },
    include: {
      employee: { include: { department: true } },
      phoneAsset: true,
      custodyTransaction: { include: { nfcCard: true } },
    },
    orderBy: { detectedAt: "desc" },
  });

  if (targetCases.length === 0) {
    throw new CustodyError("No overdue case found for the specified record.", 404);
  }

  const now = new Date();
  const formattedNow = formatManilaDateTime(now);
  const cleanOfficer = hrOfficerName.trim() || "HR Department Admin";
  const cleanHrEmail = hrEmail.trim() || DEFAULT_HR_EMAIL;
  const store = readHrIncidentStore();

  const updatedCases = [];

  for (const c of targetCases) {
    const empName = c.employee
      ? `${c.employee.firstName} ${c.employee.lastName}`.trim()
      : "Assigned Employee";
    const assetTag =
      c.phoneAsset?.assetTag ||
      c.custodyTransaction?.nfcCard?.cardNumber ||
      c.custodyTransaction?.nfcCard?.cardUid ||
      "Company Phone";

    const isSupervisorApproved = c.overtimeApprovalStatus === "APPROVED";

    if (action === "CLOSE") {
      // Enforce mandatory served proof picture when Supervisor did NOT approve the overdue report
      const existingProof = store[c.id]?.proofImageUrl || null;
      const providedProof = proofImage && proofImage.trim().length > 10 ? proofImage.trim() : existingProof;

      if (!isSupervisorApproved && !providedProof) {
        throw new CustodyError(
          "Supervisor disapproved this overdue report: You must upload/present a picture proving that the Incident Report was served to the employee before closing the report.",
          400
        );
      }

      const savedProofUrl = providedProof ? saveServedProofImage(c.id, providedProof) : null;
      const cleanRemarks =
        remarks.trim() ||
        (isSupervisorApproved
          ? "Closed by HR (Supervisor approved overdue report — no need to serve incident report)."
          : "Incident Report served to employee and closed by HR with photo proof.");

      store[c.id] = {
        caseId: c.id,
        incidentReportStatus: "CLOSED",
        proofImageUrl: savedProofUrl,
        hrOfficerName: cleanOfficer,
        hrEmail: cleanHrEmail,
        hrUpdatedAt: formattedNow,
        hrRemarks: cleanRemarks,
      };
      writeHrIncidentStore(store);

      const hrTag = `[HR_INCIDENT_CLOSED | by=${cleanOfficer} (${cleanHrEmail}) | at=${formattedNow}] ${cleanRemarks}`;

      const updated = await db.overdueCase.update({
        where: { id: c.id },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
          acknowledgedAt: now,
          acknowledgedByUserId: userId || null,
          acknowledgedNotes: hrTag,
          resolutionType: "INCIDENT_REMOVED_BY_HR",
          resolutionNotes: `${c.resolutionNotes ? c.resolutionNotes + " | " : ""}Incident Report CLOSED by HR (${cleanOfficer}) at ${formattedNow}. Remarks: ${cleanRemarks}`,
        },
        include: {
          employee: { include: { department: true } },
          phoneAsset: true,
          custodyTransaction: true,
        },
      });

      updatedCases.push(updated);

      if (c.employeeId || c.custodyTransactionId) {
        await db.incident.updateMany({
          where: {
            OR: [
              ...(c.custodyTransactionId ? [{ custodyTransactionId: c.custodyTransactionId }] : []),
              ...(c.employeeId ? [{ employeeId: c.employeeId, incidentType: "OVERDUE_PHONE" }] : []),
            ],
            status: { not: "CLOSED" },
          },
          data: { status: "CLOSED" },
        }).catch(() => null);
      }

      await db.overdueEscalation.create({
        data: {
          overdueCaseId: c.id,
          escalationTier: 0,
          channel: "IN_APP",
          recipientRole: "HR_DEPARTMENT",
          recipientEmail: cleanHrEmail,
          message: `HR Department (${cleanOfficer}) CLOSED Incident Report for ${empName} (${assetTag})${savedProofUrl ? " with photo proof of service" : ""}. Remarks: ${cleanRemarks}`,
          status: "DELIVERED",
        },
      });

      await recordAuditLog({
        userId: userId || undefined,
        userEmail: cleanHrEmail,
        userRole: "HR_DEPARTMENT",
        action: "HR_INCIDENT_REPORT_CLOSED",
        entityType: "OVERDUE_CASE",
        entityId: c.id,
        changes: {
          caseNumber: c.caseNumber,
          employeeId: c.employeeId,
          employeeName: empName,
          assetTag,
          newIncidentStatus: "CLOSED",
          proofImageUrl: savedProofUrl,
          hrOfficerName: cleanOfficer,
          hrEmail: cleanHrEmail,
          remarks: cleanRemarks,
        },
      });
    } else {
      // action === "OPEN" -> Open / Re-open the Incident Report
      const cleanRemarks =
        remarks.trim() || "Incident Report opened/re-opened by HR Department to be served to employee.";

      store[c.id] = {
        caseId: c.id,
        incidentReportStatus: "OPEN",
        proofImageUrl: store[c.id]?.proofImageUrl || null,
        hrOfficerName: cleanOfficer,
        hrEmail: cleanHrEmail,
        hrUpdatedAt: formattedNow,
        hrRemarks: cleanRemarks,
      };
      writeHrIncidentStore(store);

      const hrTag = `[INCIDENT_REPORT_OPEN] [Opened by HR=${cleanOfficer} (${cleanHrEmail}) at ${formattedNow}] ${cleanRemarks}`;

      const updated = await db.overdueCase.update({
        where: { id: c.id },
        data: {
          status: "OPEN",
          resolvedAt: null,
          acknowledgedAt: now,
          acknowledgedByUserId: userId || null,
          acknowledgedNotes: hrTag,
          resolutionType: "OVERTIME_NOT_APPROVED",
          resolutionNotes: `${c.resolutionNotes ? c.resolutionNotes + " | " : ""}Incident Report OPENED by HR (${cleanOfficer}) at ${formattedNow}. Remarks: ${cleanRemarks}`,
        },
        include: {
          employee: { include: { department: true } },
          phoneAsset: true,
          custodyTransaction: true,
        },
      });

      updatedCases.push(updated);

      if (c.employeeId || c.custodyTransactionId) {
        await db.incident.updateMany({
          where: {
            OR: [
              ...(c.custodyTransactionId ? [{ custodyTransactionId: c.custodyTransactionId }] : []),
              ...(c.employeeId ? [{ employeeId: c.employeeId, incidentType: "OVERDUE_PHONE" }] : []),
            ],
          },
          data: { status: "REPORTED" },
        }).catch(() => null);
      }

      await recordAuditLog({
        userId: userId || undefined,
        userEmail: cleanHrEmail,
        userRole: "HR_DEPARTMENT",
        action: "HR_INCIDENT_REPORT_OPENED",
        entityType: "OVERDUE_CASE",
        entityId: c.id,
        changes: {
          caseNumber: c.caseNumber,
          employeeId: c.employeeId,
          employeeName: empName,
          assetTag,
          newIncidentStatus: "OPEN",
          hrOfficerName: cleanOfficer,
          hrEmail: cleanHrEmail,
          remarks: cleanRemarks,
        },
      });
    }
  }

  return {
    success: true,
    message:
      action === "OPEN"
        ? `Incident Report is now OPEN for serving by HR (${cleanOfficer}).`
        : `Incident Report has been CLOSED by HR (${cleanOfficer}).`,
    updatedCount: updatedCases.length,
    case: updatedCases[0] || targetCases[0],
  };
}

/**
 * Reconciles and resolves open overdue cases when a device is physically surrendered or timed out
 */
export async function reconcileOverdueOnSurrender(transactionId: string, actualReturnAt = new Date()) {
  const openCases = await db.overdueCase.findMany({
    where: {
      custodyTransactionId: transactionId,
      status: { in: ["OPEN", "ESCALATED"] },
    },
  });

  for (const c of openCases) {
    await db.overdueCase.update({
      where: { id: c.id },
      data: {
        status: "RESOLVED",
        resolvedAt: actualReturnAt,
        resolutionType:
          c.resolutionType === "INCIDENT_REMOVED_BY_HR"
            ? "INCIDENT_REMOVED_BY_HR"
            : c.overtimeApprovalStatus !== "PENDING"
            ? c.resolutionType
            : "SURRENDERED",
        resolutionNotes: c.supervisorRemarks
          ? `${c.resolutionNotes || ""} | Phone physically returned/timed out at ${formatManilaDateTime(actualReturnAt)}.`
          : "Automatically reconciled upon confirmed physical device return / time out.",
      },
    });

    if (c.phoneAssetId && c.employeeId) {
      await db.custodyEvent.create({
        data: {
          transactionId,
          phoneAssetId: c.phoneAssetId,
          employeeId: c.employeeId,
          eventType: "CHECKED_IN",
          details: `Overdue case ${c.caseNumber} reconciled upon device return.`,
        },
      });
    }
  }

  return openCases.length;
}

/**
 * Acknowledges an overdue case with notes without closing physical custody
 */
export async function acknowledgeOverdueCase(params: {
  caseId: string;
  userId: string;
  notes?: string;
}) {
  const { caseId, userId, notes } = params;

  const existing = await db.overdueCase.findUnique({
    where: { id: caseId },
  });

  if (!existing) {
    throw new CustodyError("Overdue case not found.", 404);
  }

  const updated = await db.overdueCase.update({
    where: { id: caseId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId,
      acknowledgedNotes: notes || "Acknowledged by operator.",
    },
  });

  return {
    success: true,
    message: "Case acknowledged successfully. Outstanding custody remains active.",
    case: updated,
  };
}

/**
 * Resolves an overdue case through an approved administrative action
 */
export async function resolveOverdueCase(params: {
  caseId: string;
  userId: string;
  resolutionType: "SURRENDERED" | "REPORTED_LOST" | "EXCUSED" | "ESCALATED_HR";
  resolutionNotes: string;
}) {
  const { caseId, userId, resolutionType, resolutionNotes } = params;

  if (!resolutionNotes || resolutionNotes.trim().length < 5) {
    throw new CustodyError("Detailed resolution notes are required to resolve an overdue case.", 400);
  }

  const existing = await db.overdueCase.findUnique({
    where: { id: caseId },
    include: { phoneAsset: true },
  });

  if (!existing) {
    throw new CustodyError("Overdue case not found.", 404);
  }

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.overdueCase.update({
      where: { id: caseId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolutionType,
        resolutionNotes: resolutionNotes.trim(),
      },
    });

    if (resolutionType === "REPORTED_LOST" && existing.phoneAssetId) {
      await tx.phoneAsset.update({
        where: { id: existing.phoneAssetId },
        data: { operationalStatus: "LOST" },
      });
      await tx.custodyTransaction.update({
        where: { id: existing.custodyTransactionId },
        data: { status: "LOST" },
      });
    }

    return updated;
  });

  return {
    success: true,
    message: `Case ${existing.caseNumber} resolved via ${resolutionType}.`,
    case: result,
  };
}
