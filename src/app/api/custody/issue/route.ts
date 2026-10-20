import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { issuePhone, CustodyError } from "@/lib/custody/engine";

const issueSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  phoneAssetId: z.string().min(1, "Phone Asset ID is required"),
  nfcCardId: z.string().optional().nullable(),
  nfcReaderId: z.string().optional().nullable(),
  conditionAtAction: z.string().default("GOOD"),
  accessoriesIssued: z.string().optional().default("Phone, Charger, Case"),
  remarks: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
  isManualOverride: z.boolean().optional().default(false),
  overrideReason: z.string().optional().nullable(),
  verifiedViaNfc: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = issueSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const headerIdempotency = req.headers.get("idempotency-key");
    const idempotencyKey = headerIdempotency || parsed.data.idempotencyKey;

    const result = await issuePhone({
      ...parsed.data,
      idempotencyKey,
      handledByUserId: session?.userId || null,
    });

    return NextResponse.json(result, { status: result.isDuplicate ? 200 : 201 });
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    console.error("[POST /api/custody/issue] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to issue device", details: error.message },
      { status: 500 }
    );
  }
}
