import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";

const readerCreateSchema = z.object({
  readerIdentifier: z.string().min(2, "Identifier is required").toUpperCase(),
  name: z.string().min(2, "Reader name is required"),
  location: z.string().min(2, "Location is required"),
  readerType: z.enum(["KIOSK", "DESKTOP", "MOBILE"]).default("KIOSK"),
  connectionMode: z.enum(["MODE_A_KEYBOARD_WEDGE", "MODE_B_PCSC", "MODE_C_RAW_HID"]).default("MODE_A_KEYBOARD_WEDGE"),
  vendorId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  deviceInstanceId: z.string().optional().nullable(),
  pairedKiosk: z.string().optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  status: z.enum(["ONLINE", "OFFLINE", "MAINTENANCE", "ERROR"]).default("ONLINE"),
});

export async function GET(req: NextRequest) {
  try {
    const sessionOrRes = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const where: any = {};
    if (activeOnly) {
      where.isActive = true;
    }

    const readers = await db.nfcReader.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { transactions: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      readers: readers.map((r) => ({
        id: r.id,
        readerIdentifier: r.readerIdentifier,
        name: r.name,
        location: r.location,
        readerType: r.readerType,
        connectionMode: r.connectionMode,
        vendorId: r.vendorId,
        productId: r.productId,
        deviceInstanceId: r.deviceInstanceId,
        pairedKiosk: r.pairedKiosk,
        ipAddress: r.ipAddress,
        status: r.status,
        lastScannedAt: r.lastScannedAt,
        lastError: r.lastError,
        agentVersion: r.agentVersion,
        lastHeartbeatAt: r.lastHeartbeatAt,
        isActive: r.isActive,
        transactionCount: r._count.transactions,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error: any) {
    console.error("[GET /api/readers] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch NFC readers", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const body = await req.json();
    const parsed = readerCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const existing = await db.nfcReader.findUnique({
      where: { readerIdentifier: data.readerIdentifier },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Reader with identifier '${data.readerIdentifier}' already exists.` },
        { status: 409 }
      );
    }

    const reader = await db.nfcReader.create({
      data: {
        readerIdentifier: data.readerIdentifier,
        name: data.name,
        location: data.location,
        readerType: data.readerType,
        connectionMode: data.connectionMode,
        vendorId: data.vendorId || null,
        productId: data.productId || null,
        deviceInstanceId: data.deviceInstanceId || null,
        pairedKiosk: data.pairedKiosk || null,
        ipAddress: data.ipAddress || null,
        status: data.status,
        agentVersion: "1.0.0-phase3",
        lastHeartbeatAt: new Date(),
        isActive: true,
      },
    });

    await recordAuditLog({
      userId: session?.userId,
      userEmail: session?.email,
      userRole: session?.roleCode,
      action: "READER_REGISTERED",
      entityType: "NFC_READER",
      entityId: reader.id,
      changes: {
        readerIdentifier: reader.readerIdentifier,
        name: reader.name,
        connectionMode: reader.connectionMode,
        pairedKiosk: reader.pairedKiosk,
      },
    });

    return NextResponse.json(
      {
        success: true,
        reader,
        message: `NFC Reader '${reader.name}' (${reader.readerIdentifier}) registered successfully.`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/readers] Error:", error);
    return NextResponse.json(
      { error: "Failed to register reader", details: error.message },
      { status: 500 }
    );
  }
}
