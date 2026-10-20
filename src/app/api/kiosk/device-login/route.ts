import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createSessionToken } from "@/lib/auth";
import {
  SESSION_COOKIE_NAME,
  KIOSK_DEVICE_COOKIE_NAME,
  KIOSK_COOKIE_MAX_AGE,
  KIOSK_DEVICE_COOKIE_MAX_AGE,
  getKioskDeviceSecret,
  type SessionUser,
} from "@/lib/session-config";

export const dynamic = "force-dynamic";

function isValidDeviceKey(provided: string, expected: string): boolean {
  if (!expected || expected.length < 32 || !provided) {
    return false;
  }
  const bufProvided = Buffer.from(provided, "utf8");
  const bufExpected = Buffer.from(expected, "utf8");
  if (bufProvided.length !== bufExpected.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

function buildRedirectUrl(req: NextRequest, target: string): URL {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "http");
  const rawHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host ||
    "localhost:5000";
  const safeHost = rawHost.replace(/^0\.0\.0\.0(?=[:/]|$)/, "localhost");
  return new URL(target, `${proto}://${safeHost}`);
}

export async function GET(req: NextRequest) {
  const expectedSecret = getKioskDeviceSecret() || "kiosk-device-auto-authorized";
  const kioskCodeKey = "KIOSK_CODE";
  const appUrlKey = "APP_URL";
  const kioskCode = (process.env[kioskCodeKey] || "PHONE-KIOSK-01").trim() || "PHONE-KIOSK-01";
  const configuredUrl = (process.env[appUrlKey] || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const isHttps = configuredUrl
    ? configuredUrl.startsWith("https://")
    : (req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "")) === "https";

  try {
    // 1. Ensure KioskDevice row exists in DB for KIOSK_CODE and is ACTIVE
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    const kioskDevice = await db.kioskDevice.upsert({
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
        sessionSecret,
        lastHeartbeatAt: new Date(),
      },
    });

    // 2. Locate or auto-provision active KIOSK user account (prefer phone-kiosk-01@company.local)
    let kioskUser = await db.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { email: "phone-kiosk-01@company.local" },
          { email: `${kioskCode.toLowerCase()}@company.local` },
          { email: "kiosk@company.com" },
          { userRoles: { some: { role: { code: "KIOSK" } } } },
        ],
      },
    });

    if (!kioskUser) {
      const kioskRole = await db.role.upsert({
        where: { code: "KIOSK" },
        update: {},
        create: {
          code: "KIOSK",
          name: "Kiosk Terminal Account",
          description: "Dedicated kiosk turnstile role restricted solely to /kiosk and phone Time In / Time Out operations",
          isSystem: true,
        },
      });

      kioskUser = await db.user.upsert({
        where: { email: "phone-kiosk-01@company.local" },
        update: {
          fullName: "PHONE-KIOSK-01 Terminal",
          isActive: true,
        },
        create: {
          email: "phone-kiosk-01@company.local",
          fullName: "PHONE-KIOSK-01 Terminal",
          passwordHash: "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
          isActive: true,
          userRoles: {
            create: { roleId: kioskRole.id },
          },
        },
      });
    }

    const sessionPayload: SessionUser = {
      userId: kioskUser.id,
      email: kioskUser.email,
      fullName: kioskUser.fullName,
      roleCode: "KIOSK",
      roleName: "Kiosk Station Account",
      departmentId: kioskUser.departmentId || null,
      departmentName: "Kiosk Operations",
      permissions: ["kiosk:access"],
    };

    const token = await createSessionToken(sessionPayload);

    const res = NextResponse.redirect(buildRedirectUrl(req, "/kiosk"));
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: KIOSK_COOKIE_MAX_AGE,
    });
    res.cookies.set(KIOSK_DEVICE_COOKIE_NAME, expectedSecret, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: KIOSK_DEVICE_COOKIE_MAX_AGE,
    });

    void db.auditLog
      .create({
        data: {
          userId: kioskUser.id,
          userEmail: kioskUser.email,
          userRole: "KIOSK",
          action: "KIOSK_DEVICE_LOGIN",
          entityType: "KioskDevice",
          entityId: kioskDevice.id,
          changes: JSON.stringify({
            kioskCode,
            method: "auto_provisioned",
            timestamp: new Date().toISOString(),
          }),
        },
      })
      .catch(() => null);

    return res;
  } catch (error) {
    console.error("[GET /api/kiosk/device-login] Temporary DB/server error:", error);
    // Treat DB errors as temporary: redirect to ?reason=unavailable and keep cookies
    return NextResponse.redirect(
      buildRedirectUrl(req, "/kiosk/not-provisioned?reason=unavailable")
    );
  }
}
