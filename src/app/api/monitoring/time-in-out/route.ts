import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const typeFilter = searchParams.get("type") || "ALL"; // ALL, TIME_IN, TIME_OUT
    const statusFilter = searchParams.get("status") || "ALL"; // ALL, ISSUED, RETURNED, OVERDUE
    const search = searchParams.get("search")?.trim() || "";
    const departmentId = searchParams.get("departmentId") || "";
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    // Compute today start (00:00:00 local time)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Build where clause
    const where: any = {};

    // Filter by transaction type
    if (typeFilter === "TIME_IN") {
      where.transactionType = { in: ["TIME_IN", "ISSUANCE"] };
    } else if (typeFilter === "TIME_OUT") {
      where.transactionType = { in: ["TIME_OUT", "SURRENDER"] };
    }

    // Filter by status
    if (statusFilter === "ISSUED") {
      where.status = { in: ["ISSUED", "TIME_IN"] };
    } else if (statusFilter === "RETURNED") {
      where.status = "RETURNED";
    } else if (statusFilter === "OVERDUE") {
      where.status = "OVERDUE";
    }

    // Department filtering
    if (departmentId) {
      where.employee = { departmentId };
    }

    // Search query
    if (search) {
      where.OR = [
        { transactionCode: { contains: search, mode: "insensitive" } },
        { employee: { firstName: { contains: search, mode: "insensitive" } } },
        { employee: { lastName: { contains: search, mode: "insensitive" } } },
        { employee: { employeeCode: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { assetTag: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { model: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { imei: { contains: search, mode: "insensitive" } } },
        { nfcCard: { cardUid: { contains: search, mode: "insensitive" } } },
        { nfcCard: { cardNumber: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Query live feed transactions
    const [
      transactions,
      currentlyActive,
      timedInToday,
      timedOutToday,
      overdueCount,
      totalPhones,
      availablePhones,
      completedToday,
    ] = await Promise.all([
      db.custodyTransaction.findMany({
        where,
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
          nfcReader: true,
          overdueCases: {
            where: { status: { in: ["OPEN", "ESCALATED"] } },
            take: 1,
          },
        },
      }),
      // Count currently active devices checked out
      db.phoneAsset.count({
        where: { custodyStatus: "ISSUED", isActive: true },
      }),
      // Timed in today
      db.custodyTransaction.count({
        where: {
          transactionType: { in: ["TIME_IN", "ISSUANCE"] },
          timestamp: { gte: todayStart },
        },
      }),
      // Timed out today
      db.custodyTransaction.count({
        where: {
          transactionType: { in: ["TIME_OUT", "SURRENDER"] },
          timestamp: { gte: todayStart },
        },
      }),
      // Overdue
      db.overdueCase.count({
        where: { status: { in: ["OPEN", "ESCALATED"] } },
      }),
      // Total phones
      db.phoneAsset.count({ where: { isActive: true } }),
      // Available phones
      db.phoneAsset.count({ where: { custodyStatus: "AVAILABLE", isActive: true } }),
      // Calculate average custody duration for returns today
      db.custodyTransaction.findMany({
        where: {
          transactionType: { in: ["TIME_OUT", "SURRENDER"] },
          timestamp: { gte: todayStart },
          custodyDurationMinutes: { not: null, gt: 0 },
        },
        select: { custodyDurationMinutes: true },
      }),
    ]);

    // Average custody duration in minutes
    let avgDurationMinutes = 0;
    if (completedToday.length > 0) {
      const sum = completedToday.reduce((acc, t) => acc + (t.custodyDurationMinutes || 0), 0);
      avgDurationMinutes = Math.round(sum / completedToday.length);
    }

    // Format events with resolved phone references
    const events = transactions.map((tx) => {
      const resolvedPhone =
        tx.phoneAsset ||
        tx.nfcCard?.phoneAsset ||
        null;

      const isTimeIn = tx.transactionType === "TIME_IN" || tx.transactionType === "ISSUANCE";

      return {
        id: tx.id,
        transactionCode: tx.transactionCode,
        transactionType: isTimeIn ? "TIME_IN" : "TIME_OUT",
        status: tx.status,
        timestamp: tx.timestamp.toISOString(),
        actualReturnAt: tx.actualReturnAt ? tx.actualReturnAt.toISOString() : null,
        returnStatus: tx.returnStatus || (isTimeIn ? null : "ON_TIME"),
        custodyDurationMinutes: tx.custodyDurationMinutes,
        overdueMinutes: tx.overdueMinutes,
        conditionAtAction: tx.conditionAtAction,
        verifiedViaNfc: tx.verifiedViaNfc,
        phoneAsset: resolvedPhone
          ? {
              id: resolvedPhone.id,
              assetTag: resolvedPhone.assetTag,
              brand: resolvedPhone.brand || "OUKITEL",
              model: resolvedPhone.model || "OUKITEL G1",
              imei: resolvedPhone.imei,
              color: resolvedPhone.color,
              custodyStatus: resolvedPhone.custodyStatus,
            }
          : tx.nfcCard
          ? {
              id: tx.nfcCard.id,
              assetTag: tx.nfcCard.cardNumber || tx.nfcCard.cardUid,
              brand: "OUKITEL",
              model: "OUKITEL G1",
              imei: "N/A",
              color: null,
              custodyStatus: tx.status,
            }
          : null,
        employee: tx.employee
          ? {
              id: tx.employee.id,
              employeeCode: tx.employee.employeeCode,
              fullName: `${tx.employee.firstName} ${tx.employee.lastName}`,
              firstName: tx.employee.firstName,
              lastName: tx.employee.lastName,
              departmentName: tx.employee.department?.name || "General",
              departmentCode: tx.employee.department?.code || "GEN",
            }
          : null,
        nfcReader: tx.nfcReader
          ? {
              id: tx.nfcReader.id,
              name: tx.nfcReader.name,
              location: tx.nfcReader.location,
              readerIdentifier: tx.nfcReader.readerIdentifier,
            }
          : {
              name: "NFC Depot Station",
              location: "Main Gate Turnstile",
              readerIdentifier: (process.env.KIOSK_CODE || "").trim() || "UNASSIGNED",
            },
        nfcCard: tx.nfcCard
          ? {
              cardUid: tx.nfcCard.cardUid,
              cardNumber: tx.nfcCard.cardNumber,
            }
          : null,
        hasOverdueCase: (tx.overdueCases?.length || 0) > 0,
      };
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        currentlyActive,
        timedInToday,
        timedOutToday,
        overdueCount,
        totalPhones,
        availablePhones,
        avgDurationMinutes,
      },
      events,
    });
  } catch (error: any) {
    console.error("[API /monitoring/time-in-out] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
