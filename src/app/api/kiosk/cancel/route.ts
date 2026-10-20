import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const body = await req.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const verificationReq = await db.kioskVerificationRequest.findUnique({
      where: { token },
    });

    if (verificationReq && verificationReq.requestStatus === "PENDING") {
      await db.kioskVerificationRequest.update({
        where: { id: verificationReq.id },
        data: { requestStatus: "CANCELLED" },
      });
    }

    return NextResponse.json({ success: true, message: "Request cancelled." });
  } catch (error: any) {
    console.error("[POST /api/kiosk/cancel] Error:", error);
    return NextResponse.json({ error: "Failed to cancel request" }, { status: 500 });
  }
}
