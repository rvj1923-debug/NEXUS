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

  if (!hasPermission(session, "employees:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires employees:manage permission" }, { status: 403 });
  }

  const { id } = await props.params;

  try {
    const body = await request.json().catch(() => ({}));
    const { forceClearance = false, overrideReason = "" } = body;

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        department: true,
        assignments: {
          where: { status: "ACTIVE" },
          include: { phoneAsset: true },
        },
        nfcCards: {
          where: { status: "ACTIVE" },
        },
      },
    });

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // 1. Check for Outstanding Physical Phones
    // Find latest transaction for each phone associated with employee
    const latestIssuance = await db.custodyTransaction.findFirst({
      where: {
        employeeId: id,
        transactionType: "ISSUANCE",
      },
      orderBy: { timestamp: "desc" },
      include: { phoneAsset: true },
    });

    let hasOutstandingPhone = false;
    let outstandingPhoneDetails = null;

    if (latestIssuance) {
      // Check if this issuance was surrendered
      const surrenderAfter = await db.custodyTransaction.findFirst({
        where: {
          employeeId: id,
          phoneAssetId: latestIssuance.phoneAssetId,
          transactionType: "SURRENDER",
          timestamp: { gte: latestIssuance.timestamp },
        },
      });

      if (!surrenderAfter) {
        hasOutstandingPhone = true;
        outstandingPhoneDetails = {
          assetTag: latestIssuance.phoneAsset?.assetTag || "Unknown Phone",
          model: latestIssuance.phoneAsset?.assetTag || "Company Phone",
          imei: latestIssuance.phoneAsset?.imei || "N/A",
          issuedAt: latestIssuance.timestamp,
        };
      }
    }

    // 2. Controlled Clearance Gate: Block deactivation unless override is explicitly justified
    if (hasOutstandingPhone && !forceClearance) {
      return NextResponse.json(
        {
          clearanceRequired: true,
          error: "Controlled Clearance Warning: Employee currently holds an outstanding company phone in their physical possession.",
          outstandingPhone: outstandingPhoneDetails,
          message:
            "Company policy requires phone physical surrender prior to HR deactivation. To bypass for lost/stolen device reporting or emergency separation, provide an authorized supervisor override justification.",
        },
        { status: 409 } // Conflict / Clearance Blocked
      );
    }

    // 3. Deactivate Employee & Revoke Credentials in Transaction
    await db.$transaction(async (tx) => {
      // Deactivate employee
      await tx.employee.update({
        where: { id },
        data: {
          status: "TERMINATED",
          isActive: false,
          deletedAt: new Date(),
        },
      });

      // Revoke any active NFC cards
      for (const card of employee.nfcCards) {
        await tx.nfcCard.update({
          where: { id: card.id },
          data: {
            status: "REVOKED",
            revokedAt: new Date(),
            notes: `Auto-revoked upon employee deactivation. ${forceClearance ? `Override: ${overrideReason}` : ""}`,
          },
        });
      }

      // Terminate any active phone assignments
      for (const asgn of employee.assignments) {
        await tx.phoneAssignment.update({
          where: { id: asgn.id },
          data: {
            status: "TERMINATED",
            endDate: new Date(),
            notes: `Terminated on employee separation. ${overrideReason ? `Reason: ${overrideReason}` : ""}`,
          },
        });

        // Set phone assignmentStatus to UNASSIGNED
        await tx.phoneAsset.update({
          where: { id: asgn.phoneAssetId },
          data: { assignmentStatus: "UNASSIGNED" },
        });
      }
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "EMPLOYEE_DEACTIVATED",
      entityType: "EMPLOYEE",
      entityId: id,
      changes: {
        employeeCode: employee.employeeCode,
        fullName: `${employee.firstName} ${employee.lastName}`,
        hasOutstandingPhone,
        forceClearance,
        overrideReason: overrideReason || null,
        revokedCards: employee.nfcCards.map((c) => c.cardUid),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Employee ${employee.employeeCode} has been cleared and deactivated. Associated active credentials have been revoked.`,
    });
  } catch (error) {
    console.error("[Employee Deactivate Error]", error);
    return NextResponse.json({ error: "Failed to deactivate employee" }, { status: 500 });
  }
}
