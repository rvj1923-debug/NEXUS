import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";
import { maskImei, maskPhoneNumber } from "@/lib/masking";

const updatePhoneSchema = z.object({
  brand: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(50).optional(),
  serialNumber: z.string().max(50).optional().nullable(),
  mobileNumber: z.string().max(20).optional().nullable(),
  simDetails: z.string().max(100).optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  condition: z.enum(["EXCELLENT", "GOOD", "FAIR", "DAMAGED", "REPAIR_PENDING", "RETIRED"]).optional(),
  operationalStatus: z.enum(["ACTIVE", "UNDER_MAINTENANCE", "DAMAGED", "LOST", "RETIRED"]).optional(),
  issuedAccessories: z.string().max(255).optional(),
  imageUrl: z.string().url().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await props.params;

  const phone = await db.phoneAsset.findUnique({
    where: { id },
    include: {
      department: true,
      assignments: {
        orderBy: { createdAt: "desc" },
        include: {
          employee: { include: { department: true } },
          assignedByUser: { select: { fullName: true, email: true } },
        },
      },
      transactions: {
        orderBy: { timestamp: "desc" },
        include: {
          employee: true,
          nfcReader: true,
          returnDeadline: true,
        },
      },
      incidents: {
        orderBy: { createdAt: "desc" },
        include: { reportedByUser: true },
      },
    },
  });

  if (!phone) {
    return NextResponse.json({ error: "Phone asset not found" }, { status: 404 });
  }

  // Mask sensitive IMEI / lines for non-admin/IT roles
  const maskedPhone = {
    ...phone,
    imei: maskImei(phone.imei, session),
    imei2: phone.imei2 ? maskImei(phone.imei2, session) : null,
    mobileNumber: phone.mobileNumber ? maskPhoneNumber(phone.mobileNumber, session) : null,
    rawImeiAvailable: session.roleCode === "SYSTEM_ADMIN" || session.roleCode === "IT_SUPPORT",
  };

  return NextResponse.json({ phone: maskedPhone });
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "phones:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires phones:manage permission" }, { status: 403 });
  }

  const { id } = await props.params;

  try {
    const body = await request.json();
    const parsed = updatePhoneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const existing = await db.phoneAsset.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Phone asset not found" }, { status: 404 });
    }

    const updated = await db.phoneAsset.update({
      where: { id },
      data: {
        brand: data.brand ?? existing.brand,
        model: data.model ?? existing.model,
        serialNumber: data.serialNumber !== undefined ? (data.serialNumber || null) : existing.serialNumber,
        mobileNumber: data.mobileNumber !== undefined ? (data.mobileNumber || null) : existing.mobileNumber,
        simDetails: data.simDetails !== undefined ? (data.simDetails || null) : existing.simDetails,
        departmentId: data.departmentId !== undefined ? (data.departmentId || null) : existing.departmentId,
        condition: data.condition ?? existing.condition,
        operationalStatus: data.operationalStatus ?? existing.operationalStatus,
        issuedAccessories: data.issuedAccessories ?? existing.issuedAccessories,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
        notes: data.notes !== undefined ? data.notes : existing.notes,
      },
      include: { department: true },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "PHONE_UPDATED",
      entityType: "PHONE_ASSET",
      entityId: id,
      changes: { before: existing, after: updated },
    });

    return NextResponse.json({ success: true, phone: updated });
  } catch (error) {
    console.error("[Phone Update Error]", error);
    return NextResponse.json({ error: "Failed to update phone asset" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.roleCode !== "SYSTEM_ADMIN") {
    return NextResponse.json({ error: "Forbidden: Deleting hardware asset records requires System Administrator clearance" }, { status: 403 });
  }

  const { id } = await props.params;

  // Prevent deleting phone assets referenced by historical custody transactions
  const txCount = await db.custodyTransaction.count({
    where: { phoneAssetId: id },
  });

  if (txCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete phone asset: ${txCount} historical custody transactions reference this device. Please retire the asset instead.`,
      },
      { status: 400 }
    );
  }

  await db.phoneAsset.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date(), operationalStatus: "RETIRED" },
  });

  await recordAuditLog({
    userId: session.userId,
    userEmail: session.email,
    userRole: session.roleCode,
    action: "PHONE_RETIRED_OR_DELETED",
    entityType: "PHONE_ASSET",
    entityId: id,
  });

  return NextResponse.json({ success: true, message: "Phone marked retired/inactive" });
}
