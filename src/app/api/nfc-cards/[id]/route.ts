import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await props.params;

  const card = await db.nfcCard.findUnique({
    where: { id },
    include: {
      employee: { include: { department: true } },
      enrolledByUser: { select: { fullName: true, email: true } },
      transactions: {
        orderBy: { timestamp: "desc" },
        take: 20,
        include: {
          phoneAsset: true,
          employee: true,
          nfcReader: true,
        },
      },
    },
  });

  if (!card) {
    return NextResponse.json({ error: "NFC card not found" }, { status: 404 });
  }

  return NextResponse.json({ card });
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "nfc:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires nfc:manage permission" }, { status: 403 });
  }

  const { id } = await props.params;

  try {
    const body = await request.json();
    const { status, notes, employeeId, isMaintenanceCard } = body;

    if (isMaintenanceCard !== undefined && session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only System Administrators can modify maintenance card status" },
        { status: 403 }
      );
    }

    const existing = await db.nfcCard.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    const updated = await db.nfcCard.update({
      where: { id },
      data: {
        status: status ?? existing.status,
        notes: notes !== undefined ? notes : existing.notes,
        employeeId: employeeId !== undefined ? (employeeId || null) : existing.employeeId,
        isMaintenanceCard:
          isMaintenanceCard !== undefined ? Boolean(isMaintenanceCard) : existing.isMaintenanceCard,
      },
      include: { employee: true },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "NFC_CARD_UPDATED",
      entityType: "NFC_CARD",
      entityId: id,
      changes: { before: existing, after: updated },
    });

    return NextResponse.json({ success: true, card: updated });
  } catch (error) {
    console.error("[Card Update Error]", error);
    return NextResponse.json({ error: "Failed to update card" }, { status: 500 });
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
    return NextResponse.json({ error: "Forbidden: Deleting physical credential records requires System Administrator clearance" }, { status: 403 });
  }

  const { id } = await props.params;

  // Prevent deleting cards referenced by historical custody transactions
  const txCount = await db.custodyTransaction.count({
    where: { nfcCardId: id },
  });

  if (txCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete card record: ${txCount} historical custody transactions reference this credential. Use card revocation or replacement instead.`,
      },
      { status: 400 }
    );
  }

  await db.nfcCard.delete({ where: { id } });

  await recordAuditLog({
    userId: session.userId,
    userEmail: session.email,
    userRole: session.roleCode,
    action: "NFC_CARD_DELETED",
    entityType: "NFC_CARD",
    entityId: id,
  });

  return NextResponse.json({ success: true, message: "Card deleted" });
}
