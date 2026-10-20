import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

const createAssignmentSchema = z.object({
  employeeId: z.string().uuid("Invalid employee ID"),
  phoneAssetId: z.string().uuid("Invalid phone asset ID"),
  assignmentType: z.enum(["DEDICATED", "POOL", "ROTATIONAL"]).default("DEDICATED"),
  notes: z.string().max(255).optional().or(z.literal("")),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId") || "";
  const phoneAssetId = searchParams.get("phoneAssetId") || "";
  const status = searchParams.get("status") || "";

  const whereClause: Record<string, unknown> = {};

  if (employeeId) whereClause.employeeId = employeeId;
  if (phoneAssetId) whereClause.phoneAssetId = phoneAssetId;
  if (status) whereClause.status = status;

  // Departmental scoping for supervisor
  if (session.roleCode === "DEPT_SUPERVISOR" && session.departmentId) {
    whereClause.employee = { departmentId: session.departmentId };
  }

  const assignments = await db.phoneAssignment.findMany({
    where: whereClause,
    include: {
      employee: { include: { department: true } },
      phoneAsset: true,
      assignedByUser: { select: { fullName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ assignments });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "assignments:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires assignments:manage permission" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { employeeId, phoneAssetId, assignmentType, notes } = parsed.data;

    // 1. Fetch Phone Asset & verify exists
    const phone = await db.phoneAsset.findUnique({
      where: { id: phoneAssetId },
      include: {
        assignments: { where: { status: "ACTIVE" }, include: { employee: true } },
      },
    });

    if (!phone) {
      return NextResponse.json({ error: "Phone asset not found" }, { status: 404 });
    }

    // 2. Business Rule: Prevent reassignment when a phone is physically outstanding!
    if (phone.custodyStatus === "ISSUED") {
      return NextResponse.json(
        {
          error: `Physical Custody Breach Guard: Cannot assign or reassign phone '${phone.assetTag}' while it is physically outstanding in active custody. The device must be surrendered at the custody desk or kiosk first.`,
          phoneStatus: phone.custodyStatus,
        },
        { status: 409 }
      );
    }

    // 3. Business Rule: A phone can have only one current primary assignment unless shared-device policy is enabled
    if (phone.assignments.length > 0 && assignmentType !== "POOL") {
      const activeAssignee = phone.assignments[0].employee;
      return NextResponse.json(
        {
          error: `Phone '${phone.assetTag}' is currently designated to ${activeAssignee.firstName} ${activeAssignee.lastName} (${activeAssignee.employeeCode}). Please terminate the existing assignment or use the Approved Replacement workflow.`,
        },
        { status: 409 }
      );
    }

    // 4. Fetch Employee & check if employee already holds a dedicated phone
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: {
        assignments: { where: { status: "ACTIVE" } },
      },
    });

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    if (employee.assignments.length > 0 && assignmentType === "DEDICATED") {
      return NextResponse.json(
        {
          error: `Employee ${employee.employeeCode} already holds an active dedicated phone assignment. Terminate or replace the existing assignment first.`,
        },
        { status: 409 }
      );
    }

    // 5. Execute Assignment in a Database Transaction
    const assignment = await db.$transaction(async (tx) => {
      // Create assignment record
      const newAsgn = await tx.phoneAssignment.create({
        data: {
          employeeId,
          phoneAssetId,
          assignedByUserId: session.userId,
          assignmentType,
          status: "ACTIVE",
          startDate: new Date(),
          notes: notes || null,
        },
        include: {
          employee: true,
          phoneAsset: true,
          assignedByUser: { select: { fullName: true, email: true } },
        },
      });

      // Update phone asset assignment status
      await tx.phoneAsset.update({
        where: { id: phoneAssetId },
        data: {
          assignmentStatus: assignmentType === "POOL" ? "SHARED_POOL" : "ASSIGNED",
        },
      });

      return newAsgn;
    });

    // 6. Record Audit Log
    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "PHONE_ASSIGNED",
      entityType: "PHONE_ASSIGNMENT",
      entityId: assignment.id,
      changes: {
        employeeCode: employee.employeeCode,
        assetTag: phone.assetTag,
        assignmentType,
        assignedBy: session.email,
      },
    });

    return NextResponse.json({ success: true, assignment }, { status: 201 });
  } catch (error) {
    console.error("[Phone Assignment Error]", error);
    return NextResponse.json({ error: "Failed to create phone assignment" }, { status: 500 });
  }
}
