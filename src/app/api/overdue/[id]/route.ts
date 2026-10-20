import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveConfiguredHrEmail, getHrIncidentStatus } from "@/lib/overdue/engine";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const cleanRef = id.replace(/^INC-/i, "");
    const [overdueCase, configuredHrEmail] = await Promise.all([
      db.overdueCase.findFirst({
        where: {
          OR: [{ id }, { caseNumber: id }, { caseNumber: cleanRef }],
        },
        include: {
          employee: {
            include: { department: true, supervisor: true },
          },
          phoneAsset: true,
          custodyTransaction: {
            include: {
              returnDeadline: {
                include: { extensions: { orderBy: { createdAt: "desc" } } },
              },
              nfcCard: true,
            },
          },
          escalations: {
            orderBy: { createdAt: "desc" },
          },
          notifications: {
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      resolveConfiguredHrEmail(),
    ]);

    if (!overdueCase) {
      return NextResponse.json({ error: "Overdue case not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...overdueCase,
      hrEmail:
        !overdueCase.hrEmail || overdueCase.hrEmail === "hr@company.com"
          ? configuredHrEmail
          : overdueCase.hrEmail,
      defaultHrEmail: configuredHrEmail,
      ...getHrIncidentStatus(overdueCase),
    });
  } catch (error: any) {
    console.error("[GET /api/overdue/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to retrieve case", details: error.message }, { status: 500 });
  }
}
