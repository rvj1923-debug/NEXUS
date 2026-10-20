import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  resetLoginRateLimit,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { recordAuditLog } from "@/lib/audit";
import { issuePhone, surrenderPhone, CustodyError } from "@/lib/custody/engine";

const DUMMY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const attendedApproveSchema = z.object({
  token: z.string().optional(),
  employeeId: z.string().min(1, "Employee ID is required"),
  phoneAssetId: z.string().min(1, "Phone Asset ID is required"),
  transactionType: z.enum(["ISSUANCE", "SURRENDER", "TIME_IN", "TIME_OUT"]),
  cardUid: z.string().optional().nullable(),
  kioskCode: z.string().optional().nullable(),
  conditionAtAction: z.string().default("GOOD"),
  accessories: z.string().optional(),
  remarks: z.string().optional(),
  custodianEmail: z.string().min(1, "Custodian email or username is required"),
  custodianPassword: z.string().min(1, "Custodian password is required"),
});

export async function POST(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") || "unknown";

    const body = await req.json();
    const parsed = attendedApproveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      token,
      employeeId,
      phoneAssetId,
      transactionType,
      cardUid,
      kioskCode,
      conditionAtAction,
      accessories,
      remarks,
      custodianEmail,
      custodianPassword,
    } = parsed.data;

    const normalizedEmail = custodianEmail.trim().toLowerCase();
    const rateLimitKey = normalizedEmail;

    // 1. Rate Limiting Check (per-account + global limiter)
    const rateLimit = checkLoginRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      await recordAuditLog({
        userEmail: normalizedEmail,
        action: "AUTH_LOCKOUT",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          endpoint: "/api/kiosk/attended-approve",
          reason: rateLimit.reason === "global" ? "Global rate limit exceeded" : "Rate limit exceeded",
          resetSeconds: rateLimit.resetSeconds,
        },
      });

      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please try again in ${rateLimit.resetSeconds} seconds.`,
          resetSeconds: rateLimit.resetSeconds,
        },
        { status: 429 }
      );
    }

    // 2. Authenticate custodian
    const custodian = await db.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { email: custodianEmail.trim() },
        ],
      },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!custodian || !custodian.isActive) {
      await bcrypt.compare(custodianPassword, DUMMY_PASSWORD_HASH).catch(() => false);
      const updatedRate = recordFailedLoginAttempt(rateLimitKey);
      await recordAuditLog({
        userId: custodian?.id,
        userEmail: normalizedEmail,
        action: "AUTH_FAILED",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          endpoint: "/api/kiosk/attended-approve",
          reason: custodian ? "User inactive" : "User not found",
          remainingAttempts: updatedRate.remainingAttempts,
        },
      });

      return NextResponse.json(
        {
          error: "Invalid email or password",
          remainingAttempts: updatedRate.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // 3. Verify password
    const isPasswordValid = await bcrypt.compare(custodianPassword, custodian.passwordHash);
    if (!isPasswordValid) {
      const updatedRate = recordFailedLoginAttempt(rateLimitKey);
      await recordAuditLog({
        userId: custodian.id,
        userEmail: custodian.email,
        action: "AUTH_FAILED",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          endpoint: "/api/kiosk/attended-approve",
          reason: "Password mismatch",
          remainingAttempts: updatedRate.remainingAttempts,
        },
      });

      return NextResponse.json(
        {
          error: "Invalid email or password",
          remainingAttempts: updatedRate.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // 4. Verify authorized role: must be SYSTEM_ADMIN or PHONE_CUSTODIAN
    const isAuthorized = custodian.userRoles.some(
      (ur) => ur.role.code === "SYSTEM_ADMIN" || ur.role.code === "PHONE_CUSTODIAN"
    );

    if (!isAuthorized) {
      await recordAuditLog({
        userId: custodian.id,
        userEmail: custodian.email,
        userRole: custodian.userRoles[0]?.role.code,
        action: "AUTH_FORBIDDEN",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          endpoint: "/api/kiosk/attended-approve",
          reason: "User lacks SYSTEM_ADMIN or PHONE_CUSTODIAN role",
        },
      });

      return NextResponse.json(
        { error: "Forbidden: You are not authorized as a Phone Custodian or System Administrator." },
        { status: 403 }
      );
    }

    resetLoginRateLimit(rateLimitKey);

    // 2. Lookup NFC Card if provided
    let card = null;
    if (cardUid) {
      card = await db.nfcCard.findFirst({
        where: {
          OR: [
            { cardUid: cardUid.trim() },
            { cardNumber: cardUid.trim() },
            { cardNumber: `SN-${cardUid.trim()}` },
          ],
        },
      });
    }

    // 3. Lookup Kiosk Device if provided
    let kioskDevice = null;
    if (kioskCode) {
      kioskDevice = await db.kioskDevice.findUnique({
        where: { kioskCode },
      });
    }

    // 4. Normalize condition
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

    // 5. Execute transaction atomically
    let txResult = null;
    const finalRemarks = remarks
      ? `Attended Kiosk Verification (${custodian.fullName}): ${remarks}`
      : `Attended Kiosk Verification confirmed by ${custodian.fullName}`;

    if (transactionType === "ISSUANCE" || transactionType === "TIME_IN") {
      txResult = await issuePhone({
        employeeId,
        phoneAssetId,
        nfcCardId: card?.id || null,
        nfcReaderId: null,
        conditionAtAction: normalizedCondition,
        accessoriesIssued: accessories || "Phone, Charger, Case",
        remarks: finalRemarks,
        handledByUserId: custodian.id,
        verifiedViaNfc: true,
      });
    } else {
      txResult = await surrenderPhone({
        employeeId,
        phoneAssetId,
        conditionAtAction: normalizedCondition,
        accessoriesReturned: accessories || "Phone, Charger, Case",
        remarks: finalRemarks,
        handledByUserId: custodian.id,
      });
    }

    // 6. Update pending KioskVerificationRequest if token was provided
    if (token) {
      await db.kioskVerificationRequest.updateMany({
        where: { token },
        data: {
          requestStatus: "APPROVED",
          verifiedByUserId: custodian.id,
          conditionAtAction: normalizedCondition,
          remarks: finalRemarks,
          custodyTransactionId: txResult.transaction.id,
        },
      });
    }

    // 7. Update KioskDevice metrics
    if (kioskDevice) {
      await db.kioskDevice.update({
        where: { id: kioskDevice.id },
        data: {
          lastSuccessfulScanAt: new Date(),
          lastHeartbeatAt: new Date(),
        },
      }).catch(() => {});
    }

    // 8. Log immutable audit trail
    await db.auditLog.create({
      data: {
        userId: custodian.id,
        userEmail: custodian.email,
        userRole: custodian.userRoles[0]?.role.code || "PHONE_CUSTODIAN",
        action: `KIOSK_ATTENDED_${transactionType}`,
        entityType: "CustodyTransaction",
        entityId: txResult.transaction.id,
        changes: JSON.stringify({
          transactionCode: txResult.transaction.transactionCode,
          employeeId,
          phoneAssetId,
          kioskCode: kioskCode || "DIRECT_KIOSK",
          verifiedBy: custodian.fullName,
          condition: normalizedCondition,
        }),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      transaction: {
        id: txResult.transaction.id,
        transactionCode: txResult.transaction.transactionCode,
        transactionType: txResult.transaction.transactionType,
        timestamp: txResult.transaction.timestamp,
        condition: txResult.transaction.conditionAtAction,
        expectedReturnAt: (txResult as any).deadline?.expectedReturnAt || null,
        employeeName: (txResult.transaction as any).employee?.firstName
          ? `${(txResult.transaction as any).employee.firstName} ${(txResult.transaction as any).employee.lastName}`
          : "Employee",
        assetTag: (txResult.transaction as any).phoneAsset?.assetTag || "Device",
      },
    });
  } catch (error: any) {
    console.error("[POST /api/kiosk/attended-approve] Error:", error);
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    return NextResponse.json(
      { error: error.message || "Attended approval failed" },
      { status: 500 }
    );
  }
}
