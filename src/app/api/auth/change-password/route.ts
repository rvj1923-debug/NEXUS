import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSession,
  hashPassword,
  verifyPassword,
  invalidateUserSessionCache,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.roleCode === "KIOSK") {
      return NextResponse.json(
        { error: "Unauthorized: Login required" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    const targetUserId =
      typeof body.targetUserId === "string" && body.targetUserId.trim()
        ? body.targetUserId.trim()
        : session.userId;

    if (!currentPassword) {
      return NextResponse.json(
        { error: "Please enter your current password to confirm this change." },
        { status: 400 }
      );
    }

    if (newPassword.length < 12) {
      return NextResponse.json(
        { error: "New password must be at least 12 characters long." },
        { status: 400 }
      );
    }

    if (targetUserId !== session.userId && session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only System Administrators can change another user's password." },
        { status: 403 }
      );
    }

    const actingUser = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, passwordHash: true, isActive: true },
    });

    if (!actingUser || !actingUser.isActive) {
      return NextResponse.json(
        { error: "Current session account was not found or is inactive." },
        { status: 401 }
      );
    }

    const isCurrentValid = await verifyPassword(
      currentPassword,
      actingUser.passwordHash
    );
    if (!isCurrentValid) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }

    const targetUser =
      targetUserId === session.userId
        ? actingUser
        : await db.user.findUnique({
            where: { id: targetUserId },
            select: { id: true, email: true },
          });

    if (!targetUser) {
      return NextResponse.json(
        { error: "Target user account not found." },
        { status: 404 }
      );
    }

    const newHash = await hashPassword(newPassword);

    await db.user.update({
      where: { id: targetUser.id },
      data: { passwordHash: newHash },
    });

    invalidateUserSessionCache(targetUser.id);

    await db.auditLog.create({
      data: {
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "USER_PASSWORD_CHANGED",
        entityType: "User",
        entityId: targetUser.id,
        changes: JSON.stringify({
          targetEmail: targetUser.email,
          selfChange: targetUser.id === session.userId,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Password updated successfully for ${targetUser.email}.`,
    });
  } catch (err) {
    console.error("[POST /api/auth/change-password] Error:", err);
    return NextResponse.json(
      { error: "Failed to update password. Please try again." },
      { status: 500 }
    );
  }
}
