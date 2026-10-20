import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { issuePhone, surrenderPhone, CustodyError } from "@/lib/custody/engine";

const kioskCustodySchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  phoneAssetId: z.string().min(1, "Phone Asset ID is required"),
  transactionType: z.enum(["ISSUANCE", "SURRENDER", "TIME_IN", "TIME_OUT"]),
  cardUid: z.string().optional().nullable(),
  readerIdentifier: z.string().optional(),
  conditionAtAction: z.string().default("GOOD"),
  remarks: z.string().optional().nullable(),
  operatorConfirmed: z.boolean().default(true),
  idempotencyKey: z.string().optional().nullable(),
  enforceCooldown: z.boolean().optional().default(false),
  skipCooldown: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    // Zero-interaction tap flow on /kiosk uses /api/kiosk/resolve exclusively;
    // restrict /api/kiosk/custody to SYSTEM_ADMIN and PHONE_CUSTODIAN
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const body = await req.json();
    const parsed = kioskCustodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      employeeId,
      phoneAssetId,
      transactionType,
      cardUid,
      readerIdentifier,
      conditionAtAction,
      remarks,
      operatorConfirmed,
      enforceCooldown,
      skipCooldown,
    } = parsed.data;

    if (!operatorConfirmed) {
      return NextResponse.json(
        { error: "Operator confirmation is required to finalize custody transaction." },
        { status: 428 }
      );
    }

    // Accidental double-tap differential guard
    if (enforceCooldown && !skipCooldown && (transactionType === "TIME_OUT" || transactionType === "SURRENDER")) {
      const openTx = await db.custodyTransaction.findFirst({
        where: {
          phoneAssetId,
          status: { in: ["ISSUED", "OVERDUE"] },
        },
        orderBy: { timestamp: "desc" },
      });
      if (openTx && openTx.timestamp && openTx.status !== "OVERDUE") {
        const elapsedSec = Math.floor((Date.now() - new Date(openTx.timestamp).getTime()) / 1000);
        const MIN_COOLDOWN = 30;
        if (elapsedSec < MIN_COOLDOWN) {
          return NextResponse.json(
            {
              error: `Accidental double-tap detected. Device was Timed In ${elapsedSec}s ago. Please wait ${MIN_COOLDOWN - elapsedSec}s before Timing Out.`,
              code: "DOUBLE_TAP_COOLDOWN_ACTIVE",
              secondsSinceIssued: elapsedSec,
              cooldownRemainingSeconds: MIN_COOLDOWN - elapsedSec,
              remainingSeconds: MIN_COOLDOWN - elapsedSec,
            },
            { status: 429 }
          );
        }
      }
    }

    // Lookup reader if provided
    let reader = null;
    if (readerIdentifier) {
      reader = await db.nfcReader.findUnique({
        where: { readerIdentifier },
      });
    }

    // Lookup card and verify employeeId / phoneAssetId match the card's assignment before writing
    let card = null;
    if (cardUid) {
      card = await db.nfcCard.findFirst({
        where: {
          OR: [
            { cardUid: cardUid.trim() },
            { cardNumber: `SN-${cardUid.trim()}` },
            { cardNumber: cardUid.trim() },
          ],
        },
      });

      if (!card || card.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "NFC card is not registered or not active.", code: "INVALID_CARD" },
          { status: 409 }
        );
      }

      if (card.employeeId && card.employeeId !== employeeId) {
        return NextResponse.json(
          { error: "Employee ID does not match the employee bound to this NFC card.", code: "CARD_EMPLOYEE_MISMATCH" },
          { status: 409 }
        );
      }

      if (card.phoneAssetId && card.phoneAssetId !== phoneAssetId) {
        return NextResponse.json(
          { error: "Phone Asset ID does not match the phone bound to this NFC card.", code: "CARD_PHONE_MISMATCH" },
          { status: 409 }
        );
      }
    }

    // Verify active phone assignment matches employeeId and phoneAssetId
    const activeAssignment = await db.phoneAssignment.findFirst({
      where: {
        phoneAssetId,
        status: "ACTIVE",
      },
      orderBy: { startDate: "desc" },
    });

    if (activeAssignment && activeAssignment.employeeId !== employeeId) {
      return NextResponse.json(
        {
          error: "Employee does not match the active assignment for this phone asset.",
          code: "ASSIGNMENT_MISMATCH",
        },
        { status: 409 }
      );
    }

    const headerIdempotency = req.headers.get("idempotency-key");
    const idempotencyKey = headerIdempotency || parsed.data.idempotencyKey;

    // Map condition to standardized Phase 4 enum
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

    if (transactionType === "ISSUANCE" || transactionType === "TIME_IN") {
      const res = await issuePhone({
        employeeId,
        phoneAssetId,
        nfcCardId: card?.id || null,
        nfcReaderId: reader?.id || null,
        conditionAtAction: normalizedCondition,
        remarks: remarks || `NFC Kiosk ${transactionType} via reader ${readerIdentifier || "DIRECT"}`,
        idempotencyKey,
        handledByUserId: session.userId || null,
        verifiedViaNfc: true,
      });

      return NextResponse.json({
        success: true,
        transactionCode: res.transaction.transactionCode,
        transactionType: transactionType === "TIME_IN" ? "TIME_IN" : "ISSUANCE",
        message: res.message,
        expectedReturnAt: (res as any).deadline?.expectedReturnAt || (res.transaction as any).returnDeadlineAt || null,
        transaction: res.transaction,
        phone: res.phone ? {
          id: res.phone.id,
          assetTag: res.phone.assetTag,
          custodyStatus: res.phone.custodyStatus,
        } : null,
      });
    } else {
      const res = await surrenderPhone({
        employeeId,
        phoneAssetId,
        nfcReaderId: reader?.id || null,
        conditionAtAction: normalizedCondition,
        conditionNotes: remarks || null,
        remarks: remarks || `NFC Kiosk ${transactionType} via reader ${readerIdentifier || "DIRECT"}`,
        idempotencyKey,
        handledByUserId: session?.userId || null,
        transactionType: transactionType === "TIME_OUT" ? "TIME_OUT" : "SURRENDER",
      });

      return NextResponse.json({
        success: true,
        transactionCode: res.transaction.transactionCode,
        transactionType: transactionType === "TIME_OUT" ? "TIME_OUT" : "SURRENDER",
        message: res.message,
        returnStatus: res.returnStatus,
        overdueMinutes: res.overdueMinutes,
        custodyDurationMinutes: res.custodyDurationMinutes,
        incident: res.incident,
        transaction: res.transaction,
        phone: res.phone ? {
          id: res.phone.id,
          assetTag: res.phone.assetTag,
          custodyStatus: res.phone.custodyStatus,
        } : null,
      });
    }
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    console.error("[POST /api/kiosk/custody] Error:", error);
    return NextResponse.json(
      { error: "Custody transaction failed", details: error.message },
      { status: 500 }
    );
  }
}
