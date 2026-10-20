import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { DeduplicateRawScan } from "@/lib/nfc/normalization";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawUid = DeduplicateRawScan(searchParams.get("cardUid")?.trim() || "");

    if (!rawUid || rawUid.length < 3) {
      return NextResponse.json(
        { error: "A valid NFC card UID (at least 3 characters) is required." },
        { status: 400 }
      );
    }

    // Normalize: upper-case, strip spaces
    const normalizedUid = rawUid.toUpperCase().replace(/\s+/g, "");

    // Auto-detect RFID technology standard by byte length
    const hexOnly = normalizedUid.replace(/[:\-]/g, "");
    let detectedType = "MIFARE_CLASSIC";
    if (hexOnly.length === 8) {
      detectedType = "MIFARE_CLASSIC (4-Byte / 1K)";
    } else if (hexOnly.length === 14) {
      detectedType = "MIFARE_DESFIRE / NTAG (7-Byte)";
    } else if (hexOnly.length === 16) {
      detectedType = "HID_ICLASS (8-Byte)";
    } else if (hexOnly.length === 20) {
      detectedType = "FELICA (10-Byte)";
    }

    // Check database for existing card UID
    const existingCard = await db.nfcCard.findFirst({
      where: {
        OR: [
          { cardUid: { equals: normalizedUid, mode: "insensitive" } },
          { cardUid: { equals: rawUid, mode: "insensitive" } },
        ],
      },
      include: {
        employee: {
          include: { department: true },
        },
      },
    });

    if (existingCard) {
      if (existingCard.status === "ACTIVE" && existingCard.employee) {
        return NextResponse.json({
          cardUid: existingCard.cardUid,
          cardNumber: existingCard.cardNumber || `SN-${existingCard.cardUid}`,
          identifierType: existingCard.identifierType,
          status: "ACTIVE",
          available: false,
          message: `Conflict: Card is already actively bound to ${existingCard.employee.firstName} ${existingCard.employee.lastName} (${existingCard.employee.employeeCode}).`,
          employee: {
            id: existingCard.employee.id,
            employeeCode: existingCard.employee.employeeCode,
            firstName: existingCard.employee.firstName,
            lastName: existingCard.employee.lastName,
            department: existingCard.employee.department?.name || "Unassigned",
          },
        });
      }

      if (existingCard.status === "ACTIVE" && !existingCard.employee) {
        return NextResponse.json({
          cardUid: existingCard.cardUid,
          cardNumber: existingCard.cardNumber || `SN-${existingCard.cardUid}`,
          identifierType: existingCard.identifierType,
          status: "ACTIVE_UNBOUND",
          available: true,
          message: `Card is pre-enrolled and unassigned. Ready to bind.`,
        });
      }

      if (["REVOKED", "LOST", "DAMAGED"].includes(existingCard.status)) {
        return NextResponse.json({
          cardUid: existingCard.cardUid,
          cardNumber: existingCard.cardNumber || `SN-${existingCard.cardUid}`,
          identifierType: existingCard.identifierType,
          status: existingCard.status,
          available: false,
          message: `Security Alert: Card is marked as ${existingCard.status} (Reason: ${existingCard.replacementReason || "Security restriction"}). Cannot be issued.`,
        });
      }

      return NextResponse.json({
        cardUid: existingCard.cardUid,
        cardNumber: existingCard.cardNumber || `SN-${existingCard.cardUid}`,
        identifierType: existingCard.identifierType,
        status: existingCard.status,
        available: true,
        message: `Card found in inventory with status '${existingCard.status}'. Available to bind.`,
      });
    }

    // Not in DB -> Fresh / Brand New Card
    return NextResponse.json({
      cardUid: normalizedUid,
      cardNumber: `SN-${normalizedUid}`,
      identifierType: detectedType,
      status: "UNREGISTERED",
      available: true,
      message: `Verified: Fresh un-enrolled credential (${detectedType}). Ready for immediate registration.`,
    });
  } catch (error) {
    console.error("[NFC Verify Error]", error);
    return NextResponse.json(
      { error: "Failed to verify NFC card", available: false },
      { status: 500 }
    );
  }
}
