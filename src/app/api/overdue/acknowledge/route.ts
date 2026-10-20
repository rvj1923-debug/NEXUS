import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { acknowledgeOverdueCase } from "@/lib/overdue/engine";
import { CustodyError } from "@/lib/custody/engine";

const ackSchema = z.object({
  caseId: z.string().min(1, "Case ID is required"),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = ackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 400 });
    }

    const userId = session?.userId || "SYSTEM";

    const result = await acknowledgeOverdueCase({
      caseId: parsed.data.caseId,
      userId,
      notes: parsed.data.notes,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/overdue/acknowledge] Error:", error);
    return NextResponse.json({ error: "Failed to acknowledge case", details: error.message }, { status: 500 });
  }
}
