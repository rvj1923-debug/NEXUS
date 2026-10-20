import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { grantTemporaryExemption } from "@/lib/overdue/deadlines";
import { CustodyError } from "@/lib/custody/engine";

const exemptSchema = z.object({
  transactionId: z.string().min(1, "Custody Transaction ID is required"),
  reason: z.string().min(5, "Exemption reason must be at least 5 characters"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = exemptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 400 });
    }

    const result = await grantTemporaryExemption({
      transactionId: parsed.data.transactionId,
      reason: parsed.data.reason,
      approvedByUserId: session?.userId || null,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/custody/deadlines/exempt] Error:", error);
    return NextResponse.json({ error: "Failed to grant exemption", details: error.message }, { status: 500 });
  }
}
