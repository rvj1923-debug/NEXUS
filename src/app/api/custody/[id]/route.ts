import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const transaction = await db.custodyTransaction.findUnique({
      where: { id },
      include: {
        employee: {
          include: { department: true, shifts: true },
        },
        phoneAsset: {
          include: { department: true },
        },
        nfcReader: true,
        nfcCard: true,
        returnDeadline: true,
        overdueCases: true,
        incidents: {
          include: { actions: true },
        },
        custodyEvents: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    if (!transaction) {
      return NextResponse.json({ error: "Custody transaction not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, transaction });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch transaction details", details: error.message },
      { status: 500 }
    );
  }
}
