import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.roleCode !== "SYSTEM_ADMIN" && session.roleCode !== "PHONE_CUSTODIAN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const kiosks = await db.kioskDevice.findMany({
      include: {
        _count: {
          select: { verificationRequests: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Also get connected NFC Readers for reader assignment dropdown
    const readers = await db.nfcReader.findMany({
      where: { isActive: true },
      select: {
        id: true,
        readerIdentifier: true,
        name: true,
        location: true,
        status: true,
        connectionMode: true,
      },
    });

    return NextResponse.json({
      success: true,
      kiosks,
      availableReaders: readers,
    });
  } catch (error: any) {
    console.error("[GET /api/admin/kiosks] Error:", error);
    return NextResponse.json({ error: "Failed to list kiosks", details: error.message }, { status: 500 });
  }
}

const createKioskSchema = z.object({
  kioskCode: z.string().min(2, "Kiosk Code must be at least 2 characters"),
  name: z.string().min(2, "Kiosk Name is required"),
  location: z.string().default("Building Lobby"),
  readerIdentifier: z.string().optional().nullable(),
  displayLanguage: z.enum(["EN", "FIL"]).default("EN"),
  soundEnabled: z.boolean().default(true),
  theme: z.enum(["light", "dark"]).default("light"),
  inactivityTimeoutSeconds: z.number().min(10).max(300).default(30),
  notes: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only System Administrators can register kiosks." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = createKioskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      kioskCode,
      name,
      location,
      readerIdentifier,
      displayLanguage,
      soundEnabled,
      theme,
      inactivityTimeoutSeconds,
      notes,
    } = parsed.data;

    // Check for duplicate code
    const existing = await db.kioskDevice.findUnique({
      where: { kioskCode },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Kiosk code "${kioskCode}" is already registered.` },
        { status: 409 }
      );
    }

    // Generate unique session secret
    const sessionSecret = crypto.randomBytes(24).toString("hex");

    const kiosk = await db.kioskDevice.create({
      data: {
        kioskCode: kioskCode.trim().toUpperCase(),
        name: name.trim(),
        location: location.trim(),
        readerIdentifier: readerIdentifier?.trim() || null,
        displayLanguage,
        soundEnabled,
        theme,
        inactivityTimeoutSeconds,
        sessionSecret,
        status: "ACTIVE",
        notes: notes?.trim() || null,
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "KIOSK_REGISTERED",
        entityType: "KioskDevice",
        entityId: kiosk.id,
        changes: JSON.stringify({ kioskCode: kiosk.kioskCode, location, readerIdentifier }),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      kiosk,
    });
  } catch (error: any) {
    console.error("[POST /api/admin/kiosks] Error:", error);
    return NextResponse.json({ error: "Failed to create kiosk", details: error.message }, { status: 500 });
  }
}
