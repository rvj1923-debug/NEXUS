import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  SessionUser,
} from "@/lib/auth";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  resetLoginRateLimit,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { recordAuditLog } from "@/lib/audit";
import { RoleCode } from "@/lib/rbac";

const DUMMY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || "unknown";

    const body = await request.json();
    const parseResult = loginSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.trim().toLowerCase();
    const rateLimitKey = normalizedEmail;

    // 1. Rate Limiting Check (per-account + global limiter)
    const rateLimit = checkLoginRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      await recordAuditLog({
        userEmail: normalizedEmail,
        action: "AUTH_LOCKOUT",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          reason: rateLimit.reason === "global" ? "Global rate limit exceeded" : "Rate limit exceeded",
          resetSeconds: rateLimit.resetSeconds,
        },
      });

      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please try again in ${rateLimit.resetSeconds} seconds.`,
          resetSeconds: rateLimit.resetSeconds,
        },
        { status: 429 }
      );
    }

    // 2. Query user from database
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        department: true,
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH).catch(() => false);
      const updatedRate = recordFailedLoginAttempt(rateLimitKey);
      await recordAuditLog({
        userEmail: normalizedEmail,
        action: "AUTH_FAILED",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: {
          reason: user ? "User inactive" : "User not found",
          remainingAttempts: updatedRate.remainingAttempts,
        },
      });

      return NextResponse.json(
        {
          error: "Invalid email or password",
          remainingAttempts: updatedRate.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // 3. Verify Password
    const passwordMatch = await verifyPassword(password, user.passwordHash);
    if (!passwordMatch) {
      const updatedRate = recordFailedLoginAttempt(rateLimitKey);
      await recordAuditLog({
        userId: user.id,
        userEmail: normalizedEmail,
        action: "AUTH_FAILED",
        entityType: "AUTH",
        ipAddress: ip,
        userAgent,
        changes: { reason: "Password mismatch", remainingAttempts: updatedRate.remainingAttempts },
      });

      return NextResponse.json(
        {
          error: "Invalid email or password",
          remainingAttempts: updatedRate.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // 4. Determine primary role and aggregate permissions
    const primaryUserRole = user.userRoles[0]?.role;
    const roleCode = (primaryUserRole?.code || "AUDITOR") as RoleCode;
    const roleName = primaryUserRole?.name || "Auditor";

    const permissionSet = new Set<string>();
    for (const ur of user.userRoles) {
      for (const rp of ur.role.permissions) {
        permissionSet.add(rp.permission.code);
      }
    }

    const sessionUser: SessionUser = {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      roleCode,
      roleName,
      departmentId: user.departmentId,
      departmentName: user.department?.name || null,
      permissions: Array.from(permissionSet),
    };

    // 5. Generate JWT and set secure cookie
    const token = await createSessionToken(sessionUser);
    await setSessionCookie(token, { isKiosk: roleCode === "KIOSK" });
    resetLoginRateLimit(rateLimitKey);

    // 6. Update user's last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 7. Audit log successful authentication
    await recordAuditLog({
      userId: user.id,
      userEmail: user.email,
      userRole: roleCode,
      action: "AUTH_LOGIN",
      entityType: "AUTH",
      entityId: user.id,
      ipAddress: ip,
      userAgent,
      changes: { loginTime: new Date().toISOString() },
    });

    return NextResponse.json({
      success: true,
      user: sessionUser,
      redirectTo:
        roleCode === "KIOSK"
          ? "/kiosk"
          : roleCode === "HR_ADMIN"
          ? "/overdue"
          : "/dashboard",
    });
  } catch (error) {
    console.error("[Login API Error]", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during login. Please try again." },
      { status: 500 }
    );
  }
}
