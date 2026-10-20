import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";
import { getHrIncidentStatus } from "@/lib/overdue/engine";
import {
  formatSupervisorEmails,
  formatSupervisorNames,
  isValidSupervisorEmailList,
} from "@/lib/supervisors";

const updateEmployeeSchema = z.object({
  employeeCode: z.string().min(2).max(30).optional(),
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phoneNumber: z.string().max(20).optional().nullable().or(z.literal("")),
  departmentId: z.string().uuid().optional().nullable().or(z.literal("")),
  designation: z.string().max(100).optional().nullable().or(z.literal("")),
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  supervisorId: z.string().uuid().optional().nullable().or(z.literal("")),
  supervisorName: z.string().max(240).optional().nullable().or(z.literal("")),
  supervisorEmail: z
    .string()
    .max(320)
    .refine((v) => isValidSupervisorEmailList(v), "Invalid supervisor email address")
    .optional()
    .nullable()
    .or(z.literal("")),
  supervisor2Name: z.string().max(120).optional().nullable().or(z.literal("")),
  supervisor2Email: z
    .string()
    .max(200)
    .refine((v) => isValidSupervisorEmailList(v), "Invalid 2nd supervisor email address")
    .optional()
    .nullable()
    .or(z.literal("")),
  applySupervisorToDepartment: z.boolean().optional(),
  profilePhotoUrl: z.string().url().optional().nullable().or(z.literal("")),
  multiCardAuthorized: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await props.params;

  const employee = await db.employee.findUnique({
    where: { id },
    include: {
      department: true,
      supervisor: { select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true, email: true } },
      subordinates: { select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true } },
      nfcCards: { orderBy: { createdAt: "desc" } },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: {
          phoneAsset: true,
          assignedByUser: { select: { fullName: true, email: true } },
        },
      },
      custodyTransactions: {
        orderBy: { timestamp: "desc" },
        include: {
          phoneAsset: true,
          nfcReader: true,
          returnDeadline: true,
        },
      },
      overdueCases: {
        orderBy: { detectedAt: "desc" },
        include: { phoneAsset: true },
      },
      incidents: {
        orderBy: { createdAt: "desc" },
        include: { phoneAsset: true },
      },
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // Check supervisor department boundary
  if (session.roleCode === "DEPT_SUPERVISOR" && session.departmentId && employee.departmentId !== session.departmentId) {
    return NextResponse.json({ error: "Forbidden: Scoped to your department only" }, { status: 403 });
  }

  const enrichedCases = (employee.overdueCases || []).map((c) => ({
    ...c,
    ...getHrIncidentStatus(c),
  }));
  const activeIncidentCase = enrichedCases.find((c) => c.incidentReportIssued) || null;
  const latestClearedCase =
    !activeIncidentCase
      ? enrichedCases.find((c) => c.incidentRemovedByHr) || null
      : null;

  return NextResponse.json({
    employee: {
      ...employee,
      overdueCases: enrichedCases,
      incidentReportIssued: Boolean(activeIncidentCase),
      activeIncidentCase,
      latestClearedCase,
    },
  });
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "employees:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires employees:manage permission" }, { status: 403 });
  }

  const { id } = await props.params;

  try {
    const body = await request.json();
    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const existing = await db.employee.findUnique({
      where: { id },
      include: { department: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Check duplicate employeeCode if being updated
    if (data.employeeCode && data.employeeCode.trim().toUpperCase() !== existing.employeeCode) {
      const codeConflict = await db.employee.findUnique({
        where: { employeeCode: data.employeeCode.trim().toUpperCase() },
      });
      if (codeConflict && codeConflict.id !== id) {
        return NextResponse.json(
          { error: `Employee ID '${data.employeeCode}' is already in use.` },
          { status: 409 }
        );
      }
    }

    // Check duplicate email if being updated
    if (data.email && data.email.toLowerCase() !== existing.email) {
      const emailConflict = await db.employee.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (emailConflict && emailConflict.id !== id) {
        return NextResponse.json(
          { error: `Work email '${data.email}' is already in use.` },
          { status: 409 }
        );
      }
    }

    const targetDeptId =
      data.departmentId !== undefined
        ? data.departmentId || null
        : existing.departmentId;
    const cleanSupervisorName =
      data.supervisorName !== undefined || data.supervisor2Name !== undefined
        ? formatSupervisorNames(data.supervisorName, data.supervisor2Name)
        : existing.supervisorName;
    const cleanSupervisorEmail =
      data.supervisorEmail !== undefined || data.supervisor2Email !== undefined
        ? formatSupervisorEmails(data.supervisorEmail, data.supervisor2Email)
        : existing.supervisorEmail;

    // Optionally also update the Department's supervisor contact
    if (data.applySupervisorToDepartment && cleanSupervisorEmail && targetDeptId) {
      await db.department.update({
        where: { id: targetDeptId },
        data: {
          supervisorName: cleanSupervisorName,
          supervisorEmail: cleanSupervisorEmail,
        },
      });
    }

    const updated = await db.employee.update({
      where: { id },
      data: {
        employeeCode: data.employeeCode ? data.employeeCode.trim().toUpperCase() : existing.employeeCode,
        firstName: data.firstName ?? existing.firstName,
        lastName: data.lastName ?? existing.lastName,
        email: data.email !== undefined ? (data.email ? data.email.toLowerCase() : null) : existing.email,
        phoneNumber: data.phoneNumber !== undefined ? (data.phoneNumber || null) : existing.phoneNumber,
        departmentId: targetDeptId,
        designation: data.designation !== undefined ? (data.designation || null) : existing.designation,
        status: data.status ?? existing.status,
        worksite: null,
        supervisorId: data.supervisorId !== undefined ? (data.supervisorId || null) : existing.supervisorId,
        supervisorName: cleanSupervisorName,
        supervisorEmail: cleanSupervisorEmail,
        profilePhotoUrl: data.profilePhotoUrl !== undefined ? (data.profilePhotoUrl || null) : existing.profilePhotoUrl,
        multiCardAuthorized: data.multiCardAuthorized ?? existing.multiCardAuthorized,
      },
      include: { department: true },
    });

    // Sync any open OverdueCase records for this employee so the updated supervisor email shows immediately
    if (cleanSupervisorEmail) {
      await db.overdueCase.updateMany({
        where: {
          employeeId: id,
          status: { in: ["OPEN", "ESCALATED", "PENDING_SUPERVISOR"] },
        },
        data: {
          supervisorEmail: cleanSupervisorEmail,
        },
      });
    }

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "EMPLOYEE_UPDATED",
      entityType: "EMPLOYEE",
      entityId: id,
      changes: { before: existing, after: updated },
    });

    return NextResponse.json({ success: true, employee: updated });
  } catch (error) {
    console.error("[Employee Update Error]", error);
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    session.roleCode !== "SYSTEM_ADMIN" &&
    session.roleCode !== "PHONE_CUSTODIAN" &&
    !hasPermission(session, "employees:manage")
  ) {
    return NextResponse.json(
      { error: "Forbidden: Deleting employee records requires System Admin or Custodian privileges." },
      { status: 403 }
    );
  }

  const { id } = await props.params;

  const existing = await db.employee.findUnique({
    where: { id },
    include: {
      custodyTransactions: {
        where: { actualReturnAt: null, status: { in: ["ISSUED", "OVERDUE"] } },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  try {
    await db.$transaction(async (tx) => {
      // 1. Release any phones currently held by this employee back to AVAILABLE
      for (const t of existing.custodyTransactions) {
        if (t.phoneAssetId) {
          await tx.phoneAsset.update({
            where: { id: t.phoneAssetId },
            data: { custodyStatus: "AVAILABLE" },
          });
        }
      }

      // 2. Cascade delete overdue escalations & cases
      await tx.overdueEscalation.deleteMany({
        where: { overdueCase: { employeeId: id } },
      });
      await tx.overdueCase.deleteMany({
        where: { employeeId: id },
      });

      // 3. Cascade delete return deadlines & extensions
      await tx.deadlineExtension.deleteMany({
        where: { returnDeadline: { employeeId: id } },
      });
      await tx.returnDeadline.deleteMany({
        where: { employeeId: id },
      });

      // 4. Detach/unlink incidents
      await tx.incident.updateMany({
        where: { employeeId: id },
        data: { employeeId: null },
      });
      await tx.incident.updateMany({
        where: { custodyTransaction: { employeeId: id } },
        data: { custodyTransactionId: null },
      });

      // 5. Delete custody events & kiosk requests
      await tx.custodyEvent.deleteMany({
        where: { employeeId: id },
      });
      await tx.kioskVerificationRequest.deleteMany({
        where: { employeeId: id },
      });

      // 6. Delete custody transactions & assignments & shifts
      await tx.custodyTransaction.deleteMany({
        where: { employeeId: id },
      });
      await tx.phoneAssignment.deleteMany({
        where: { employeeId: id },
      });
      await tx.employeeShift.deleteMany({
        where: { employeeId: id },
      });

      // 7. Unbind NFC cards
      await tx.nfcCard.updateMany({
        where: { employeeId: id },
        data: { employeeId: null, status: "UNASSIGNED" },
      });

      // 8. Unlink notifications & supervisors
      await tx.notification.deleteMany({
        where: { employeeId: id },
      });
      await tx.employee.updateMany({
        where: { supervisorId: id },
        data: { supervisorId: null },
      });
      await tx.department.updateMany({
        where: { supervisorId: id },
        data: { supervisorId: null },
      });

      // 9. Permanently delete employee master record
      await tx.employee.delete({
        where: { id },
      });
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "EMPLOYEE_DELETED",
      entityType: "EMPLOYEE",
      entityId: id,
      changes: {
        deletedEmployee: `${existing.firstName} ${existing.lastName} (${existing.employeeCode})`,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Employee ${existing.firstName} ${existing.lastName} (${existing.employeeCode}) successfully deleted.`,
    });
  } catch (error: any) {
    console.error("[DELETE /api/employees/[id]] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete employee: " + (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}
