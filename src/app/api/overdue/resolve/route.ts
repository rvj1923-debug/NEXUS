import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { resolveOverdueCase } from "@/lib/overdue/engine";
import { CustodyError } from "@/lib/custody/engine";

const resolveSchema = z.object({
  caseId: z.string().min(1, "Case ID is required"),
  resolutionType: z.enum(["SURRENDERED", "REPORTED_LOST", "EXCUSED", "ESCALATED_HR"]),
  resolutionNotes: z.string().min(5, "Resolution notes must be at least 5 characters"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 400 });
    }

    const userId = session?.userId || "SYSTEM";

    const result = await resolveOverdueCase({
      caseId: parsed.data.caseId,
      userId,
      resolutionType: parsed.data.resolutionType,
      resolutionNotes: parsed.data.resolutionNotes,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/overdue/resolve] Error:", error);
    return NextResponse.json({ error: "Failed to resolve case", details: error.message }, { status: 500 });
  }
}
