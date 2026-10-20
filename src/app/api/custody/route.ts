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
    const status = searchParams.get("status");
    const transactionType = searchParams.get("transactionType");
    const employeeId = searchParams.get("employeeId");
    const phoneAssetId = searchParams.get("phoneAssetId");
    const departmentId = searchParams.get("departmentId");
    const returnStatus = searchParams.get("returnStatus");
    const search = searchParams.get("search")?.trim();
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status && status !== "ALL") {
      where.status = status;
    }
    if (transactionType && transactionType !== "ALL") {
      where.transactionType = transactionType;
    }
    if (returnStatus && returnStatus !== "ALL") {
      where.returnStatus = returnStatus;
    }
    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (phoneAssetId) {
      where.phoneAssetId = phoneAssetId;
    }
    if (departmentId) {
      where.employee = { departmentId };
    }

    if (search) {
      where.OR = [
        { transactionCode: { contains: search, mode: "insensitive" } },
        { employee: { firstName: { contains: search, mode: "insensitive" } } },
        { employee: { lastName: { contains: search, mode: "insensitive" } } },
        { employee: { employeeCode: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { assetTag: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { brand: { contains: search, mode: "insensitive" } } },
        { phoneAsset: { model: { contains: search, mode: "insensitive" } } },
        { nfcCard: { cardUid: { contains: search, mode: "insensitive" } } },
        { nfcCard: { cardNumber: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [total, transactions] = await Promise.all([
      db.custodyTransaction.count({ where }),
      db.custodyTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: "desc" },
        include: {
          employee: {
            include: { department: true },
          },
          phoneAsset: true,
          nfcCard: true,
          nfcReader: true,
          returnDeadline: true,
          incidents: { select: { id: true, incidentNumber: true, severity: true, status: true } },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("[GET /api/custody] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch custody transactions", details: error.message },
      { status: 500 }
    );
  }
}
