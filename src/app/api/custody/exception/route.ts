import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";

const exceptionSchema = z.object({
  exceptionType: z.enum([
    "FORGOT_NFC_CARD",
    "DAMAGED_NFC_CARD",
    "READER_DISCONNECTED",
    "REPRESENTATIVE_SURRENDER",
    "WRONG_ASSET_PRESENTED",
    "PHONE_REPORTED_LOST",
    "EMPLOYEE_LEFT_WITHOUT_RETURN",
  ]),
  employeeId: z.string().min(1, "Employee ID is required"),
  phoneAssetId: z.string().optional().nullable(),
  reason: z.string().min(5, "Mandatory reason with at least 5 characters is required"),
  representativeName: z.string().optional().nullable(),
  supervisorApproved: z.boolean().optional().default(false),
  supervisorNotes: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = exceptionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      exceptionType,
      employeeId,
      phoneAssetId,
      reason,
      representativeName,
      supervisorApproved,
      supervisorNotes,
    } = parsed.data;

    // Check sensitive exceptions requiring supervisor approval
    const isSensitive =
      exceptionType === "PHONE_REPORTED_LOST" ||
      exceptionType === "WRONG_ASSET_PRESENTED" ||
      exceptionType === "EMPLOYEE_LEFT_WITHOUT_RETURN";

    if (isSensitive && !supervisorApproved) {
      return NextResponse.json(
        {
          error: `Exception type '${exceptionType}' is sensitive and requires supervisor authorization.`,
          requiresSupervisorApproval: true,
        },
        { status: 403 }
      );
    }

    // Verify employee
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: { department: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    // If phone reported lost
    let updatedPhone = null;
    let incidentCreated = null;
    let updatedTx = null;

    if (exceptionType === "PHONE_REPORTED_LOST" && phoneAssetId) {
      const incNumber = `INC-LOST-${Date.now().toString(36).toUpperCase()}`;

      const res = await db.$transaction(async (tx) => {
        // Find open or latest transaction for this phone
        const targetTx = await tx.custodyTransaction.findFirst({
          where: { phoneAssetId },
          orderBy: { timestamp: "desc" },
        });

        let modifiedTx = null;
        if (targetTx) {
          modifiedTx = await tx.custodyTransaction.update({
            where: { id: targetTx.id },
            data: {
              status: "LOST",
              actualReturnAt: new Date(),
              remarks: `Device reported lost. Reason: ${reason}`,
              isManualOverride: true,
              overrideReason: reason,
            },
          });
        }

        // Update phone status
        const phone = await tx.phoneAsset.update({
          where: { id: phoneAssetId },
          data: {
            operationalStatus: "LOST",
            condition: "RETIRED",
          },
        });

        // Open Incident
        const incident = await tx.incident.create({
          data: {
            incidentNumber: incNumber,
            phoneAssetId,
            employeeId,
            custodyTransactionId: targetTx?.id || null,
            reportedByUserId: session.userId,
            incidentType: "LOSS",
            severity: "CRITICAL",
            status: "REPORTED",
            description: `Physical phone asset reported missing or lost. Reason: ${reason}. Authorized by: ${session.fullName}`,
          },
        });

        // Create Custody Event
        await tx.custodyEvent.create({
          data: {
            transactionId: targetTx?.id || null,
            phoneAssetId,
            employeeId,
            eventType: "REPORTED_LOST",
            actorUserId: session.userId,
            details: `Device reported LOST. ${reason}`,
          },
        });

        return { phone, incident, transaction: modifiedTx };
      });

      updatedPhone = res.phone;
      incidentCreated = res.incident;
      updatedTx = res.transaction;
    } else {
      // Record standalone custody event
      await db.custodyEvent.create({
        data: {
          phoneAssetId: phoneAssetId || "unspecified",
          employeeId,
          eventType: "EXCEPTION_OVERRIDE",
          actorUserId: session.userId,
          details: `Manual Exception [${exceptionType}]: ${reason}. Rep: ${representativeName || "N/A"}. Supervisor Note: ${supervisorNotes || "N/A"}`,
        },
      });
    }

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: `EXCEPTION_${exceptionType}`,
      entityType: "CUSTODY_EXCEPTION",
      entityId: phoneAssetId || employeeId,
      changes: {
        exceptionType,
        reason,
        representativeName,
        supervisorApproved,
        employeeCode: employee.employeeCode,
      },
    });

    return NextResponse.json({
      success: true,
      exceptionType,
      message: `Exception override '${exceptionType}' recorded successfully.`,
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
      },
      updatedPhone,
      incident: incidentCreated,
      transaction: updatedTx,
    });
  } catch (error: any) {
    console.error("[POST /api/custody/exception] Error:", error);
    return NextResponse.json(
      { error: "Exception processing failed", details: error.message },
      { status: 500 }
    );
  }
}
