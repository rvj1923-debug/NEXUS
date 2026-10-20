import { NextRequest, NextResponse } from "next/server";
import { scanAndProcessOverdueCases } from "@/lib/overdue/engine";

export async function POST(req: NextRequest) {
  try {
    const result = await scanAndProcessOverdueCases();
    return NextResponse.json({
      success: true,
      message: `24-hour overdue scan completed. Checked ${result.scannedCount} active checkouts. Reported ${result.newlyOverdueCount} new 24h+ overdue case(s) and notified department supervisor(s).`,
      result,
    });
  } catch (error: any) {
    console.error("[POST /api/overdue/scan] Error:", error);
    return NextResponse.json(
      { error: "Failed to perform overdue scan", details: error.message },
      { status: 500 }
    );
  }
}
