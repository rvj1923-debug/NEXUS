import { NextRequest, NextResponse } from "next/server";
import { getSession, clearSessionCookie } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { recordAuditLog } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || "unknown";
  const user = await getSession();

  if (user) {
    await recordAuditLog({
      userId: user.userId,
      userEmail: user.email,
      userRole: user.roleCode,
      action: "AUTH_LOGOUT",
      entityType: "AUTH",
      entityId: user.userId,
      ipAddress: ip,
      userAgent,
      changes: { logoutTime: new Date().toISOString() },
    });
  }

  await clearSessionCookie();

  return NextResponse.json({ success: true, redirectTo: "/login" });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
