import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";

const readerUpdateSchema = z.object({
  name: z.string().min(2, "Reader name is required").optional(),
  location: z.string().min(2, "Location is required").optional(),
  readerType: z.enum(["KIOSK", "DESKTOP", "MOBILE"]).optional(),
  connectionMode: z.enum(["MODE_A_KEYBOARD_WEDGE", "MODE_B_PCSC", "MODE_C_RAW_HID"]).optional(),
  vendorId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  deviceInstanceId: z.string().optional().nullable(),
  pairedKiosk: z.string().optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  status: z.enum(["ONLINE", "OFFLINE", "MAINTENANCE", "ERROR"]).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sessionOrRes = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (sessionOrRes instanceof NextResponse) {
      return sessionOrRes;
    }

    const { id } = await params;
    const reader = await db.nfcReader.findUnique({
      where: { id },
      include: {
        transactions: {
          take: 10,
          orderBy: { timestamp: "desc" },
          include: {
            employee: true,
            phoneAsset: true,
          },
        },
      },
    });

    if (!reader) {
      return NextResponse.json({ error: "Reader not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, reader });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to fetch reader", details: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = readerUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const existing = await db.nfcReader.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Reader not found" }, { status: 404 });
    }

    const updated = await db.nfcReader.update({
      where: { id },
      data: parsed.data,
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "READER_UPDATED",
      entityType: "NFC_READER",
      entityId: updated.id,
      changes: parsed.data,
    });

    return NextResponse.json({
      success: true,
      reader: updated,
      message: `Reader '${updated.name}' updated successfully.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to update reader", details: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("SYSTEM_ADMIN", "PHONE_CUSTODIAN");
    if (session instanceof NextResponse) {
      return session;
    }

    const { id } = await params;

    const existing = await db.nfcReader.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Reader not found" }, { status: 404 });
    }

    // Soft deactivate to preserve historical transaction integrity
    const updated = await db.nfcReader.update({
      where: { id },
      data: {
        isActive: false,
        status: "OFFLINE",
      },
    });

    await recordAuditLog({
      userId: session?.userId,
      userEmail: session?.email,
      userRole: session?.roleCode,
      action: "READER_DEACTIVATED",
      entityType: "NFC_READER",
      entityId: id,
      changes: { isActive: false, status: "OFFLINE" },
    });

    return NextResponse.json({
      success: true,
      message: `Reader '${existing.name}' deactivated successfully.`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to deactivate reader", details: error.message }, { status: 500 });
  }
}
