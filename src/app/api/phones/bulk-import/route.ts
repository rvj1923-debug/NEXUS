import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";

interface PhoneImportRow {
  asset_tag: string;
  brand: string;
  model: string;
  imei: string;
  imei2?: string;
  serial_number?: string;
  department_code?: string;
  condition?: string;
  accessories?: string;
  mobile_number?: string;
}

interface PhoneValidationResult {
  rowNumber: number;
  data: PhoneImportRow;
  isValid: boolean;
  errors: string[];
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
    const contentType = request.headers.get("content-type") || "";
    let csvString = "";
    let commit = false;

    if (contentType.includes("application/json")) {
      const json = await request.json();
      csvString = json.csv || "";
      commit = Boolean(json.commit);
    } else {
      csvString = await request.text();
    }

    if (!csvString.trim()) {
      return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });
    }

    // Parse CSV
    const parsed = Papa.parse<PhoneImportRow>(csvString, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return NextResponse.json(
        { error: "CSV parsing error", details: parsed.errors.map((e) => e.message) },
        { status: 400 }
      );
    }

    // Fetch department codes
    const allDepts = await db.department.findMany();
    const deptMap = new Map<string, string>();
    for (const d of allDepts) {
      deptMap.set(d.code.toUpperCase(), d.id);
      deptMap.set(d.name.toUpperCase(), d.id);
    }

    // Existing phone tags & IMEIs
    const existingPhones = await db.phoneAsset.findMany({
      select: { assetTag: true, imei: true, serialNumber: true },
    });
    const existingTags = new Set(existingPhones.map((p) => p.assetTag.toUpperCase()));
    const existingImeis = new Set(existingPhones.map((p) => p.imei));
    const existingSerials = new Set(existingPhones.filter((p) => p.serialNumber).map((p) => p.serialNumber!));

    const seenBatchTags = new Set<string>();
    const seenBatchImeis = new Set<string>();
    const seenBatchSerials = new Set<string>();

    const validationResults: PhoneValidationResult[] = [];
    const validRowsToInsert: Array<{
      assetTag: string;
      brand: string;
      model: string;
      imei: string;
      imei2: string | null;
      serialNumber: string | null;
      mobileNumber: string | null;
      departmentId: string | null;
      condition: string;
      issuedAccessories: string;
    }> = [];

    parsed.data.forEach((row, idx) => {
      const rowNumber = idx + 2;
      const errors: string[] = [];

      const tag = (row.asset_tag || "").trim().toUpperCase();
      const brand = (row.brand || "OUKITEL").trim();
      const model = (row.model || "OUKITEL G1").trim();
      const imei = (row.imei || "").trim();
      const imei2 = (row.imei2 || "").trim();
      const serial = (row.serial_number || "").trim();
      const deptCode = (row.department_code || "").trim().toUpperCase();
      const condition = (row.condition || "EXCELLENT").trim().toUpperCase();
      const accessories = (row.accessories || "Charger, Case").trim();
      const mobileNumber = (row.mobile_number || "").trim();

      // Required checks
      if (!tag) errors.push("Missing required field: asset_tag");
      if (!imei) errors.push("Missing required field: imei");

      // Validate IMEI format
      if (imei && !/^\d{14,17}$/.test(imei)) {
        errors.push(`Invalid IMEI format '${imei}': must be 14-17 numeric digits.`);
      }

      // Check Duplicate Asset Tag in DB
      if (tag && existingTags.has(tag)) {
        errors.push(`Duplicate asset_tag: '${tag}' already exists in registry.`);
      }

      // Check Duplicate Asset Tag within batch
      if (tag && seenBatchTags.has(tag)) {
        errors.push(`Duplicate asset_tag: '${tag}' appears multiple times in this file.`);
      } else if (tag) {
        seenBatchTags.add(tag);
      }

      // Check Duplicate IMEI in DB
      if (imei && existingImeis.has(imei)) {
        errors.push(`Duplicate imei: '${imei}' already exists in registry.`);
      }

      // Check Duplicate IMEI within batch
      if (imei && seenBatchImeis.has(imei)) {
        errors.push(`Duplicate imei: '${imei}' appears multiple times in this file.`);
      } else if (imei) {
        seenBatchImeis.add(imei);
      }

      // Check Duplicate Serial if present
      if (serial) {
        if (existingSerials.has(serial)) {
          errors.push(`Duplicate serial_number: '${serial}' already registered.`);
        } else if (seenBatchSerials.has(serial)) {
          errors.push(`Duplicate serial_number: '${serial}' appears multiple times in this file.`);
        } else {
          seenBatchSerials.add(serial);
        }
      }

      // Validate Department
      let deptId: string | null = null;
      if (deptCode) {
        deptId = deptMap.get(deptCode) || null;
        if (!deptId) {
          errors.push(`Invalid department_code '${deptCode}'.`);
        }
      }

      const validConditions = ["EXCELLENT", "GOOD", "FAIR", "DAMAGED", "REPAIR_PENDING", "RETIRED"];
      if (condition && !validConditions.includes(condition)) {
        errors.push(`Invalid condition '${condition}'. Allowed: ${validConditions.join(", ")}`);
      }

      const isValid = errors.length === 0;
      validationResults.push({
        rowNumber,
        data: row,
        isValid,
        errors,
      });

      if (isValid) {
        validRowsToInsert.push({
          assetTag: tag,
          brand,
          model,
          imei,
          imei2: imei2 || null,
          serialNumber: serial || null,
          mobileNumber: mobileNumber || null,
          departmentId: deptId,
          condition: condition || "EXCELLENT",
          issuedAccessories: accessories || "Charger, Case",
        });
      }
    });

    const totalRows = validationResults.length;
    const validCount = validRowsToInsert.length;
    const invalidCount = totalRows - validCount;

    if (commit && validCount > 0) {
      const inserted = await db.$transaction(async (tx) => {
        const createdPhones = [];
        for (const p of validRowsToInsert) {
          const phone = await tx.phoneAsset.create({
            data: {
              assetTag: p.assetTag,
              brand: p.brand,
              model: p.model,
              imei: p.imei,
              imei2: p.imei2,
              serialNumber: p.serialNumber,
              mobileNumber: p.mobileNumber,
              departmentId: p.departmentId,
              condition: p.condition,
              operationalStatus: "ACTIVE",
              assignmentStatus: "UNASSIGNED",
              custodyStatus: "AVAILABLE",
              issuedAccessories: p.issuedAccessories,
              isActive: true,
            },
          });
          createdPhones.push(phone);
        }
        return createdPhones;
      });

      await recordAuditLog({
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "PHONES_BULK_IMPORTED",
        entityType: "PHONE_ASSET",
        changes: {
          importedCount: inserted.length,
          skippedInvalidCount: invalidCount,
        },
      });

      return NextResponse.json({
        success: true,
        committed: true,
        totalRows,
        importedCount: inserted.length,
        invalidCount,
        results: validationResults,
      });
    }

    return NextResponse.json({
      success: true,
      committed: false,
      totalRows,
      validCount,
      invalidCount,
      canCommit: validCount > 0,
      results: validationResults,
    });
  } catch (error) {
    console.error("[Phone Bulk Import Error]", error);
    return NextResponse.json({ error: "Failed to process bulk import" }, { status: 500 });
  }
}
