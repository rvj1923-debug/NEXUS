import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

const replaceCardSchema = z.object({
  newCardUid: z.string().min(4, "New Card UID is required").max(50),
  newCardNumber: z.string().max(50).optional().or(z.literal("")),
  reason: z.enum(["LOST", "DAMAGED", "MALFUNCTION", "UPGRADE", "WEAR_AND_TEAR"]).default("DAMAGED"),
  remarks: z.string().max(255).optional().or(z.literal("")),
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
    const body = await request.json();
    const parsed = replaceCardSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { newCardUid, newCardNumber, reason, remarks } = parsed.data;
    const normalizedNewUid = newCardUid.trim().toUpperCase();

    // 1. Fetch current card
    const currentCard = await db.nfcCard.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!currentCard) {
      return NextResponse.json({ error: "Existing card not found" }, { status: 404 });
    }

    if (!currentCard.employeeId) {
      return NextResponse.json(
        { error: "Card is not currently bound to an employee. Use standard enrollment instead." },
        { status: 400 }
      );
    }

    // 2. Check if newCardUid is already taken
    const conflictCard = await db.nfcCard.findUnique({
      where: { cardUid: normalizedNewUid },
    });

    if (conflictCard) {
      return NextResponse.json(
        { error: `New Card UID '${normalizedNewUid}' is already in the registry with status '${conflictCard.status}'.` },
        { status: 409 }
      );
    }

    // 3. Execute Replacement in Transaction
    // Rule: Card replacement must retain earlier transaction references.
    // The old card record is preserved in the database (status = REVOKED / LOST / DAMAGED).
    const result = await db.$transaction(async (tx) => {
      // Step A: Mark old card as revoked/lost/damaged
      const oldStatus = reason === "LOST" ? "LOST" : reason === "DAMAGED" ? "DAMAGED" : "REVOKED";
      const oldCardUpdated = await tx.nfcCard.update({
        where: { id },
        data: {
          status: oldStatus,
          revokedAt: new Date(),
          replacementReason: reason,
          notes: `Replaced by ${normalizedNewUid}. Reason: ${reason}. ${remarks ? `Remarks: ${remarks}` : ""}`,
        },
      });

      // Step B: Create and bind replacement card to the same employee
      const newCardCreated = await tx.nfcCard.create({
        data: {
          cardUid: normalizedNewUid,
          cardNumber: newCardNumber || null,
          identifierType: currentCard.identifierType,
          readerSource: "DESK_READER",
          employeeId: currentCard.employeeId,
          status: "ACTIVE",
          enrolledByUserId: session.userId,
          notes: `Replacement card for ${currentCard.cardUid} (${reason}). ${remarks || ""}`,
        },
        include: { employee: true },
      });

      return { oldCard: oldCardUpdated, newCard: newCardCreated };
    });

    // 4. Record Audit Log
    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "NFC_CARD_REPLACED",
      entityType: "NFC_CARD",
      entityId: result.newCard.id,
      changes: {
        employeeId: currentCard.employeeId,
        employeeCode: currentCard.employee?.employeeCode,
        oldCardUid: currentCard.cardUid,
        newCardUid: result.newCard.cardUid,
        reason,
        remarks: remarks || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Card ${currentCard.cardUid} successfully replaced by ${normalizedNewUid}. Historical transaction links preserved.`,
      oldCard: result.oldCard,
      newCard: result.newCard,
    });
  } catch (error) {
    console.error("[Card Replacement Error]", error);
    return NextResponse.json({ error: "Failed to replace card" }, { status: 500 });
  }
}
