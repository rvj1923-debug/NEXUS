import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const kioskCode = (process.env.KIOSK_CODE || "PHONE-KIOSK-01").trim() || "PHONE-KIOSK-01";

    let kioskDevice = null;

    if (kioskCode) {
      kioskDevice = await db.kioskDevice.findUnique({
        where: { kioskCode },
      });
    }

    if (!kioskDevice && process.env.NODE_ENV !== "production") {
      kioskDevice = await db.kioskDevice.findFirst({
        orderBy: { createdAt: "asc" },
      });
    }

    return NextResponse.json({
      success: true,
      kioskCode: kioskDevice?.kioskCode || kioskCode || null,
      name: kioskDevice?.name || "Main Kiosk Station",
      location: kioskDevice?.location || "Building Lobby",
      status: kioskDevice?.status || "ACTIVE",
      displayLanguage: kioskDevice?.displayLanguage === "FIL" ? "FIL" : "EN",
      soundEnabled: kioskDevice?.soundEnabled ?? true,
      theme: kioskDevice?.theme === "dark" ? "dark" : "light",
      inactivityTimeoutSeconds: kioskDevice?.inactivityTimeoutSeconds ?? 30,
      appVersion: process.env.npm_package_version || "1.0.0",
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[GET /api/kiosk/config] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to load kiosk configuration",
      },
      { status: 500 }
    );
  }
}
