import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";
import { maskImei, maskPhoneNumber } from "@/lib/masking";

const createPhoneSchema = z.object({
  assetTag: z.string().min(2, "Asset Tag / ID is required").max(50),
  barcode: z.string().max(50).optional().or(z.literal("")),
  brand: z.string().max(50).default("OUKITEL"),
  model: z.string().max(50).default("OUKITEL G1"),
  imei: z.string().min(14, "IMEI 1 must be at least 14 digits").max(20),
  imei2: z.string().max(20).optional().or(z.literal("")),
  serialNumber: z.string().max(50).optional().or(z.literal("")),
  mobileNumber: z.string().max(20).optional().or(z.literal("")),
  simDetails: z.string().max(100).optional().or(z.literal("")),
  departmentId: z.string().uuid().optional().nullable().or(z.literal("")),
  purchaseDate: z.string().optional().or(z.literal("")),
  condition: z.enum(["EXCELLENT", "GOOD", "FAIR", "DAMAGED", "REPAIR_PENDING", "RETIRED"]).default("EXCELLENT"),
  issuedAccessories: z.string().max(255).default("Charger, Case"),
  imageUrl: z.string().url().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const departmentId = searchParams.get("departmentId") || "";
  const condition = searchParams.get("condition") || "";
  const custodyStatus = searchParams.get("custodyStatus") || "";
  const assignmentStatus = searchParams.get("assignmentStatus") || "";

  const whereClause: Record<string, unknown> = {
    isActive: true,
  };

  // Departmental scoping for supervisor
  if (session.roleCode === "DEPT_SUPERVISOR" && session.departmentId) {
    whereClause.departmentId = session.departmentId;
  } else if (departmentId) {
    whereClause.departmentId = departmentId;
  }

  if (condition) whereClause.condition = condition;
  if (custodyStatus) whereClause.custodyStatus = custodyStatus;
  if (assignmentStatus) whereClause.assignmentStatus = assignmentStatus;

  if (search) {
    whereClause.OR = [
      { assetTag: { contains: search, mode: "insensitive" } },
      { serialNumber: { contains: search, mode: "insensitive" } },
      { imei: { contains: search, mode: "insensitive" } },
      { brand: { contains: search, mode: "insensitive" } },
      { model: { contains: search, mode: "insensitive" } },
    ];
  }

  const phones = await db.phoneAsset.findMany({
    where: whereClause,
    include: {
      department: true,
      assignments: {
        where: { status: "ACTIVE" },
        include: { employee: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Apply privacy data masking on IMEIs & phone lines based on session role
  const maskedPhones = phones.map((p) => ({
    ...p,
    brand: p.brand || "OUKITEL",
    model: p.model || "OUKITEL G1",
    imei: maskImei(p.imei, session),
    imei2: p.imei2 ? maskImei(p.imei2, session) : null,
    mobileNumber: p.mobileNumber ? maskPhoneNumber(p.mobileNumber, session) : null,
    rawImeiAvailable: session.roleCode === "SYSTEM_ADMIN" || session.roleCode === "IT_SUPPORT",
  }));

  return NextResponse.json({ phones: maskedPhones });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "phones:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires phones:manage permission" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createPhoneSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const cleanAssetTag = data.assetTag.trim().toUpperCase();
    const cleanImei = data.imei.trim();

    // 1. Detect Duplicate Asset Tag
    const existingTag = await db.phoneAsset.findUnique({
      where: { assetTag: cleanAssetTag },
    });
    if (existingTag) {
      return NextResponse.json(
        { error: `Asset ID / Tag '${cleanAssetTag}' is already registered.` },
        { status: 409 }
      );
    }

    // 2. Detect Duplicate IMEI 1
    const existingImei = await db.phoneAsset.findUnique({
      where: { imei: cleanImei },
    });
    if (existingImei) {
      return NextResponse.json(
        { error: `IMEI '${cleanImei}' is already registered to asset ${existingImei.assetTag}.` },
        { status: 409 }
      );
    }

    // 3. Detect Duplicate Serial if provided
    if (data.serialNumber) {
      const cleanSerial = data.serialNumber.trim();
      const existingSerial = await db.phoneAsset.findUnique({
        where: { serialNumber: cleanSerial },
      });
      if (existingSerial) {
        return NextResponse.json(
          { error: `Serial Number '${cleanSerial}' is already registered.` },
          { status: 409 }
        );
      }
    }

    // 4. Create Phone Asset with decoupled status architecture
    const createdPhone = await db.phoneAsset.create({
      data: {
        assetTag: cleanAssetTag,
        barcode: data.barcode ? data.barcode.trim() : null,
        brand: data.brand.trim(),
        model: data.model.trim(),
        imei: cleanImei,
        imei2: data.imei2 ? data.imei2.trim() : null,
        serialNumber: data.serialNumber ? data.serialNumber.trim() : null,
        mobileNumber: data.mobileNumber ? data.mobileNumber.trim() : null,
        simDetails: data.simDetails ? data.simDetails.trim() : null,
        departmentId: data.departmentId || null,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        condition: data.condition,
        operationalStatus: data.condition === "RETIRED" ? "RETIRED" : data.condition === "DAMAGED" ? "DAMAGED" : "ACTIVE",
        assignmentStatus: "UNASSIGNED",
        custodyStatus: "AVAILABLE",
        issuedAccessories: data.issuedAccessories,
        imageUrl: data.imageUrl || null,
        notes: data.notes || null,
        isActive: true,
      },
      include: { department: true },
    });

    await recordAuditLog({
      userId: session.userId,
      userEmail: session.email,
      userRole: session.roleCode,
      action: "PHONE_REGISTERED",
      entityType: "PHONE_ASSET",
      entityId: createdPhone.id,
      changes: {
        assetTag: createdPhone.assetTag,
        brand: createdPhone.brand,
        model: createdPhone.model,
        imei: maskImei(createdPhone.imei, session),
        condition: createdPhone.condition,
      },
    });

    return NextResponse.json({ success: true, phone: createdPhone }, { status: 201 });
  } catch (error) {
    console.error("[Phone Register Error]", error);
    return NextResponse.json({ error: "Failed to register phone asset" }, { status: 500 });
  }
}
