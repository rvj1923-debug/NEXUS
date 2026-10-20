import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const verificationReq = await db.kioskVerificationRequest.findUnique({
      where: { token },
      include: {
        employee: {
          include: { department: true },
        },
        phoneAsset: true,
      },
    });

    if (!verificationReq) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const now = new Date();

    // Check expiration
    if (verificationReq.requestStatus === "PENDING" && verificationReq.expiresAt < now) {
      await db.kioskVerificationRequest.update({
        where: { id: verificationReq.id },
        data: { requestStatus: "EXPIRED" },
      });
      return NextResponse.json({
        status: "EXPIRED",
        message: "Verification request expired. Please tap your badge again.",
      });
    }

    if (verificationReq.requestStatus === "PENDING") {
      const remainingSeconds = Math.max(
        0,
        Math.floor((verificationReq.expiresAt.getTime() - now.getTime()) / 1000)
      );
      return NextResponse.json({
        status: "PENDING",
        requestCode: verificationReq.requestCode,
        remainingSeconds,
      });
    }

    if (verificationReq.requestStatus === "APPROVED") {
      let transaction = null;
      if (verificationReq.custodyTransactionId) {
        transaction = await db.custodyTransaction.findUnique({
          where: { id: verificationReq.custodyTransactionId },
          include: {
            returnDeadline: true,
          },
        });
      }

      return NextResponse.json({
        status: "APPROVED",
        requestCode: verificationReq.requestCode,
        transactionType: verificationReq.transactionType,
        transaction: transaction
          ? {
              id: transaction.id,
              transactionCode: transaction.transactionCode,
              timestamp: transaction.timestamp,
              condition: transaction.conditionAtAction,
              accessories:
                transaction.transactionType === "ISSUANCE"
                  ? transaction.accessoriesIssued
                  : transaction.accessoriesReturned,
              expectedReturnAt:
                transaction.returnDeadline?.expectedReturnAt || transaction.returnDeadlineAt,
            }
          : null,
        employee: {
          id: verificationReq.employee.id,
          name: `${verificationReq.employee.firstName} ${verificationReq.employee.lastName}`,
          department: verificationReq.employee.department?.name || "General",
        },
        phone: {
          id: verificationReq.phoneAsset.id,
          assetTag: verificationReq.phoneAsset.assetTag,
          brand: "",
          model: "",
        },
      });
    }

    if (verificationReq.requestStatus === "REJECTED") {
      return NextResponse.json({
        status: "REJECTED",
        reason: verificationReq.rejectionReason || "Verification rejected by phone custodian.",
      });
    }

    return NextResponse.json({
      status: verificationReq.requestStatus,
    });
  } catch (error: any) {
    console.error("[GET /api/kiosk/status] Error:", error);
    return NextResponse.json(
      { error: "Failed to query status", message: "System temporarily unavailable." },
      { status: 500 }
    );
  }
}
