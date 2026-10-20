import { NextRequest, NextResponse } from "next/server";
import { generateCustodyReport, ReportFilterOptions } from "@/lib/reports/engine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const options: ReportFilterOptions = {
      dateFilter: (searchParams.get("dateFilter") as any) || "TODAY",
      customStart: searchParams.get("customStart") || undefined,
      customEnd: searchParams.get("customEnd") || undefined,
      departmentId: searchParams.get("departmentId") || undefined,
      employeeId: searchParams.get("employeeId") || undefined,
      phoneAssetId: searchParams.get("phoneAssetId") || undefined,
      status: searchParams.get("status") || undefined,
      custodianId: searchParams.get("custodianId") || undefined,
      grouping: (searchParams.get("grouping") as any) || "NONE",
    };

    const reportData = await generateCustodyReport(options);
    return NextResponse.json(reportData);
  } catch (error: any) {
    console.error("[GET /api/reports/custody] Error:", error);
    return NextResponse.json({ error: "Failed to generate custody report", details: error.message }, { status: 500 });
  }
}
