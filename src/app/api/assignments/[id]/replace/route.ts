import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

const replaceAssignmentSchema = z.object({
  newPhoneAssetId: z.string().uuid("Invalid replacement phone asset ID"),
  reason: z.string().min(1, "Replacement reason is required").max(255),
  notes: z.string().max(255).optional().or(z.literal("")),
});

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "assignments:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires assignments:manage permission" }, { status: 403 });
  }

  const { id } = await props.params;

  try {
    const body = await request.json();
    const parsed = replaceAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { newPhoneAssetId, reason, notes } = parsed.data;

    // 1. Fetch current assignment
    const currentAsgn = await db.phoneAssignment.findUnique({
      where: { id },
      include: {
        employee: true,
        phoneAsset: true,
      },
    });

    if (!currentAsgn || currentAsgn.status !== "ACTIVE") {
      return NextResponse.json({ error: "Active assignment not found" }, { status: 404 });
    }

    // 2. Fetch replacement phone asset
    const newPhone = await db.phoneAsset.findUnique({
      where: { id: newPhoneAssetId },
      include: {
        assignments: { where: { status: "ACTIVE" } },
      },
    });

    if (!newPhone) {
      return NextResponse.json({ error: "Replacement phone asset not found" }, { status: 404 });
    }

    // Prevent using a phone that is physically outstanding
    if (newPhone.custodyStatus === "ISSUED") {
      return NextResponse.json(
        { error: `Cannot assign phone '${newPhone.assetTag}' as replacement: it is physically outstanding in custody.` },
        { status: 409 }
      );
    }

    // Prevent using a phone already actively assigned
    if (newPhone.assignments.length > 0) {
      return NextResponse.json(
        { error: `Phone '${newPhone.assetTag}' is already actively designated to another employee.` },
        { status: 409 }
      );
    }

    // 3. Execute Replacement in Transaction
    const result = await db.$transaction(async (tx) => {
      // End previous assignment
      const terminated = await tx.phoneAssignment.update({
        where: { id },
        data: {
          status: "REPLACED",
          endDate: new Date(),
          notes: `Replaced by ${newPhone.assetTag}. Reason: ${reason}. ${notes || ""}`,
        },
      });

      // Free old phone assignment status
      await tx.phoneAsset.update({
        where: { id: currentAsgn.phoneAssetId },
        data: { assignmentStatus: "UNASSIGNED" },
      });

      // Create replacement assignment linked via replacementForAssignmentId
      const newAsgn = await tx.phoneAssignment.create({
        data: {
          employeeId: currentAsgn.employeeId,
          phoneAssetId: newPhoneAssetId,
          assignedByUserId: session.userId,
          assignmentType: currentAsgn.assignmentType,
          status: "ACTIVE",
          startDate: new Date(),
          replacementForAssignmentId: id,
          notes: `Replacement for ${currentAsgn.phoneAsset.assetTag} (${reason}). ${notes || ""}`,
        },
        include: {
          employee: true,
          phoneAsset: true,
          assignedByUser: { select: { fullName: true, email: true } },
        },
      });

      // Lock new phone assignment status
      await tx.phoneAsset.update({
        where: { id: newPhoneAssetId },
        data: { assignmentStatus: "ASSIGNED" },
      });

      return { oldAssignment: terminated, newAssignment: newAsgn };
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "PHONE_ASSIGNMENT_REPLACED",
      entityType: "PHONE_ASSIGNMENT",
      entityId: result.newAssignment.id,
      changes: {
        employeeCode: currentAsgn.employee.employeeCode,
        oldAssetTag: currentAsgn.phoneAsset.assetTag,
        newAssetTag: newPhone.assetTag,
        reason,
        replacedBy: session.email,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Phone ${currentAsgn.phoneAsset.assetTag} replaced with ${newPhone.assetTag} for employee ${currentAsgn.employee.employeeCode}.`,
      assignment: result.newAssignment,
      newAssignment: result.newAssignment,
      oldAssignment: result.oldAssignment,
    });
  } catch (error) {
    console.error("[Assignment Replace Error]", error);
    return NextResponse.json({ error: "Failed to replace assignment" }, { status: 500 });
  }
}
