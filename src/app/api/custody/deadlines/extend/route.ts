import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestDeadlineExtension } from "@/lib/overdue/deadlines";
import { CustodyError } from "@/lib/custody/engine";

const extendSchema = z.object({
  transactionId: z.string().min(1, "Custody Transaction ID is required"),
  extensionMinutes: z.number().int().min(1, "Extension minutes must be at least 1"),
  reason: z.string().min(5, "Extension justification must be at least 5 characters"),
  requestedBy: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = extendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 400 });
    }

    const result = await requestDeadlineExtension({
      transactionId: parsed.data.transactionId,
      extensionMinutes: parsed.data.extensionMinutes,
      reason: parsed.data.reason,
      approvedByUserId: session?.userId || null,
      requestedBy: parsed.data.requestedBy || session?.fullName || null,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/custody/deadlines/extend] Error:", error);
    return NextResponse.json({ error: "Failed to extend deadline", details: error.message }, { status: 500 });
  }
}
