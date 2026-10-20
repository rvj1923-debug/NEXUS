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

const createEmployeeSchema = z.object({
  employeeCode: z.string().min(2).max(30).optional().or(z.literal("")),
  firstName: z.string().min(1, "First name is required").max(50),
  lastName: z.string().min(1, "Last name is required").max(50),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phoneNumber: z.string().max(20).optional().or(z.literal("")),
  departmentId: z.string().uuid("Invalid department").optional().nullable().or(z.literal("")),
  designation: z.string().max(100).optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).default("ACTIVE"),
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
  profilePhotoUrl: z.string().url().optional().or(z.literal("")),
  nfcCard: z
    .object({
      cardUid: z.string().min(3).max(64),
      cardNumber: z.string().max(64).optional().nullable(),
      identifierType: z.string().default("MIFARE_CLASSIC"),
      readerSource: z.string().default("DESK_READER"),
    })
    .optional()
    .nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const departmentId = searchParams.get("departmentId") || "";
    const status = searchParams.get("status") || "";

    const whereClause: Record<string, unknown> = {
      isActive: true,
    };

    // Department supervisor scoped filtering
    if (session.roleCode === "DEPT_SUPERVISOR" && session.departmentId) {
      whereClause.departmentId = session.departmentId;
    } else if (departmentId) {
      whereClause.departmentId = departmentId;
    }

    if (status) {
      whereClause.status = status;
    }

    if (search) {
      whereClause.OR = [
        { employeeCode: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { designation: { contains: search, mode: "insensitive" } },
        { supervisorName: { contains: search, mode: "insensitive" } },
        { supervisorEmail: { contains: search, mode: "insensitive" } },
      ];
    }

    const rawEmployees = await db.employee.findMany({
      where: whereClause,
      include: {
        department: true,
        supervisor: { select: { id: true, firstName: true, lastName: true, employeeCode: true, email: true } },
        nfcCards: { where: { status: "ACTIVE" } },
        overdueCases: {
          orderBy: { detectedAt: "desc" },
          include: { phoneAsset: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const employees = rawEmployees.map((emp) => {
      const enrichedCases = (emp.overdueCases || []).map((c) => ({
        ...c,
        ...getHrIncidentStatus(c),
      }));
      const activeIncidentCase = enrichedCases.find((c) => c.incidentReportIssued) || null;
      const latestClearedCase =
        !activeIncidentCase
          ? enrichedCases.find((c) => c.incidentRemovedByHr) || null
          : null;

      return {
        ...emp,
        overdueCases: enrichedCases,
        incidentReportIssued: Boolean(activeIncidentCase),
        activeIncidentCase,
        latestClearedCase,
      };
    });

    return NextResponse.json({ employees });
  } catch (error) {
    console.error("[Employee List Error]", error);
    return NextResponse.json({ employees: [], error: "Failed to load employees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "employees:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires employees:manage permission" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Resolve or auto-generate employeeCode
    let finalCode = data.employeeCode?.trim().toUpperCase();
    if (!finalCode) {
      const dept = data.departmentId
        ? await db.department.findUnique({ where: { id: data.departmentId } })
        : null;
      const prefix = dept ? dept.code.toUpperCase() : "EMP";
      const count = await db.employee.count();
      finalCode = `${prefix}-${String(count + 1).padStart(3, "0")}`;
      const existing = await db.employee.findUnique({ where: { employeeCode: finalCode } });
      if (existing) {
        finalCode = `${prefix}-${Date.now().toString().slice(-4)}`;
      }
    } else {
      const existingCode = await db.employee.findUnique({
        where: { employeeCode: finalCode },
      });
      if (existingCode) {
        return NextResponse.json(
          { error: `Employee ID '${finalCode}' already exists.` },
          { status: 409 }
        );
      }
    }

    // Check duplicate email if provided
    if (data.email) {
      const existingEmail = await db.employee.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (existingEmail) {
        return NextResponse.json(
          { error: `Work email '${data.email}' is already registered.` },
          { status: 409 }
        );
      }
    }

    // Check optional NFC card availability
    let existingNfcCard: any = null;
    if (data.nfcCard?.cardUid) {
      const cleanUid = data.nfcCard.cardUid.trim().toUpperCase();
      existingNfcCard = await db.nfcCard.findFirst({
        where: { cardUid: { equals: cleanUid, mode: "insensitive" } },
        include: { employee: true },
      });

      if (existingNfcCard && existingNfcCard.status === "ACTIVE" && existingNfcCard.employeeId) {
        return NextResponse.json(
          {
            error: `NFC Card '${cleanUid}' is already actively bound to ${existingNfcCard.employee?.firstName} ${existingNfcCard.employee?.lastName} (${existingNfcCard.employee?.employeeCode}).`,
          },
          { status: 409 }
        );
      }

      if (existingNfcCard && ["REVOKED", "LOST", "DAMAGED"].includes(existingNfcCard.status)) {
        return NextResponse.json(
          {
            error: `Cannot bind card '${cleanUid}': Credential is permanently flagged as ${existingNfcCard.status}.`,
          },
          { status: 409 }
        );
      }
    }

    // Execute in transaction
    const newEmployee = await db.$transaction(async (tx) => {
      const cleanSupervisorName = formatSupervisorNames(data.supervisorName, data.supervisor2Name);
      const cleanSupervisorEmail = formatSupervisorEmails(data.supervisorEmail, data.supervisor2Email);

      if (data.applySupervisorToDepartment && cleanSupervisorEmail && data.departmentId) {
        await tx.department.update({
          where: { id: data.departmentId },
          data: {
            supervisorName: cleanSupervisorName,
            supervisorEmail: cleanSupervisorEmail,
          },
        });
      }

      const emp = await tx.employee.create({
        data: {
          employeeCode: finalCode,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email ? data.email.toLowerCase() : null,
          phoneNumber: data.phoneNumber || null,
          departmentId: data.departmentId || null,
          designation: data.designation || null,
          status: data.status,
          worksite: null,
          supervisorId: data.supervisorId || null,
          supervisorName: cleanSupervisorName,
          supervisorEmail: cleanSupervisorEmail,
          profilePhotoUrl: data.profilePhotoUrl || null,
          isActive: true,
        },
        include: { department: true },
      });

      // Enroll and bind verified NFC card if provided
      if (data.nfcCard?.cardUid) {
        const cleanUid = data.nfcCard.cardUid.trim().toUpperCase();
        if (existingNfcCard) {
          await tx.nfcCard.update({
            where: { id: existingNfcCard.id },
            data: {
              employeeId: emp.id,
              status: "ACTIVE",
              enrolledByUserId: session.userId,
              cardNumber: data.nfcCard.cardNumber || existingNfcCard.cardNumber || `SN-${cleanUid}`,
              identifierType: data.nfcCard.identifierType || existingNfcCard.identifierType,
            },
          });
        } else {
          await tx.nfcCard.create({
            data: {
              cardUid: cleanUid,
              cardNumber: data.nfcCard.cardNumber || `SN-${cleanUid}`,
              identifierType: data.nfcCard.identifierType || "MIFARE_CLASSIC",
              readerSource: data.nfcCard.readerSource || "DESK_READER",
              employeeId: emp.id,
              status: "ACTIVE",
              enrolledByUserId: session.userId,
            },
          });
        }
      }

      return emp;
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "EMPLOYEE_CREATED",
      entityType: "EMPLOYEE",
      entityId: newEmployee.id,
      changes: {
        employeeCode: newEmployee.employeeCode,
        fullName: `${newEmployee.firstName} ${newEmployee.lastName}`,
        department: newEmployee.department?.name || "Unassigned",
      },
    });

    return NextResponse.json({ success: true, employee: newEmployee }, { status: 201 });
  } catch (error) {
    console.error("[Employee Create Error]", error);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
}

export async function DELETE() {
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

  try {
    const deletedCount = await db.$transaction(async (tx) => {
      // 1. Release any phones currently issued/assigned back to AVAILABLE / UNASSIGNED
      await tx.phoneAsset.updateMany({
        where: { custodyStatus: { in: ["ISSUED", "OVERDUE"] } },
        data: { custodyStatus: "AVAILABLE" },
      });
      await tx.phoneAsset.updateMany({
        where: { assignmentStatus: "ASSIGNED" },
        data: { assignmentStatus: "UNASSIGNED" },
      });

      // 2. Cascade delete overdue escalations & cases tied to employees
      await tx.overdueEscalation.deleteMany({
        where: { overdueCase: { employeeId: { not: null } } },
      });
      await tx.overdueCase.deleteMany({
        where: { employeeId: { not: null } },
      });

      // 3. Cascade delete return deadlines & extensions
      await tx.deadlineExtension.deleteMany({});
      await tx.returnDeadline.deleteMany({});

      // 4. Detach/unlink incidents
      await tx.incident.updateMany({
        where: { employeeId: { not: null } },
        data: { employeeId: null, custodyTransactionId: null },
      });

      // 5. Delete custody events & kiosk verification requests
      await tx.custodyEvent.deleteMany({});
      await tx.kioskVerificationRequest.deleteMany({});

      // 6. Delete custody transactions, phone assignments & shifts
      await tx.custodyTransaction.deleteMany({
        where: { employeeId: { not: null } },
      });
      await tx.phoneAssignment.deleteMany({});
      await tx.employeeShift.deleteMany({});

      // 7. Remove employee NFC cards (keep phone asset tags & maintenance cards)
      await tx.nfcCard.deleteMany({
        where: {
          employeeId: { not: null },
          phoneAssetId: null,
          isMaintenanceCard: false,
        },
      });
      await tx.nfcCard.updateMany({
        where: { employeeId: { not: null } },
        data: { employeeId: null, status: "UNASSIGNED" },
      });

      // 8. Clear employee notifications & hierarchy references
      await tx.notification.deleteMany({
        where: { employeeId: { not: null } },
      });
      await tx.employee.updateMany({
        where: { supervisorId: { not: null } },
        data: { supervisorId: null },
      });
      await tx.department.updateMany({
        where: { supervisorId: { not: null } },
        data: { supervisorId: null },
      });

      // 9. Permanently delete all employee records
      const res = await tx.employee.deleteMany({});
      return res.count;
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "DELETE_ALL_EMPLOYEES",
      entityType: "EMPLOYEE",
      entityId: "ALL",
      changes: { removedCount: deletedCount },
    });

    return NextResponse.json({
      success: true,
      removedCount: deletedCount,
      message: `Successfully deleted all ${deletedCount} employee record(s).`,
    });
  } catch (error: any) {
    console.error("[DELETE /api/employees] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete all employees: " + (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}

