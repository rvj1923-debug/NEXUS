import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

const kioskRequestSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  phoneAssetId: z.string().min(1, "Phone Asset ID is required"),
  transactionType: z.enum(["ISSUANCE", "SURRENDER", "TIME_IN", "TIME_OUT"]),
  nfcCardId: z.string().optional().nullable(),
  kioskCode: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("KIOSK", "SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const body = await req.json();
    const parsed = kioskRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { employeeId, phoneAssetId, transactionType, nfcCardId, kioskCode } = parsed.data;

    // Verify employee exists and is active
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: { department: true },
    });

    if (!employee || !employee.isActive || employee.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Employee is inactive or not found." },
        { status: 400 }
      );
    }

    // Verify phone exists
    const phone = await db.phoneAsset.findUnique({
      where: { id: phoneAssetId },
    });

    if (!phone) {
      return NextResponse.json(
        { error: "Phone asset not found." },
        { status: 404 }
      );
    }

    // Cancel any previous pending requests for this employee to prevent stale collisions
    await db.kioskVerificationRequest.updateMany({
      where: {
        employeeId,
        requestStatus: "PENDING",
      },
      data: {
        requestStatus: "CANCELLED",
      },
    });

    // Lookup kiosk device if code provided
    let kioskDevice = null;
    if (kioskCode) {
      kioskDevice = await db.kioskDevice.findUnique({
        where: { kioskCode },
      });
    }

    // Generate single-use secure verification token & request code
    const token = crypto.randomBytes(16).toString("hex");
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const requestCode = `KREQ-${todayStr}-${randomSuffix}`;
    const expiresAt = new Date(Date.now() + 60 * 1000); // 60 seconds validity

    const newRequest = await db.kioskVerificationRequest.create({
      data: {
        requestCode,
        token,
        employeeId,
        phoneAssetId,
        nfcCardId: nfcCardId || null,
        kioskDeviceId: kioskDevice?.id || null,
        transactionType,
        requestStatus: "PENDING",
        expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      token,
      requestCode,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: 60,
      transactionType,
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || "General",
      },
      phone: {
        id: phone.id,
        assetTag: phone.assetTag,
        brand: "",
        model: "",
      },
    });
  } catch (error: any) {
    console.error("[POST /api/kiosk/request] Error:", error);
    return NextResponse.json(
      { error: "Failed to initiate kiosk verification request", message: "System temporarily unavailable." },
      { status: 500 }
    );
  }
}
