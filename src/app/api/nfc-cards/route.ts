import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

const enrollCardSchema = z.object({
  cardUid: z.string().min(4, "Card UID is required").max(50),
  cardNumber: z.string().max(50).optional().or(z.literal("")),
  identifierType: z.enum(["MIFARE_CLASSIC", "MIFARE_DESFIRE", "HID_ICLASS", "FELICA"]).default("MIFARE_CLASSIC"),
  readerSource: z.string().default("DESK_READER"),
  employeeId: z.string().uuid("Invalid employee ID").optional().nullable().or(z.literal("")),
  status: z.enum(["ACTIVE", "UNASSIGNED", "REVOKED", "LOST", "DAMAGED", "EXPIRED"]).default("ACTIVE"),
  isMaintenanceCard: z.boolean().optional().default(false),
  notes: z.string().max(255).optional().or(z.literal("")),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const status = searchParams.get("status") || "";
    const employeeId = searchParams.get("employeeId") || "";

    const whereClause: Record<string, unknown> = {};

    if (status) {
      whereClause.status = status;
    }
    if (employeeId) {
      whereClause.employeeId = employeeId;
    }
    if (search) {
      whereClause.OR = [
        { cardUid: { contains: search, mode: "insensitive" } },
        { cardNumber: { contains: search, mode: "insensitive" } },
        { employee: { firstName: { contains: search, mode: "insensitive" } } },
        { employee: { lastName: { contains: search, mode: "insensitive" } } },
        { employee: { employeeCode: { contains: search, mode: "insensitive" } } },
      ];
    }

    const cards = await db.nfcCard.findMany({
      where: whereClause,
      include: {
        employee: {
          include: { department: true },
        },
        enrolledByUser: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ cards });
  } catch (error) {
    console.error("[NFC Cards List Error]", error);
    return NextResponse.json({ cards: [], error: "Failed to load NFC cards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "nfc:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires nfc:manage permission" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = enrollCardSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;
    if (data.isMaintenanceCard && session.roleCode !== "SYSTEM_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only System Administrators can configure maintenance cards." },
        { status: 403 }
      );
    }

    const normalizedUid = data.cardUid.trim().toUpperCase();

    // 1. Detect duplicate card UID in PostgreSQL
    const existingCard = await db.nfcCard.findUnique({
      where: { cardUid: normalizedUid },
      include: { employee: true },
    });

    if (existingCard) {
      return NextResponse.json(
        {
          error: `Card UID '${normalizedUid}' is already enrolled in the system with status '${existingCard.status}'${existingCard.employee ? ` (assigned to ${existingCard.employee.firstName} ${existingCard.employee.lastName})` : ""}.`,
        },
        { status: 409 }
      );
    }

    // 2. Business Rule: Only one employee may own an active card credential at a time,
    // unless explicitly authorized for multi-card
    if (data.employeeId && data.status === "ACTIVE") {
      const employee = await db.employee.findUnique({
        where: { id: data.employeeId },
        include: {
          nfcCards: { where: { status: "ACTIVE" } },
        },
      });

      if (!employee) {
        return NextResponse.json({ error: "Selected employee not found" }, { status: 404 });
      }

      if (employee.nfcCards.length > 0 && !employee.multiCardAuthorized) {
        return NextResponse.json(
          {
            error: `Employee ${employee.employeeCode} already holds an active card (${employee.nfcCards[0].cardUid}). Multi-card possession is not authorized for this personnel. Use the Card Replacement workflow or authorize multi-card.`,
          },
          { status: 409 }
        );
      }
    }

    const isMaint = session.roleCode === "SYSTEM_ADMIN" && Boolean(data.isMaintenanceCard);

    const createdCard = await db.nfcCard.create({
      data: {
        cardUid: normalizedUid,
        cardNumber: data.cardNumber || null,
        identifierType: data.identifierType,
        readerSource: data.readerSource,
        employeeId: data.employeeId || null,
        status: data.employeeId || isMaint ? data.status : "UNASSIGNED",
        isMaintenanceCard: isMaint,
        enrolledByUserId: session.userId,
        notes: data.notes || null,
      },
      include: {
        employee: { include: { department: true } },
      },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "NFC_CARD_ENROLLED",
      entityType: "NFC_CARD",
      entityId: createdCard.id,
      changes: {
        cardUid: createdCard.cardUid,
        status: createdCard.status,
        isMaintenanceCard: createdCard.isMaintenanceCard,
        employeeCode: createdCard.employee?.employeeCode || null,
      },
    });

    return NextResponse.json({ success: true, card: createdCard }, { status: 201 });
  } catch (error) {
    console.error("[NFC Enroll Error]", error);
    return NextResponse.json({ error: "Failed to enroll NFC card" }, { status: 500 });
  }
}
