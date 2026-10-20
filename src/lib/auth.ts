import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { RoleCode } from "./rbac";
import { db } from "./db";
import {
  SESSION_COOKIE_NAME,
  KIOSK_DEVICE_COOKIE_NAME,
  STRICT_SESSION_VERSION,
  SESSION_EXPIRATION,
  KIOSK_SESSION_EXPIRATION,
  STANDARD_COOKIE_MAX_AGE,
  KIOSK_COOKIE_MAX_AGE,
  KIOSK_DEVICE_COOKIE_MAX_AGE,
  KIOSK_RENEWAL_THRESHOLD_SECONDS,
  getJwtSecretKey,
  getKioskDeviceSecret,
  type SessionUser,
} from "./session-config";

export {
  SESSION_COOKIE_NAME,
  KIOSK_DEVICE_COOKIE_NAME,
  STRICT_SESSION_VERSION,
  SESSION_EXPIRATION,
  KIOSK_SESSION_EXPIRATION,
  STANDARD_COOKIE_MAX_AGE,
  KIOSK_COOKIE_MAX_AGE,
  KIOSK_DEVICE_COOKIE_MAX_AGE,
  KIOSK_RENEWAL_THRESHOLD_SECONDS,
  getJwtSecretKey,
  getKioskDeviceSecret,
  type SessionUser,
};

export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

export async function verifyPassword(plainText: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plainText, hashed);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const expiration = user.roleCode === "KIOSK" ? KIOSK_SESSION_EXPIRATION : SESSION_EXPIRATION;
  return new SignJWT({ user, sessionVersion: STRICT_SESSION_VERSION })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(getJwtSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  const secretKey = getJwtSecretKey();
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if ((payload as { sessionVersion?: string }).sessionVersion !== STRICT_SESSION_VERSION) {
      return null;
    }
    return (payload as { user: SessionUser }).user || null;
  } catch {
    return null;
  }
}

// Fast in-memory cache (60s TTL) for active user verification to avoid redundant DB queries on every page/API hit
const USER_VERIFY_CACHE_TTL_MS = 60 * 1000;
const userVerificationCache = new Map<
  string,
  { isActive: boolean; roleCode?: RoleCode; expiresAt: number }
>();

export function invalidateUserSessionCache(userId?: string) {
  if (userId) {
    userVerificationCache.delete(userId);
  } else {
    userVerificationCache.clear();
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const sessionUser = await verifySessionToken(token);
  if (!sessionUser) return null;

  const now = Date.now();
  const cached = userVerificationCache.get(sessionUser.userId);
  if (cached && cached.expiresAt > now) {
    if (!cached.isActive) return null;
    if (cached.roleCode) {
      sessionUser.roleCode = cached.roleCode;
    }
    return sessionUser;
  }

  // Authoritatively verify the user exists in DB and is active
  try {
    const user = await db.user.findUnique({
      where: { id: sessionUser.userId },
      select: {
        id: true,
        isActive: true,
        userRoles: {
          select: {
            role: {
              select: { code: true },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      userVerificationCache.set(sessionUser.userId, {
        isActive: false,
        expiresAt: now + 10_000,
      });
      return null;
    }

    const primaryRole = user.userRoles[0]?.role?.code as RoleCode | undefined;
    if (primaryRole) {
      sessionUser.roleCode = primaryRole;
    }

    userVerificationCache.set(sessionUser.userId, {
      isActive: true,
      roleCode: primaryRole,
      expiresAt: now + USER_VERIFY_CACHE_TTL_MS,
    });

    return sessionUser;
  } catch (err) {
    console.error("[getSession] DB validation error:", err);
    if (sessionUser.roleCode === "KIOSK") {
      return sessionUser;
    }
    return null;
  }
}

function isHttpsConfigured(): boolean {
  const envKey = "APP_URL";
  const configured = (process.env[envKey] || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  return configured.startsWith("https://");
}

export async function setSessionCookie(
  token: string,
  options?: { isKiosk?: boolean }
): Promise<void> {
  const isHttps = isHttpsConfigured();
  let isKiosk = options?.isKiosk;
  if (isKiosk === undefined) {
    const verified = await verifySessionToken(token);
    isKiosk = verified?.roleCode === "KIOSK";
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: isKiosk ? KIOSK_COOKIE_MAX_AGE : STANDARD_COOKIE_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  userVerificationCache.clear();
  const isHttps = isHttpsConfigured();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function requireRole(
  ...roles: RoleCode[]
): Promise<SessionUser | NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized: Login required" },
      { status: 401 }
    );
  }
  if (roles.length > 0 && !roles.includes(session.roleCode)) {
    return NextResponse.json(
      {
        error: "Forbidden: You do not possess the required role permissions for this resource",
        role: session.roleCode,
      },
      { status: 403 }
    );
  }
  return session;
}

