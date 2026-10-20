import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { removeIncidentReportByHr, resolveOverdueCase } from "@/lib/overdue/engine";
import { CustodyError } from "@/lib/custody/engine";

const hrIncidentActionSchema = z.object({
  caseId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  action: z.enum(["OPEN", "CLOSE"]).optional().default("CLOSE"),
  proofImage: z.string().nullable().optional(),
  hrOfficerName: z.string().optional(),
  hrEmail: z.string().optional(),
  hrOfficerEmail: z.string().optional(),
  remarks: z.string().optional(),
  hrRemarks: z.string().optional(),
  alsoResolveCase: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const body = await req.json();

    const parsed = hrIncidentActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    if (!parsed.data.caseId && !parsed.data.employeeId) {
      return NextResponse.json(
        { error: "Overdue Case ID or Employee ID is required" },
        { status: 400 }
      );
    }

    const resolvedEmail =
      parsed.data.hrEmail ||
      parsed.data.hrOfficerEmail ||
      session?.email ||
      "hr@company.com";
    const resolvedRemarks = parsed.data.remarks || parsed.data.hrRemarks || "";

    const result = await removeIncidentReportByHr({
      caseId: parsed.data.caseId,
      employeeId: parsed.data.employeeId,
      userId: session?.userId || null,
      action: parsed.data.action,
      proofImage: parsed.data.proofImage || null,
      hrOfficerName: parsed.data.hrOfficerName || session?.fullName || "HR Department Admin",
      hrEmail: resolvedEmail,
      remarks: resolvedRemarks,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof CustodyError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[POST /api/overdue/hr-remove-incident] Error:", error);
    return NextResponse.json(
      { error: "Failed to update Incident Report status", details: error.message },
      { status: 500 }
    );
  }
}
