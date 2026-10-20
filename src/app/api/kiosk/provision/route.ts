import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireRole, createSessionToken, setSessionCookie } from "@/lib/auth";

const provisionSchema = z.object({
  kioskCode: z.string().trim().min(1).optional(),
  location: z.string().optional(),
  readerIdentifier: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Only administrators or phone custodians can pair/provision a kiosk terminal session
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const body = await req.json().catch(() => ({}));
    const parsed = provisionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { location, readerIdentifier } = parsed.data;
    const kioskCode = (parsed.data.kioskCode || process.env.KIOSK_CODE || "").trim();
    if (!kioskCode) {
      return NextResponse.json(
        {
          error: "Validation failed",
          message: "kioskCode is required (in request body or KIOSK_CODE environment variable).",
        },
        { status: 400 }
      );
    }

    // 1. Locate or create KioskDevice
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    const kioskDevice = await db.kioskDevice.upsert({
      where: { kioskCode },
      update: {
        status: "ACTIVE",
        sessionSecret,
        location: location || undefined,
        readerIdentifier: readerIdentifier || undefined,
        lastHeartbeatAt: new Date(),
      },
      create: {
        kioskCode,
        name: `${kioskCode} Terminal`,
        location: location || "Central Facility Lobby",
        readerIdentifier: readerIdentifier || "KIOSK-GATE-A",
        status: "ACTIVE",
        displayLanguage: "EN",
        inactivityTimeoutSeconds: 30,
        sessionSecret,
      },
    });

    // 2. Locate or create User with KIOSK role
    const kioskEmail = `${kioskCode.toLowerCase()}@company.local`;
    let kioskUser = await db.user.findUnique({
      where: { email: kioskEmail },
      include: { userRoles: { include: { role: true } } },
    });

    if (!kioskUser) {
      // Find KIOSK role
      let kioskRole = await db.role.findUnique({ where: { code: "KIOSK" } });
      if (!kioskRole) {
        kioskRole = await db.role.create({
          data: {
            code: "KIOSK",
            name: "Kiosk Terminal Account",
            description: "Dedicated kiosk account for Time In / Time Out",
            isSystem: true,
          },
        });
      }

      kioskUser = await db.user.create({
        data: {
          email: kioskEmail,
          fullName: `${kioskCode} Terminal Account`,
          passwordHash: crypto.randomBytes(32).toString("hex"),
          isActive: true,
          userRoles: {
            create: { roleId: kioskRole.id },
          },
        },
        include: { userRoles: { include: { role: true } } },
      });
    }

    // 3. Issue Kiosk Session JWT Cookie
    const sessionPayload = {
      userId: kioskUser.id,
      email: kioskUser.email,
      fullName: kioskUser.fullName,
      roleCode: "KIOSK" as const,
      roleName: "Kiosk Station Account",
      departmentId: null,
      departmentName: "Kiosk Operations",
      permissions: ["kiosk:access"],
    };

    const token = await createSessionToken(sessionPayload);
    await setSessionCookie(token, { isKiosk: true });

    // 4. Log Audit Trail
    await db.auditLog.create({
      data: {
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "KIOSK_SESSION_PROVISIONED",
        entityType: "KioskDevice",
        entityId: kioskDevice.id,
        changes: JSON.stringify({
          kioskCode,
          provisionedBy: session.fullName,
          timestamp: new Date().toISOString(),
        }),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Kiosk terminal session successfully paired and provisioned for '${kioskCode}'.`,
      kioskCode,
      kioskId: kioskDevice.id,
      status: kioskDevice.status,
      sessionUser: sessionPayload,
    });
  } catch (error: any) {
    console.error("[POST /api/kiosk/provision] Error:", error);
    return NextResponse.json(
      { error: "Kiosk provisioning failed", message: error.message },
      { status: 500 }
    );
  }
}
