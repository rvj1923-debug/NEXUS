import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

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
    const body = await request.json().catch(() => ({}));
    const { reason = "Manual unassignment", force = false } = body;

    const assignment = await db.phoneAssignment.findUnique({
      where: { id },
      include: {
        employee: true,
        phoneAsset: true,
      },
    });

    if (!assignment || assignment.status !== "ACTIVE") {
      return NextResponse.json({ error: "Active assignment not found" }, { status: 404 });
    }

    // Prevent unassigning if physically issued unless forced
    if (assignment.phoneAsset.custodyStatus === "ISSUED" && !force) {
      return NextResponse.json(
        {
          error: `Physical Custody Warning: Phone '${assignment.phoneAsset.assetTag}' is currently physically checked out in the field. Please surrender the device at the kiosk or custody desk before terminating the standing assignment.`,
          custodyStatus: assignment.phoneAsset.custodyStatus,
        },
        { status: 409 }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.phoneAssignment.update({
        where: { id },
        data: {
          status: "TERMINATED",
          endDate: new Date(),
          notes: reason ? `Terminated: ${reason}` : "Terminated",
        },
      });

      await tx.phoneAsset.update({
        where: { id: assignment.phoneAssetId },
        data: { assignmentStatus: "UNASSIGNED" },
      });
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "PHONE_ASSIGNMENT_TERMINATED",
      entityType: "PHONE_ASSIGNMENT",
      entityId: id,
      changes: {
        employeeCode: assignment.employee.employeeCode,
        assetTag: assignment.phoneAsset.assetTag,
        reason,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Assignment of phone ${assignment.phoneAsset.assetTag} to ${assignment.employee.employeeCode} has been terminated. Phone returned to pool.`,
    });
  } catch (error) {
    console.error("[Assignment Terminate Error]", error);
    return NextResponse.json({ error: "Failed to terminate assignment" }, { status: 500 });
  }
}
