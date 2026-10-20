import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { normalizeNfcUid, isDebouncedScan } from "@/lib/nfc/normalization";

const testScanSchema = z.object({
  rawInput: z.string().min(1, "Scan input is required"),
  readerIdentifier: z.string().optional(),
  readerId: z.string().optional(),
  debounceWindowMs: z.number().optional().default(1500),
});

export async function GET() {
  const sessionOrRes = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
  if (sessionOrRes instanceof NextResponse) {
    return sessionOrRes;
  }
  return NextResponse.json({
    success: true,
    message: "NFC Reader test endpoint ready. Submit POST with { rawInput } to test normalization.",
  });
}

export async function POST(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const body = await req.json();
    const parsed = testScanSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { rawInput, readerIdentifier, readerId, debounceWindowMs } = parsed.data;

    // Check debounce suppression
    const debounced = isDebouncedScan(rawInput, debounceWindowMs);

    // Normalize UID
    const norm = normalizeNfcUid(rawInput);

    if (!norm.isValid) {
      // Record reader error if reader is referenced
      if (readerId || readerIdentifier) {
        const where = readerId ? { id: readerId } : { readerIdentifier };
        await db.nfcReader.updateMany({
          where,
          data: { lastError: `Invalid scan format: ${rawInput.slice(0, 30)}` },
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: "Unrecognized NFC card format",
          rawInput,
          details: "Input could not be normalized into a standard 4, 7, 8, or 10-byte NFC UID.",
        },
        { status: 422 }
      );
    }

    // If debounced duplicate
    if (debounced) {
      return NextResponse.json({
        success: true,
        debounced: true,
        message: "Duplicate scan suppressed by debounce filter (1500ms).",
        normalizedUid: norm.normalizedUid,
        specificCardNumber: norm.specificCardNumber,
      });
    }

    // Update reader's lastScannedAt
    if (readerId || readerIdentifier) {
      const where = readerId ? { id: readerId } : { readerIdentifier };
      await db.nfcReader.updateMany({
        where,
        data: {
          lastScannedAt: new Date(),
          lastError: null,
          status: "ONLINE",
        },
      });
    }

    // Check if card is registered in database (supports both normalized hex and raw decimal)
    const card = await db.nfcCard.findFirst({
      where: {
        OR: [
          { cardUid: norm.normalizedUid },
          { cardUid: rawInput.trim() },
          { cardNumber: norm.specificCardNumber },
          { cardNumber: `SN-${rawInput.trim()}` },
          { cardNumber: rawInput.trim() },
        ],
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      debounced: false,
      rawInput,
      normalizedUid: norm.normalizedUid,
      specificCardNumber: norm.specificCardNumber,
      format: norm.format,
      byteLength: norm.byteLength,
      technologyStandard: norm.technologyStandard,
      registered: !!card,
      cardDetails: card
        ? {
            id: card.id,
            cardNumber: card.cardNumber,
            status: card.status,
            employee: card.employee
              ? {
                  id: card.employee.id,
                  code: card.employee.employeeCode,
                  name: `${card.employee.firstName} ${card.employee.lastName}`,
                  department: card.employee.department?.name,
                }
              : null,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[POST /api/readers/test] Error:", error);
    return NextResponse.json(
      { error: "Reader test failed", details: error.message },
      { status: 500 }
    );
  }
}
