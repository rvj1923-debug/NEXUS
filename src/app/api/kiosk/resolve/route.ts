import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { normalizeNfcUid, isDebouncedScan, clearScanDebounce } from "@/lib/nfc/normalization";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

const resolveSchema = z.object({
  cardUid: z.string().min(1, "Card/Tag UID is required"),
  readerIdentifier: z.string().optional(),
  kioskCode: z.string().optional(),
  skipDebounce: z.boolean().optional(),
});

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} hr${h > 1 ? "s" : ""} ${remM} min${remM !== 1 ? "s" : ""}`;
  }
  return `${m} min${m > 1 ? "s" : ""}${s > 0 ? ` ${s}s` : ""}`;
}

export async function POST(req: NextRequest) {
  let normalizedUidForCleanup: string | null = null;
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Invalid request.",
        },
        { status: 400 }
      );
    }

    const parsed = resolveSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Invalid request.",
        },
        { status: 400 }
      );
    }

    const { cardUid, readerIdentifier, skipDebounce } = parsed.data;

    // Always use KIOSK_CODE from server environment (default PHONE-KIOSK-01), never from the request body
    const kioskCode = (process.env.KIOSK_CODE || "PHONE-KIOSK-01").trim() || "PHONE-KIOSK-01";

    let kioskDevice = null;
    try {
      kioskDevice = await db.kioskDevice.upsert({
        where: { kioskCode },
        update: {},
        create: {
          kioskCode,
          name: `${kioskCode} Station`,
          location: "Main Lobby Central Turnstile",
          readerIdentifier: "KIOSK-GATE-A",
          status: "ACTIVE",
          displayLanguage: "EN",
          inactivityTimeoutSeconds: 30,
          sessionSecret: "auto-provisioned-kiosk-session",
        },
      });
    } catch (dbErr) {
      console.error("[POST /api/kiosk/resolve] Temporary DB error:", dbErr);
      return NextResponse.json(
        {
          success: false,
          temporary: true,
          error: "TEMPORARY_UNAVAILABLE",
          message: "System temporarily unavailable. Please try again shortly.",
        },
        { status: 503 }
      );
    }

    if (kioskDevice.status === "MAINTENANCE") {
      return NextResponse.json(
        {
          success: false,
          caseType: "CASE_MAINTENANCE",
          error: "KIOSK_MAINTENANCE",
          kioskStatus: kioskDevice.status,
          message: "Kiosk terminal is in maintenance mode.",
        },
        { status: 503 }
      );
    }

    // Normalization
    const norm = normalizeNfcUid(cardUid);
    if (!norm.isValid) {
      return NextResponse.json(
        {
          success: false,
          caseType: "CASE_E_NOT_RECOGNIZED",
          found: false,
          valid: false,
          error: "INVALID_FORMAT",
          message: "Card not recognized. Please tap a valid NFC card.",
          normalizedUid: norm.normalizedUid,
        },
        { status: 200 }
      );
    }

    // 1. Find enrolled NFC card (never auto-enroll unknown/spam scans)
    const separatorStripped = norm.rawInput.replace(/[:-\s]/g, "");
    const card = await db.nfcCard.findFirst({
      where: {
        OR: [
          { cardUid: norm.rawInput },
          { cardUid: separatorStripped },
          { cardUid: norm.normalizedUid },
          { cardUid: cardUid.trim() },
          { cardNumber: `SN-${norm.rawInput}` },
          { cardNumber: `SN-${separatorStripped}` },
          { cardNumber: norm.specificCardNumber },
          { cardNumber: `SN-${cardUid.trim()}` },
          { cardNumber: norm.rawInput },
          { cardNumber: separatorStripped },
          { cardNumber: cardUid.trim() },
        ],
      },
      include: {
        phoneAsset: true,
        employee: {
          include: { department: true },
        },
      },
    });

    if (card && card.isMaintenanceCard && !["REVOKED", "LOST", "DAMAGED"].includes(card.status)) {
      const session = sessionOrRes;
      await db.auditLog.create({
        data: {
          userId: session.userId,
          userEmail: session.email,
          userRole: session.roleCode,
          action: "KIOSK_MAINTENANCE_TAP",
          entityType: "NfcCard",
          entityId: card.id,
          changes: JSON.stringify({
            cardUid: card.cardUid,
            cardNumber: card.cardNumber,
            kioskCode,
            timestamp: new Date().toISOString(),
          }),
        },
      });

      return NextResponse.json({
        maintenance: true,
        success: true,
        cardUid: card.cardUid,
        cardNumber: card.cardNumber,
        kioskCode,
        appVersion: process.env.npm_package_version || "1.0.0",
        serverTime: new Date().toISOString(),
      });
    }

    // Note: Real kiosk taps (!skipDebounce) use transaction-locked 5s idempotent confirmation below
    // so duplicate reader scans never reset the confirmation screen or trigger false double-tap warnings.
    normalizedUidForCleanup = norm.normalizedUid;

    if (!card) {
      return NextResponse.json(
        {
          success: false,
          caseType: "CASE_E_NOT_RECOGNIZED",
          found: false,
          valid: false,
          error: "CARD_NOT_REGISTERED",
          message: "Card not recognized. Please enroll and assign this NFC card to an employee first.",
          normalizedUid: norm.normalizedUid,
        },
        { status: 200 }
      );
    }

    if (["REVOKED", "LOST", "DAMAGED"].includes(card.status)) {
      return NextResponse.json(
        {
          success: false,
          caseType: "CASE_E_NOT_RECOGNIZED",
          found: true,
          valid: false,
          error: "CARD_REVOKED",
          message: `This NFC card is marked as ${card.status} and cannot be used.`,
          normalizedUid: norm.normalizedUid,
        },
        { status: 200 }
      );
    }

    // Update reader & kiosk heartbeats asynchronously off the critical tap path
    if (readerIdentifier) {
      void db.nfcReader
        .updateMany({
          where: { readerIdentifier },
          data: { lastScannedAt: new Date(), lastError: null },
        })
        .catch(() => null);
    }

    if (kioskCode) {
      void db.kioskDevice
        .updateMany({
          where: { kioskCode },
          data: { lastSuccessfulScanAt: new Date(), lastError: null },
        })
        .catch(() => null);
    }

    // Self-heal any future-dated transaction timestamps caused by a prior OS clock/timezone adjustment
    const healNow = new Date();
    const futureThreshold = new Date(healNow.getTime() + 2000);
    try {
      await db.custodyTransaction.updateMany({
        where: { timestamp: { gt: futureThreshold } },
        data: { timestamp: new Date(healNow.getTime() - 60000) },
      });
      await db.custodyTransaction.updateMany({
        where: { actualReturnAt: { gt: futureThreshold } },
        data: { actualReturnAt: new Date(healNow.getTime() - 30000) },
      });
    } catch {
      // Ignore non-critical clock-heal errors
    }

    // 2. Check for active/open transaction for this card OR this employee
    let openTransaction = await db.custodyTransaction.findFirst({
      where: {
        OR: [
          { nfcCardId: card.id },
          ...(card.employeeId ? [{ employeeId: card.employeeId }] : []),
          ...(card.phoneAssetId ? [{ phoneAssetId: card.phoneAssetId }] : []),
        ],
        actualReturnAt: null,
        status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
      },
      include: {
        employee: {
          include: { department: true },
        },
        phoneAsset: true,
      },
      orderBy: { timestamp: "desc" },
    });

    // 3. Comprehensive Owner / Employee Resolution
    let resolvedEmployee: any = card.employee || openTransaction?.employee || null;

    if (!resolvedEmployee && card.phoneAssetId) {
      // Check active assignment for this phone asset
      const activeAssignment = await db.phoneAssignment.findFirst({
        where: {
          phoneAssetId: card.phoneAssetId,
          status: "ACTIVE",
        },
        include: {
          employee: { include: { department: true } },
        },
        orderBy: { startDate: "desc" },
      });

      if (activeAssignment?.employee) {
        resolvedEmployee = activeAssignment.employee;
      } else {
        // Check any previous assignment on this phone
        const anyAssignment = await db.phoneAssignment.findFirst({
          where: { phoneAssetId: card.phoneAssetId },
          include: {
            employee: { include: { department: true } },
          },
          orderBy: { startDate: "desc" },
        });
        if (anyAssignment?.employee) {
          resolvedEmployee = anyAssignment.employee;
        }
      }
    }

    if (!resolvedEmployee) {
      const recentTx = await db.custodyTransaction.findFirst({
        where: {
          OR: [
            ...(card.phoneAssetId ? [{ phoneAssetId: card.phoneAssetId }] : []),
            { nfcCardId: card.id },
          ],
          employeeId: { not: null },
        },
        include: {
          employee: { include: { department: true } },
        },
        orderBy: { timestamp: "desc" },
      });
      if (recentTx?.employee) {
        resolvedEmployee = recentTx.employee;
      }
    }

    // Never allow an unassigned/unidentified card to create an "Unassigned Personnel" transaction
    if (!resolvedEmployee) {
      return NextResponse.json(
        {
          success: false,
          caseType: "CASE_D_NO_EMPLOYEE",
          found: true,
          valid: false,
          error: "NO_EMPLOYEE_ASSIGNED",
          message: "No active employee is assigned to this NFC card. Please assign an employee first.",
          normalizedUid: norm.normalizedUid,
        },
        { status: 200 }
      );
    }

    // If openTransaction wasn't found via card.employeeId, check resolvedEmployee.id as well
    if (!openTransaction && resolvedEmployee?.id) {
      openTransaction = await db.custodyTransaction.findFirst({
        where: {
          employeeId: resolvedEmployee.id,
          actualReturnAt: null,
          status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
        },
        include: {
          employee: {
            include: { department: true },
          },
          phoneAsset: true,
        },
        orderBy: { timestamp: "desc" },
      });
    }

    // 4. Comprehensive Phone Asset Resolution
    // When timing out, always use the phone from openTransaction first.
    // When timing in (!openTransaction), NEVER pick a phone that is currently checked out in an open transaction to another employee!
    let resolvedPhoneAsset: any = openTransaction?.phoneAsset || null;

    if (!resolvedPhoneAsset && card.phoneAsset) {
      if (openTransaction) {
        resolvedPhoneAsset = card.phoneAsset;
      } else {
        const busyTxOnCardPhone = await db.custodyTransaction.findFirst({
          where: {
            phoneAssetId: card.phoneAsset.id,
            actualReturnAt: null,
            status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
          },
          select: { id: true },
        });
        if (!busyTxOnCardPhone) {
          resolvedPhoneAsset = card.phoneAsset;
        }
      }
    }

    if (!resolvedPhoneAsset && resolvedEmployee) {
      // 4a. Check active assignment for this employee (only if phone is not currently in an open transaction)
      const empAssignment = await db.phoneAssignment.findFirst({
        where: {
          employeeId: resolvedEmployee.id,
          status: "ACTIVE",
          phoneAsset: {
            isActive: true,
            transactions: {
              none: {
                actualReturnAt: null,
                status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
              },
            },
          },
        },
        include: { phoneAsset: true },
        orderBy: { startDate: "desc" },
      });
      if (empAssignment?.phoneAsset) {
        resolvedPhoneAsset = empAssignment.phoneAsset;
      }

      // 4b. Check recent custody transaction with a linked phone, ONLY if that phone is currently free
      if (!resolvedPhoneAsset) {
        const prevTx = await db.custodyTransaction.findFirst({
          where: {
            employeeId: resolvedEmployee.id,
            phoneAssetId: { not: null },
            phoneAsset: {
              isActive: true,
              custodyStatus: "AVAILABLE",
              transactions: {
                none: {
                  actualReturnAt: null,
                  status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
                },
              },
            },
          },
          include: { phoneAsset: true },
          orderBy: { timestamp: "desc" },
        });
        if (prevTx?.phoneAsset) {
          resolvedPhoneAsset = prevTx.phoneAsset;
        }
      }

      // 4c. Allocate available pool phone for employee's department or fleet (guaranteed no open transaction)
      if (!resolvedPhoneAsset) {
        const freePhoneFilter = {
          custodyStatus: "AVAILABLE" as const,
          isActive: true,
          transactions: {
            none: {
              actualReturnAt: null,
              status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] as any },
            },
          },
        };
        resolvedPhoneAsset =
          (await db.phoneAsset.findFirst({
            where: {
              ...freePhoneFilter,
              ...(resolvedEmployee.departmentId ? { departmentId: resolvedEmployee.departmentId } : {}),
            },
            orderBy: { assetTag: "asc" },
          })) ||
          (await db.phoneAsset.findFirst({
            where: freePhoneFilter,
            orderBy: { assetTag: "asc" },
          }));
      }
    }

    const phoneDisplayName = resolvedPhoneAsset
      ? resolvedPhoneAsset.assetTag
      : card.phoneAsset?.assetTag || card.cardNumber || `Tag [${card.cardUid}]`;

    const employeePayload = resolvedEmployee
      ? {
          id: resolvedEmployee.id,
          employeeCode: resolvedEmployee.employeeCode,
          firstName: resolvedEmployee.firstName,
          lastName: resolvedEmployee.lastName,
          fullName: `${resolvedEmployee.firstName} ${resolvedEmployee.lastName}`.trim(),
          department: resolvedEmployee.department?.name || "Operations Fleet",
          designation: resolvedEmployee.designation || "Assigned Custodian",
          profilePhotoUrl: resolvedEmployee.profilePhotoUrl || null,
        }
      : {
          id: null,
          employeeCode: "N/A",
          firstName: "Company",
          lastName: "Asset",
          fullName: "Company Fleet Asset",
          department: "Operations Fleet",
          designation: "General Device",
          profilePhotoUrl: null,
        };

    const ownerName = employeePayload.fullName;

    const now = new Date();
    const COOLDOWN_SECONDS = skipDebounce ? 15 : 5;

    const buildTimeInConfirmationResponse = (txRecord: { transactionCode: string; timestamp: Date }) => {
      const timeDisplay = new Date(txRecord.timestamp).toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return NextResponse.json({
        success: true,
        action: "TIME_IN",
        caseType: "CASE_A_ISSUE",
        phoneName: resolvedPhoneAsset?.assetTag || phoneDisplayName,
        cardUid: card.cardUid,
        transactionCode: txRecord.transactionCode,
        timestamp: new Date(txRecord.timestamp).toISOString(),
        timeDisplay,
        status: "TIMED_IN",
        message: "PHONE SUCCESSFULLY TIMED IN",
        ownerName,
        card: {
          id: card.id,
          cardUid: card.cardUid,
          cardNumber: card.cardNumber,
        },
        phone: {
          id: resolvedPhoneAsset?.id || card.phoneAssetId || card.id,
          assetTag: resolvedPhoneAsset?.assetTag || phoneDisplayName,
          brand: "OUKITEL",
          model: "OUKITEL G1",
        },
        employee: employeePayload,
        timeIn: {
          enabled: false,
          action: "TIME_IN",
          label: "TIME IN",
          reason: "Device is now checked out / in use.",
        },
        timeOut: {
          enabled: true,
          action: "TIME_OUT",
          label: "TIME OUT",
        },
      });
    };

    const buildTimeOutConfirmationResponse = (closedTx: {
      transactionCode: string;
      timestamp: Date;
      actualReturnAt?: Date | null;
      custodyDurationMinutes?: number | null;
    }) => {
      const returnTime = closedTx.actualReturnAt ? new Date(closedTx.actualReturnAt) : now;
      const startTime = new Date(closedTx.timestamp);
      const durationSeconds = Math.max(1, Math.round((returnTime.getTime() - startTime.getTime()) / 1000));
      const durationMinutes = closedTx.custodyDurationMinutes || Math.max(1, Math.round(durationSeconds / 60));
      const timedInDisplay = startTime.toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const timedOutDisplay = returnTime.toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return NextResponse.json({
        success: true,
        action: "TIME_OUT",
        caseType: "CASE_B_SURRENDER",
        phoneName: phoneDisplayName,
        cardUid: card.cardUid,
        transactionCode: closedTx.transactionCode,
        timedInAt: startTime.toISOString(),
        timedInDisplay,
        timedOutAt: returnTime.toISOString(),
        timedOutDisplay,
        durationMinutes,
        durationSeconds,
        durationFormatted: formatDuration(durationSeconds),
        status: "TIMED_OUT",
        message: "PHONE SUCCESSFULLY TIMED OUT",
        ownerName,
        card: {
          id: card.id,
          cardUid: card.cardUid,
          cardNumber: card.cardNumber,
        },
        phone: {
          id: resolvedPhoneAsset?.id || card.phoneAssetId || card.id,
          assetTag: resolvedPhoneAsset?.assetTag || phoneDisplayName,
          brand: "OUKITEL",
          model: "OUKITEL G1",
        },
        employee: employeePayload,
        timeIn: {
          enabled: true,
          action: "TIME_IN",
          label: "TIME IN",
        },
        timeOut: {
          enabled: false,
          action: "TIME_OUT",
          label: "TIME OUT",
          reason: "Device is already returned and in depot.",
        },
      });
    };

    // -------------------------------------------------------------
    // TAP LOGIC:
    // If NOT timed in -> AUTOMATIC TIME IN
    // If ALREADY timed in -> AUTOMATIC TIME OUT
    // Accidental double-tap prevention interval enforced in both directions!
    // -------------------------------------------------------------
    if (!openTransaction) {
      // Cooldown check for TIME_IN attempt:
      // If this card/employee just Timed Out within COOLDOWN_SECONDS, block accidental double-tap
      const lastClosedTx = await db.custodyTransaction.findFirst({
        where: {
          OR: [
            { nfcCardId: card.id },
            ...(resolvedEmployee?.id ? [{ employeeId: resolvedEmployee.id }] : []),
          ],
          actualReturnAt: { not: null },
        },
        orderBy: { actualReturnAt: "desc" },
      });

      if (lastClosedTx && lastClosedTx.actualReturnAt) {
        const elapsedMs = now.getTime() - new Date(lastClosedTx.actualReturnAt).getTime();
        const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

        if (elapsedMs >= -500 && elapsedSeconds < COOLDOWN_SECONDS) {
          if (!skipDebounce) {
            return buildTimeOutConfirmationResponse(lastClosedTx);
          }
          const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
          return NextResponse.json({
            success: false,
            cooldownBlocked: true,
            caseType: "CASE_DOUBLE_TAP_PREVENTED",
            actionAttempted: "TIME_IN",
            currentStatus: "TIMED_OUT",
            phoneName: phoneDisplayName,
            cardUid: card.cardUid,
            ownerName,
            employee: employeePayload,
            elapsedSeconds,
            remainingSeconds,
            cooldownSeconds: COOLDOWN_SECONDS,
            message: `Accidental double-tap detected. Phone was Timed Out ${elapsedSeconds}s ago. Please wait ${remainingSeconds}s before Timing In again.`,
          });
        }
      }

      // ===== TIME IN (Atomic Transaction) =====
      const txCode = `CTX-IN-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const twentyFourHourDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      let targetPhoneIdForIn = resolvedPhoneAsset?.id || card.phoneAssetId || null;
      const targetEmpIdForIn = resolvedEmployee?.id || card.employeeId || null;

      let timeInResult;
      try {
        timeInResult = await db.$transaction(async (tx) => {
          // Acquire transaction-scoped Postgres advisory lock keyed on card.id
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${card.id}))`;

          // Re-read open transaction for THIS card/employee inside the transaction to prevent concurrent duplicate TIME_IN
          const existingOpenTx = await tx.custodyTransaction.findFirst({
            where: {
              OR: [
                { nfcCardId: card.id },
                ...(card.employeeId ? [{ employeeId: card.employeeId }] : []),
                ...(targetEmpIdForIn ? [{ employeeId: targetEmpIdForIn }] : []),
              ],
              actualReturnAt: null,
              status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
            },
            orderBy: { timestamp: "desc" },
          });

          if (existingOpenTx) {
            if (!skipDebounce) {
              return {
                duplicateBlocked: false as const,
                newTx: existingOpenTx,
              };
            }
            const elapsedMs = Math.max(0, now.getTime() - new Date(existingOpenTx.timestamp).getTime());
            const elapsedSeconds = Math.floor(elapsedMs / 1000);
            const remainingSeconds = Math.max(1, COOLDOWN_SECONDS - elapsedSeconds);
            return {
              duplicateBlocked: true as const,
              actionAttempted: "TIME_IN" as const,
              currentStatus: "TIMED_IN" as const,
              elapsedSeconds,
              remainingSeconds,
              message: `Accidental double-tap detected. Phone was Timed In ${elapsedSeconds}s ago. Please wait ${remainingSeconds}s before Timing Out.`,
            };
          }

          // Re-check cooldown on most recent closed transaction for this card/employee inside the transaction
          const latestClosedTx = await tx.custodyTransaction.findFirst({
            where: {
              OR: [
                { nfcCardId: card.id },
                ...(targetEmpIdForIn ? [{ employeeId: targetEmpIdForIn }] : []),
              ],
              actualReturnAt: { not: null },
            },
            orderBy: { actualReturnAt: "desc" },
          });

          if (latestClosedTx && latestClosedTx.actualReturnAt) {
            const elapsedMs = now.getTime() - new Date(latestClosedTx.actualReturnAt).getTime();
            const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
            if (elapsedMs >= -500 && elapsedSeconds < COOLDOWN_SECONDS) {
              const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
              return {
                duplicateBlocked: true as const,
                actionAttempted: "TIME_IN" as const,
                currentStatus: "TIMED_OUT" as const,
                elapsedSeconds,
                remainingSeconds,
                closedTxForIdempotentResponse: latestClosedTx,
                message: `Accidental double-tap detected. Phone was Timed Out ${elapsedSeconds}s ago. Please wait ${remainingSeconds}s before Timing In again.`,
              };
            }
          }

          // Ensure targetPhoneIdForIn is not concurrently checked out by another employee
          if (targetPhoneIdForIn) {
            const phoneInUse = await tx.custodyTransaction.findFirst({
              where: {
                phoneAssetId: targetPhoneIdForIn,
                actualReturnAt: null,
                status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
              },
              select: { id: true },
            });
            if (phoneInUse) {
              const fallbackPhone = await tx.phoneAsset.findFirst({
                where: {
                  custodyStatus: "AVAILABLE",
                  isActive: true,
                  transactions: {
                    none: {
                      actualReturnAt: null,
                      status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
                    },
                  },
                },
                orderBy: { assetTag: "asc" },
              });
              targetPhoneIdForIn = fallbackPhone?.id || null;
              if (fallbackPhone) {
                resolvedPhoneAsset = fallbackPhone;
              }
            }
          }

          if (targetPhoneIdForIn) {
            await tx.phoneAsset.update({
              where: { id: targetPhoneIdForIn },
              data: { custodyStatus: "ISSUED" },
            });
          }

          const createdTx = await tx.custodyTransaction.create({
            data: {
              transactionCode: txCode,
              transactionType: "TIME_IN",
              status: "ISSUED",
              nfcCardId: card.id,
              phoneAssetId: targetPhoneIdForIn,
              employeeId: targetEmpIdForIn,
              timestamp: now,
              returnDeadlineAt: twentyFourHourDeadline,
              conditionAtAction: "GOOD",
              verifiedViaNfc: true,
            },
          });

          if (
            process.env.NODE_ENV !== "production" &&
            process.env.CPT_TEST_FAIL_AFTER_TX_CREATE === "1"
          ) {
            throw new Error("Simulated failure mid-transaction after custodyTransaction.create");
          }

          if (targetPhoneIdForIn && targetEmpIdForIn) {
            await tx.returnDeadline.create({
              data: {
                custodyTransactionId: createdTx.id,
                phoneAssetId: targetPhoneIdForIn,
                employeeId: targetEmpIdForIn,
                expectedReturnAt: twentyFourHourDeadline,
                originalExpectedReturnAt: twentyFourHourDeadline,
                status: "PENDING",
                gracePeriodMinutes: 0,
              },
            });
          }

          return {
            duplicateBlocked: false as const,
            newTx: createdTx,
          };
        });
      } catch (txErr: any) {
        const errCode = txErr?.code || "";
        const errMsg = String(txErr?.message || "");
        if (errCode === "P2002" || errMsg.includes("23505") || errMsg.toLowerCase().includes("unique constraint")) {
          if (!skipDebounce) {
            const existingTx = await db.custodyTransaction.findFirst({
              where: { nfcCardId: card.id, actualReturnAt: null },
              orderBy: { timestamp: "desc" },
            });
            if (existingTx) {
              return buildTimeInConfirmationResponse(existingTx);
            }
          }
          return NextResponse.json({
            success: false,
            cooldownBlocked: true,
            caseType: "CASE_DOUBLE_TAP_PREVENTED",
            actionAttempted: "TIME_IN",
            currentStatus: "TIMED_IN",
            phoneName: phoneDisplayName,
            cardUid: card.cardUid,
            ownerName,
            employee: employeePayload,
            elapsedSeconds: 0,
            remainingSeconds: COOLDOWN_SECONDS,
            cooldownSeconds: COOLDOWN_SECONDS,
            message: `Accidental double-tap detected. Phone was Timed In 0s ago. Please wait ${COOLDOWN_SECONDS}s before Timing Out.`,
          });
        }
        throw txErr;
      }

      if (timeInResult.duplicateBlocked) {
        if (!skipDebounce && (timeInResult as any).closedTxForIdempotentResponse) {
          return buildTimeOutConfirmationResponse((timeInResult as any).closedTxForIdempotentResponse);
        }
        return NextResponse.json({
          success: false,
          cooldownBlocked: true,
          caseType: "CASE_DOUBLE_TAP_PREVENTED",
          actionAttempted: timeInResult.actionAttempted,
          currentStatus: timeInResult.currentStatus,
          phoneName: phoneDisplayName,
          cardUid: card.cardUid,
          ownerName,
          employee: employeePayload,
          elapsedSeconds: timeInResult.elapsedSeconds,
          remainingSeconds: timeInResult.remainingSeconds,
          cooldownSeconds: COOLDOWN_SECONDS,
          message: timeInResult.message,
        });
      }

      const { newTx } = timeInResult;
      return buildTimeInConfirmationResponse(newTx);
    } else {
      // Cooldown check for TIME_OUT attempt:
      // If phone was just Timed In within COOLDOWN_SECONDS, return idempotent TIME_IN confirmation for real kiosk taps (!skipDebounce)
      const elapsedMs = now.getTime() - new Date(openTransaction.timestamp).getTime();
      const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

      if (elapsedMs >= -500 && elapsedSeconds < COOLDOWN_SECONDS) {
        if (!skipDebounce) {
          return buildTimeInConfirmationResponse(openTransaction);
        }
        const remainingSeconds = COOLDOWN_SECONDS - elapsedSeconds;
        return NextResponse.json({
          success: false,
          cooldownBlocked: true,
          caseType: "CASE_DOUBLE_TAP_PREVENTED",
          actionAttempted: "TIME_OUT",
          currentStatus: "TIMED_IN",
          phoneName: phoneDisplayName,
          cardUid: card.cardUid,
          ownerName,
          employee: employeePayload,
          elapsedSeconds,
          remainingSeconds,
          cooldownSeconds: COOLDOWN_SECONDS,
          message: `Accidental double-tap detected. Phone was Timed In ${elapsedSeconds}s ago. Please wait ${remainingSeconds}s before Timing Out.`,
        });
      }

      // ===== TIME OUT (Atomic Transaction) =====
      const timeOutTxCode = `CTX-OUT-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const timeOutResult = await db.$transaction(async (tx) => {
        // Acquire transaction-scoped Postgres advisory lock keyed on card.id
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${card.id}))`;

        // Re-read ALL open transactions for this card / employee inside the transaction
        const openTxs = await tx.custodyTransaction.findMany({
          where: {
            OR: [
              { nfcCardId: card.id },
              ...(card.employeeId ? [{ employeeId: card.employeeId }] : []),
              ...(resolvedEmployee?.id ? [{ employeeId: resolvedEmployee.id }] : []),
              ...(card.phoneAssetId ? [{ phoneAssetId: card.phoneAssetId }] : []),
            ],
            actualReturnAt: null,
            status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
          },
          include: {
            employee: {
              include: { department: true },
            },
            phoneAsset: true,
          },
          orderBy: { timestamp: "desc" },
        });

        const currentOpenTx = openTxs[0];

        if (!currentOpenTx) {
          return {
            duplicateBlocked: true as const,
            actionAttempted: "TIME_OUT" as const,
            currentStatus: "TIMED_OUT" as const,
            elapsedSeconds: 0,
            remainingSeconds: COOLDOWN_SECONDS,
            message: `Accidental double-tap detected. Phone was Timed Out 0s ago. Please wait ${COOLDOWN_SECONDS}s before Timing In again.`,
          };
        }

        const txElapsedMs = now.getTime() - new Date(currentOpenTx.timestamp).getTime();
        const txElapsedSeconds = Math.max(0, Math.floor(txElapsedMs / 1000));

        if (txElapsedMs >= -500 && txElapsedSeconds < COOLDOWN_SECONDS) {
          const remainingSeconds = COOLDOWN_SECONDS - txElapsedSeconds;
          return {
            duplicateBlocked: true as const,
            actionAttempted: "TIME_OUT" as const,
            currentStatus: "TIMED_IN" as const,
            elapsedSeconds: txElapsedSeconds,
            remainingSeconds,
            openTxForIdempotentResponse: currentOpenTx,
            message: `Accidental double-tap detected. Phone was Timed In ${txElapsedSeconds}s ago. Please wait ${remainingSeconds}s before Timing Out.`,
          };
        }

        const durationSeconds = Math.max(1, Math.round(txElapsedMs / 1000));
        const durationMinutes = Math.max(1, Math.round(txElapsedMs / 60000));
        const formattedDuration = formatDuration(durationSeconds);
        const targetPhoneId =
          currentOpenTx.phoneAssetId || resolvedPhoneAsset?.id || card.phoneAssetId || null;
        const isLateAfter24h = txElapsedMs >= 24 * 60 * 60 * 1000;
        const returnStatusVal = isLateAfter24h ? "LATE" : "ON_TIME";
        const overdueMinutesVal = isLateAfter24h
          ? Math.max(1, Math.floor((txElapsedMs - 24 * 60 * 60 * 1000) / 60000))
          : 0;

        const allOpenTxIds = openTxs.map((t) => t.id);
        const allOpenPhoneIds = Array.from(
          new Set(
            [...openTxs.map((t) => t.phoneAssetId), targetPhoneId].filter(
              (id): id is string => Boolean(id)
            )
          )
        );

        // Close all open transactions for this employee/card so no orphan open Time-Ins remain
        const closeRes = await tx.custodyTransaction.updateMany({
          where: {
            id: { in: allOpenTxIds },
            actualReturnAt: null,
          },
          data: {
            actualReturnAt: now,
            status: "RETURNED",
            returnStatus: returnStatusVal,
            custodyDurationMinutes: durationMinutes,
            overdueMinutes: overdueMinutesVal,
          },
        });

        if (closeRes.count < 1) {
          return {
            duplicateBlocked: true as const,
            actionAttempted: "TIME_OUT" as const,
            currentStatus: "TIMED_OUT" as const,
            elapsedSeconds: 0,
            remainingSeconds: COOLDOWN_SECONDS,
            message: `Accidental double-tap detected. Phone was Timed Out 0s ago. Please wait ${COOLDOWN_SECONDS}s before Timing In again.`,
          };
        }

        if (allOpenPhoneIds.length > 0) {
          await tx.phoneAsset.updateMany({
            where: { id: { in: allOpenPhoneIds } },
            data: { custodyStatus: "AVAILABLE" },
          });
        }

        const timeOutTx = await tx.custodyTransaction.create({
          data: {
            transactionCode: timeOutTxCode,
            transactionType: "TIME_OUT",
            status: "RETURNED",
            returnStatus: returnStatusVal,
            custodyDurationMinutes: durationMinutes,
            overdueMinutes: overdueMinutesVal,
            phoneAssetId: targetPhoneId,
            employeeId: currentOpenTx.employeeId || resolvedEmployee?.id || null,
            nfcCardId: card.id,
            timestamp: now,
            actualReturnAt: now,
            conditionAtAction: "GOOD",
            verifiedViaNfc: true,
            remarks: "NFC Kiosk Turnstile Time Out",
          },
        });

        if (
          process.env.NODE_ENV !== "production" &&
          process.env.CPT_TEST_FAIL_AFTER_TX_CREATE === "1"
        ) {
          throw new Error("Simulated failure mid-transaction after custodyTransaction.create");
        }

        await tx.returnDeadline.updateMany({
          where: { custodyTransactionId: { in: allOpenTxIds } },
          data: {
            status: isLateAfter24h ? "RETURNED_LATE" : "RETURNED_ON_TIME",
            actualReturnAt: now,
          },
        });

        await tx.overdueCase.updateMany({
          where: {
            custodyTransactionId: { in: allOpenTxIds },
            status: { in: ["OPEN", "ESCALATED"] },
          },
          data: {
            status: "RESOLVED",
            resolvedAt: now,
            resolutionType: "SURRENDERED",
          },
        });

        return {
          duplicateBlocked: false as const,
          timeOutTx,
          closedOpenTx: currentOpenTx,
          durationMinutes,
          durationSeconds,
          formattedDuration,
          targetPhoneId,
        };
      });

      if (timeOutResult.duplicateBlocked) {
        if (!skipDebounce) {
          if ((timeOutResult as any).openTxForIdempotentResponse) {
            return buildTimeInConfirmationResponse((timeOutResult as any).openTxForIdempotentResponse);
          }
          const latestClosed = await db.custodyTransaction.findFirst({
            where: { nfcCardId: card.id, actualReturnAt: { not: null } },
            orderBy: { actualReturnAt: "desc" },
          });
          if (latestClosed) {
            return buildTimeOutConfirmationResponse(latestClosed);
          }
        }
        return NextResponse.json({
          success: false,
          cooldownBlocked: true,
          caseType: "CASE_DOUBLE_TAP_PREVENTED",
          actionAttempted: timeOutResult.actionAttempted,
          currentStatus: timeOutResult.currentStatus,
          phoneName: phoneDisplayName,
          cardUid: card.cardUid,
          ownerName,
          employee: employeePayload,
          elapsedSeconds: timeOutResult.elapsedSeconds,
          remainingSeconds: timeOutResult.remainingSeconds,
          cooldownSeconds: COOLDOWN_SECONDS,
          message: timeOutResult.message,
        });
      }

      const {
        timeOutTx,
        closedOpenTx,
        durationMinutes,
        durationSeconds,
        formattedDuration,
        targetPhoneId,
      } = timeOutResult;

      const timedInDisplay = new Date(closedOpenTx.timestamp).toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const timedOutDisplay = now.toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      return NextResponse.json({
        success: true,
        action: "TIME_OUT",
        caseType: "CASE_B_SURRENDER",
        phoneName: phoneDisplayName,
        cardUid: card.cardUid,
        transactionCode: timeOutTx.transactionCode,
        timedInAt: closedOpenTx.timestamp.toISOString(),
        timedInDisplay,
        timedOutAt: now.toISOString(),
        timedOutDisplay,
        durationMinutes,
        durationSeconds,
        durationFormatted: formattedDuration,
        status: "TIMED_OUT",
        message: "PHONE SUCCESSFULLY TIMED OUT",
        ownerName,
        card: {
          id: card.id,
          cardUid: card.cardUid,
          cardNumber: card.cardNumber,
        },
        phone: {
          id: resolvedPhoneAsset?.id || targetPhoneId || card.id,
          assetTag: resolvedPhoneAsset?.assetTag || closedOpenTx.phoneAsset?.assetTag || phoneDisplayName,
          brand: "OUKITEL",
          model: "OUKITEL G1",
        },
        employee: employeePayload,
        timeIn: {
          enabled: true,
          action: "TIME_IN",
          label: "TIME IN",
        },
        timeOut: {
          enabled: false,
          action: "TIME_OUT",
          label: "TIME OUT",
          reason: "Device is already returned and in depot.",
        },
      });
    }
  } catch (error: any) {
    if (normalizedUidForCleanup) {
      clearScanDebounce(normalizedUidForCleanup);
    }
    console.error("[POST /api/kiosk/resolve] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Please tap again",
        message: "Please tap again",
      },
      { status: 500 }
    );
  }
}
