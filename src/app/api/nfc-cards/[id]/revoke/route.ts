import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

const revokeCardSchema = z.object({
  reason: z.enum(["REVOKED", "LOST", "DAMAGED", "EXPIRED"]).default("REVOKED"),
  notes: z.string().max(255).optional().or(z.literal("")),
});

export async function POST(
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
    const body = await request.json().catch(() => ({}));
    const parsed = revokeCardSchema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : "REVOKED";
    const notes = parsed.success ? parsed.data.notes : "";

    const card = await db.nfcCard.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!card) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    const updated = await db.nfcCard.update({
      where: { id },
      data: {
        status: reason,
        revokedAt: new Date(),
        notes: notes ? `${notes} (Revocation Reason: ${reason})` : `Revoked: ${reason}`,
      },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "NFC_CARD_REVOKED",
      entityType: "NFC_CARD",
      entityId: id,
      changes: {
        cardUid: card.cardUid,
        employeeCode: card.employee?.employeeCode || null,
        reason,
        notes,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Card ${card.cardUid} revoked with status '${reason}'.`,
      card: updated,
    });
  } catch (error) {
    console.error("[Card Revocation Error]", error);
    return NextResponse.json({ error: "Failed to revoke card" }, { status: 500 });
  }
}
