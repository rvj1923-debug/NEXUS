import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

const updateKioskSchema = z.object({
  name: z.string().optional(),
  location: z.string().optional(),
  readerIdentifier: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  displayLanguage: z.enum(["EN", "FIL"]).optional(),
  soundEnabled: z.boolean().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  inactivityTimeoutSeconds: z.number().min(10).max(300).optional(),
  revokeSession: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only System Administrators can modify kiosks." },
        { status: 403 }
      );
    }

    const { id } = await props.params;
    const body = await req.json();
    const parsed = updateKioskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const existing = await db.kioskDevice.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Kiosk not found." }, { status: 404 });
    }

    const updateData: any = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.location !== undefined) updateData.location = parsed.data.location;
    if (parsed.data.readerIdentifier !== undefined) updateData.readerIdentifier = parsed.data.readerIdentifier;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.displayLanguage !== undefined) updateData.displayLanguage = parsed.data.displayLanguage;
    if (parsed.data.soundEnabled !== undefined) updateData.soundEnabled = parsed.data.soundEnabled;
    if (parsed.data.theme !== undefined) updateData.theme = parsed.data.theme;
    if (parsed.data.inactivityTimeoutSeconds !== undefined) updateData.inactivityTimeoutSeconds = parsed.data.inactivityTimeoutSeconds;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    // Handle session revocation
    if (parsed.data.revokeSession) {
      updateData.sessionSecret = crypto.randomBytes(24).toString("hex");
      updateData.status = "REVOKED";
    }

    const updated = await db.kioskDevice.update({
      where: { id },
      data: updateData,
    });

    // Log audit
    await db.auditLog.create({
      data: {
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: parsed.data.revokeSession ? "KIOSK_SESSION_REVOKED" : "KIOSK_UPDATED",
        entityType: "KioskDevice",
        entityId: id,
        changes: JSON.stringify(updateData),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      kiosk: updated,
    });
  } catch (error: any) {
    console.error("[PATCH /api/admin/kiosks/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to update kiosk", details: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await props.params;

    await db.kioskDevice.delete({
      where: { id },
    });

    await db.auditLog.create({
      data: {
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "KIOSK_DELETED",
        entityType: "KioskDevice",
        entityId: id,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, message: "Kiosk removed." });
  } catch (error: any) {
    console.error("[DELETE /api/admin/kiosks/[id]] Error:", error);
    return NextResponse.json({ error: "Failed to delete kiosk", details: error.message }, { status: 500 });
  }
}
