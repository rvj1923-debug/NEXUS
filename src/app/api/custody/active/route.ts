import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const departmentId = searchParams.get("departmentId");

    const where: any = {
      status: "ISSUED",
      transactionType: { in: ["ISSUANCE", "TIME_IN"] },
    };

    if (departmentId) {
      where.employee = { departmentId };
    }

    const activeTransactions = await db.custodyTransaction.findMany({
      where,
      orderBy: { timestamp: "desc" },
      include: {
        employee: {
          include: { department: true, shifts: { where: { isActive: true }, take: 1 } },
        },
        phoneAsset: true,
        nfcCard: true,
        nfcReader: true,
        returnDeadline: true,
      },
    });

    const now = new Date();

    const formatted = activeTransactions.map((tx) => {
      const issuedAt = new Date(tx.timestamp);
      const deadlineAt = tx.returnDeadlineAt ? new Date(tx.returnDeadlineAt) : null;
      const isOverdue = deadlineAt ? now.getTime() > deadlineAt.getTime() : false;
      const overdueMinutes = isOverdue && deadlineAt ? Math.floor((now.getTime() - deadlineAt.getTime()) / 60000) : 0;
      const custodyMinutes = Math.floor((now.getTime() - issuedAt.getTime()) / 60000);

      return {
        id: tx.id,
        transactionCode: tx.transactionCode,
        timestamp: tx.timestamp,
        returnDeadlineAt: tx.returnDeadlineAt,
        conditionAtAction: tx.conditionAtAction,
        accessoriesIssued: tx.accessoriesIssued,
        remarks: tx.remarks,
        isManualOverride: tx.isManualOverride,
        employee: tx.employee ? {
          id: tx.employee.id,
          employeeCode: tx.employee.employeeCode,
          name: `${tx.employee.firstName} ${tx.employee.lastName}`,
          department: tx.employee.department?.name || "General",
          departmentCode: tx.employee.department?.code || "GEN",
        } : null,
        phoneAsset: tx.phoneAsset ? {
          id: tx.phoneAsset.id,
          assetTag: tx.phoneAsset.assetTag,
          brand: "",
          model: "",
          imei: tx.phoneAsset.imei,
          custodyStatus: tx.phoneAsset.custodyStatus,
        } : {
          id: tx.nfcCard?.id || tx.id,
          assetTag: tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`,
          brand: "",
          model: "",
          imei: "",
          custodyStatus: "ISSUED",
        },
        reader: tx.nfcReader?.name || "Direct / Kiosk",
        isOverdue,
        overdueMinutes,
        custodyMinutes,
      };
    });

    return NextResponse.json({
      success: true,
      count: formatted.length,
      activeCustody: formatted,
    });
  } catch (error: any) {
    console.error("[GET /api/custody/active] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch active custody", details: error.message },
      { status: 500 }
    );
  }
}
