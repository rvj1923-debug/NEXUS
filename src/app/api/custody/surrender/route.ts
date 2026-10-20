import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { surrenderPhone, CustodyError } from "@/lib/custody/engine";

const surrenderSchema = z.object({
  transactionId: z.string().optional().nullable(),
  phoneAssetId: z.string().optional().nullable(),
  employeeId: z.string().optional().nullable(),
  nfcReaderId: z.string().optional().nullable(),
  conditionAtAction: z.enum([
    "GOOD",
    "MINOR_DAMAGE",
    "MAJOR_DAMAGE",
    "NOT_FUNCTIONAL",
    "ACCESSORIES_MISSING",
  ]).default("GOOD"),
  accessoriesReturned: z.string().optional().default("All returned"),
  conditionNotes: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  photoEvidenceUrl: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
  isManualOverride: z.boolean().optional().default(false),
  overrideReason: z.string().optional().nullable(),
  surrenderedByRepresentative: z.boolean().optional().default(false),
  representativeName: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = surrenderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const headerIdempotency = req.headers.get("idempotency-key");
    const idempotencyKey = headerIdempotency || parsed.data.idempotencyKey;

    const result = await surrenderPhone({
      ...parsed.data,
      idempotencyKey,
      handledByUserId: session?.userId || null,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    console.error("[POST /api/custody/surrender] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to surrender device", details: error.message },
      { status: 500 }
    );
  }
}
