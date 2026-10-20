import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import {
  getSession,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";
import {
  SESSION_COOKIE_NAME,
  KIOSK_RENEWAL_THRESHOLD_SECONDS,
  getJwtSecretKey,
} from "@/lib/session-config";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // 1. Require an existing valid session cookie; never mint a session from nothing
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

    // 2. Always take kioskCode from server environment (default PHONE-KIOSK-01), never from request body
    const kioskCode = (process.env.KIOSK_CODE || "PHONE-KIOSK-01").trim() || "PHONE-KIOSK-01";

    let kioskDevice = null;
    try {
      kioskDevice = await db.kioskDevice.upsert({
        where: { kioskCode },
        update: {
          status: "ACTIVE",
          lastHeartbeatAt: new Date(),
        },
        create: {
          kioskCode,
          name: `${kioskCode} Station`,
          location: "Main Lobby Central Turnstile",
          readerIdentifier: "KIOSK-GATE-A",
          status: "ACTIVE",
          displayLanguage: "EN",
          inactivityTimeoutSeconds: 30,
          sessionSecret: "auto-provisioned-kiosk-session",
          lastHeartbeatAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.error("[POST /api/kiosk/keepalive] Temporary DB error:", dbErr);
      // Do NOT clear session on DB error; return 503 temporary
      return NextResponse.json({ temporary: true }, { status: 503 });
    }

    // 3. For non-KIOSK roles (Admin/Custodian), keep their session untouched
    if (session.roleCode !== "KIOSK") {
      return NextResponse.json({
        success: true,
        roleCode: session.roleCode,
        renewed: false,
      });
    }

    // 4. For KIOSK role, renew the 30-day JWT cookie when older than 1 day
    let shouldRenew = true;
    try {
      const cookieStore = await cookies();
      const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      if (rawToken) {
        const { payload } = await jwtVerify(rawToken, getJwtSecretKey());
        const iat = typeof payload.iat === "number" ? payload.iat : 0;
        const nowSec = Math.floor(Date.now() / 1000);
        shouldRenew = nowSec - iat > KIOSK_RENEWAL_THRESHOLD_SECONDS;
      }
    } catch {
      shouldRenew = true;
    }

    if (shouldRenew) {
      const freshToken = await createSessionToken(session);
      await setSessionCookie(freshToken, { isKiosk: true });
    }

    return NextResponse.json({
      success: true,
      roleCode: "KIOSK",
      renewed: shouldRenew,
    });
  } catch (error) {
    console.error("[POST /api/kiosk/keepalive] Error:", error);
    return NextResponse.json({ temporary: true }, { status: 503 });
  }
}
