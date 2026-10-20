import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { issuePhone, surrenderPhone, CustodyError } from "@/lib/custody/engine";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Retrieve active pending requests created within the last 3 minutes and not expired
    const now = new Date();
    const pendingRequests = await db.kioskVerificationRequest.findMany({
      where: {
        requestStatus: "PENDING",
        expiresAt: { gt: now },
      },
      include: {
        employee: {
          include: { department: true },
        },
        phoneAsset: true,
        kioskDevice: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = pendingRequests.map((r) => {
      const remainingSeconds = Math.max(
        0,
        Math.floor((r.expiresAt.getTime() - now.getTime()) / 1000)
      );
      return {
        id: r.id,
        requestCode: r.requestCode,
        token: r.token,
        transactionType: r.transactionType,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        remainingSeconds,
        employee: {
          id: r.employee.id,
          employeeCode: r.employee.employeeCode,
          name: `${r.employee.firstName} ${r.employee.lastName}`,
          department: r.employee.department?.name || "General",
          avatarUrl: r.employee.profilePhotoUrl,
        },
        phone: {
          id: r.phoneAsset.id,
          assetTag: r.phoneAsset.assetTag,
          brand: "",
          model: "",
          imei: r.phoneAsset.imei,
          condition: r.phoneAsset.condition,
          custodyStatus: r.phoneAsset.custodyStatus,
        },
        kiosk: r.kioskDevice
          ? {
              code: r.kioskDevice.kioskCode,
              name: r.kioskDevice.name,
              location: r.kioskDevice.location,
            }
          : { code: "MAIN-KIOSK", name: "Lobby Kiosk", location: "Lobby" },
      };
    });

    return NextResponse.json({
      success: true,
      count: formatted.length,
      requests: formatted,
    });
  } catch (error: any) {
    console.error("[GET /api/custody/pending] Error:", error);
    return NextResponse.json(
      { error: "Failed to load pending kiosk requests", message: error.message },
      { status: 500 }
    );
  }
}

const actionSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
  action: z.enum(["APPROVE", "REJECT"]),
  conditionAtAction: z.string().default("GOOD"),
  accessories: z.string().optional(),
  remarks: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.roleCode !== "SYSTEM_ADMIN" && session.roleCode !== "PHONE_CUSTODIAN") {
      return NextResponse.json(
        { error: "Forbidden: Only Phone Custodians and Administrators can approve custody transactions." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = actionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      requestId,
      action,
      conditionAtAction,
      accessories,
      remarks,
      rejectionReason,
    } = parsed.data;

    const verificationReq = await db.kioskVerificationRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: true,
        phoneAsset: true,
      },
    });

    if (!verificationReq) {
      return NextResponse.json({ error: "Verification request not found." }, { status: 404 });
    }

    if (verificationReq.requestStatus !== "PENDING") {
      return NextResponse.json(
        { error: `Request is already ${verificationReq.requestStatus}.` },
        { status: 409 }
      );
    }

    if (verificationReq.expiresAt < new Date()) {
      await db.kioskVerificationRequest.update({
        where: { id: requestId },
        data: { requestStatus: "EXPIRED" },
      });
      return NextResponse.json({ error: "Verification request has expired." }, { status: 410 });
    }

    // Handle Rejection
    if (action === "REJECT") {
      await db.kioskVerificationRequest.update({
        where: { id: requestId },
        data: {
          requestStatus: "REJECTED",
          rejectionReason: rejectionReason || "Rejected by custodian during physical verification.",
          verifiedByUserId: session.userId,
        },
      });

      return NextResponse.json({
        success: true,
        action: "REJECTED",
        message: "Kiosk request rejected.",
      });
    }

    // Handle Approval -> Execute Custody Transaction
    let normalizedCondition: any = "GOOD";
    if (
      conditionAtAction === "MINOR_DAMAGE" ||
      conditionAtAction === "MAJOR_DAMAGE" ||
      conditionAtAction === "NOT_FUNCTIONAL" ||
      conditionAtAction === "ACCESSORIES_MISSING" ||
      conditionAtAction === "GOOD"
    ) {
      normalizedCondition = conditionAtAction;
    } else if (conditionAtAction === "DAMAGED") {
      normalizedCondition = "MAJOR_DAMAGE";
    }

    const finalRemarks = remarks
      ? `Desk Assisted Verification (${session.fullName}): ${remarks}`
      : `Desk Assisted Verification approved by ${session.fullName}`;

    let txResult = null;
    if (verificationReq.transactionType === "ISSUANCE" || verificationReq.transactionType === "TIME_IN") {
      txResult = await issuePhone({
        employeeId: verificationReq.employeeId,
        phoneAssetId: verificationReq.phoneAssetId,
        nfcCardId: verificationReq.nfcCardId,
        nfcReaderId: null,
        conditionAtAction: normalizedCondition,
        accessoriesIssued: accessories || "Phone, Charger, Case",
        remarks: finalRemarks,
        handledByUserId: session.userId,
        verifiedViaNfc: true,
      });
    } else {
      txResult = await surrenderPhone({
        employeeId: verificationReq.employeeId,
        phoneAssetId: verificationReq.phoneAssetId,
        conditionAtAction: normalizedCondition,
        accessoriesReturned: accessories || "Phone, Charger, Case",
        remarks: finalRemarks,
        handledByUserId: session.userId,
      });
    }

    // Update request state to APPROVED
    await db.kioskVerificationRequest.update({
      where: { id: requestId },
      data: {
        requestStatus: "APPROVED",
        verifiedByUserId: session.userId,
        conditionAtAction: normalizedCondition,
        remarks: finalRemarks,
        custodyTransactionId: txResult.transaction.id,
      },
    });

    return NextResponse.json({
      success: true,
      action: "APPROVED",
      transaction: {
        id: txResult.transaction.id,
        transactionCode: txResult.transaction.transactionCode,
        transactionType: txResult.transaction.transactionType,
        timestamp: txResult.transaction.timestamp,
        condition: txResult.transaction.conditionAtAction,
        expectedReturnAt: (txResult as any).deadline?.expectedReturnAt || null,
      },
    });
  } catch (error: any) {
    console.error("[POST /api/custody/pending] Error:", error);
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: error.message || "Failed to process approval." },
      { status: 500 }
    );
  }
}
