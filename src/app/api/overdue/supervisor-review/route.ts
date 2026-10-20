import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { submitSupervisorOvertimeForm } from "@/lib/overdue/engine";
import { CustodyError } from "@/lib/custody/engine";

const supervisorReviewSchema = z.object({
  caseId: z.string().min(1, "Overdue Case ID is required"),
  decision: z.enum(["APPROVED", "NOT_APPROVED"]),
  supervisorName: z.string().optional(),
  supervisorEmail: z.string().optional(),
  supervisorRemarks: z.string().min(5, "Supervisor remarks/justification must be at least 5 characters"),
  hrEmail: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = supervisorReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message || "Validation failed",
          details: parsed.error.format(),
        },
        { status: 400 }
      );
    }

    const result = await submitSupervisorOvertimeForm({
      caseId: parsed.data.caseId,
      userId: session?.userId || null,
      decision: parsed.data.decision,
      supervisorName: parsed.data.supervisorName,
      supervisorEmail: parsed.data.supervisorEmail,
      supervisorRemarks: parsed.data.supervisorRemarks,
      hrEmail: parsed.data.hrEmail,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/overdue/supervisor-review] Error:", error);
    return NextResponse.json(
      { error: "Failed to submit supervisor overtime form", details: error.message },
      { status: 500 }
    );
  }
}
