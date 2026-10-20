import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}m`;
}

export async function GET(req: NextRequest) {
  try {
    // Authenticate session (KIOSK, SYSTEM_ADMIN, or PHONE_CUSTODIAN required)
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      session.roleCode !== "KIOSK" &&
      session.roleCode !== "SYSTEM_ADMIN" &&
      session.roleCode !== "PHONE_CUSTODIAN"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") || "15", 10)));

    const transactions = await db.custodyTransaction.findMany({
      take: limit,
      orderBy: { timestamp: "desc" },
      include: {
        employee: {
          include: { department: true },
        },
        phoneAsset: {
          include: { department: true },
        },
        nfcCard: {
          include: { phoneAsset: true },
        },
      },
    });

    const logs = transactions.map((tx) => {
      const isTimeIn = tx.transactionType === "TIME_IN" || tx.transactionType === "ISSUANCE";
      const resolvedPhone = tx.phoneAsset || tx.nfcCard?.phoneAsset;

      const employeeName = tx.employee
        ? `${tx.employee.firstName} ${tx.employee.lastName}`
        : "Unassigned Personnel";

      const phoneTag = resolvedPhone?.assetTag || tx.nfcCard?.cardNumber || "NFC Device";

      return {
        id: tx.id,
        transactionCode: tx.transactionCode,
        action: isTimeIn ? "TIME_IN" : "TIME_OUT",
        status: tx.status,
        timestamp: tx.timestamp.toISOString(),
        employeeName,
        employeeCode: tx.employee?.employeeCode || "N/A",
        department: tx.employee?.department?.name || "General Fleet",
        phoneAssetTag: phoneTag,
        phoneModel: resolvedPhone?.model || "OUKITEL G1",
        custodyDurationMinutes: tx.custodyDurationMinutes,
        formattedDuration: formatDuration(tx.custodyDurationMinutes),
      };
    });

    return NextResponse.json({
      success: true,
      logs,
      count: logs.length,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error retrieving kiosk recent logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent turnstile logs", details: error.message },
      { status: 500 }
    );
  }
}
