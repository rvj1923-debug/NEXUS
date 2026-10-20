import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  scanAndProcessOverdueCases,
  resolveConfiguredHrEmail,
  getHrIncidentStatus,
} from "@/lib/overdue/engine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const approvalFilter = searchParams.get("approval");
    const departmentId = searchParams.get("departmentId");
    const employeeId = searchParams.get("employeeId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Automatically ensure any 24h+ open transactions are synced into OverdueCase records
    await scanAndProcessOverdueCases().catch((err) =>
      console.warn("[GET /api/overdue] Auto-scan warning:", err.message)
    );

    const where: any = {};
    if (status && status !== "ALL") {
      if (status === "OPEN") {
        where.status = { in: ["OPEN", "ESCALATED"] };
      } else {
        where.status = status;
      }
    }
    if (approvalFilter && approvalFilter !== "ALL") {
      where.overtimeApprovalStatus = approvalFilter;
    }
    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (departmentId) {
      where.employee = { departmentId };
    }

    const [
      rawCases,
      totalCount,
      activeCount,
      resolvedCount,
      pendingFormCount,
      approvedCount,
      notApprovedCount,
      configuredHrEmail,
    ] = await Promise.all([
      db.overdueCase.findMany({
        where,
        orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
        take: limit,
        skip: offset,
        include: {
          employee: {
            include: { department: true, supervisor: true },
          },
          phoneAsset: true,
          custodyTransaction: {
            include: {
              nfcCard: true,
            },
          },
          escalations: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      }),
      db.overdueCase.count({ where }),
      db.overdueCase.count({ where: { status: { in: ["OPEN", "ESCALATED"] } } }),
      db.overdueCase.count({ where: { status: "RESOLVED" } }),
      db.overdueCase.count({ where: { overtimeApprovalStatus: "PENDING" } }),
      db.overdueCase.count({ where: { overtimeApprovalStatus: "APPROVED" } }),
      db.overdueCase.count({ where: { overtimeApprovalStatus: "NOT_APPROVED" } }),
      resolveConfiguredHrEmail(),
    ]);

    const cases = rawCases.map((c) => ({
      ...c,
      hrEmail: !c.hrEmail || c.hrEmail === "hr@company.com" ? configuredHrEmail : c.hrEmail,
      ...getHrIncidentStatus(c),
    }));

    const incidentReportIssuedCount = cases.filter((c) => c.incidentReportIssued).length;
    const incidentRemovedByHrCount = cases.filter((c) => c.incidentRemovedByHr).length;

    return NextResponse.json({
      cases,
      totalCount,
      defaultHrEmail: configuredHrEmail,
      summary: {
        open: activeCount,
        active: activeCount,
        resolved: resolvedCount,
        pendingSupervisorForm: pendingFormCount,
        overtimeApproved: approvedCount,
        overtimeNotApproved: notApprovedCount,
        incidentReportIssued: incidentReportIssuedCount,
        incidentRemovedByHr: incidentRemovedByHrCount,
      },
    });
  } catch (error: any) {
    console.error("[GET /api/overdue] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve overdue cases", details: error.message },
      { status: 500 }
    );
  }
}
