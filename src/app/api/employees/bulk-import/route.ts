import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import { hasPermission } from "@/lib/rbac";
import { DeduplicateRawScan } from "@/lib/nfc/normalization";

interface RawImportRow {
  name_of_employee?: string;
  employee_name?: string;
  name?: string;
  full_name?: string;
  nfc_code?: string;
  card_uid?: string;
  nfc_uid?: string;
  nfc?: string;
  department_code?: string;
  department?: string;
}

interface NormalizedImportRow {
  name_of_employee: string;
  nfc_code: string;
  department_code: string;
}

interface RowValidationResult {
  rowNumber: number;
  data: NormalizedImportRow;
  isValid: boolean;
  errors: string[];
}

function splitEmployeeName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { firstName: "", lastName: "" };
  }
  if (cleaned.includes(",")) {
    const [last, ...rest] = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
    const first = rest.join(" ");
    return {
      firstName: first || last || "",
      lastName: first ? last : "",
    };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "-" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function detectIdentifierType(uid: string): string {
  const hexOnly = uid.replace(/[:\-]/g, "");
  if (hexOnly.length === 14) return "MIFARE_DESFIRE";
  if (hexOnly.length === 16) return "HID_ICLASS";
  if (hexOnly.length === 20) return "FELICA";
  return "MIFARE_CLASSIC";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session, "employees:manage")) {
    return NextResponse.json({ error: "Forbidden: Requires employees:manage permission" }, { status: 403 });
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
    const parsed = Papa.parse<RawImportRow>(csvString, {
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

    // Cache departments for rapid lookup
    const allDepts = await db.department.findMany();
    const deptMap = new Map<string, (typeof allDepts)[number]>(); // code/name -> dept
    for (const d of allDepts) {
      deptMap.set(d.code.toUpperCase(), d);
      deptMap.set(d.name.toUpperCase(), d);
    }

    // Cache existing employee codes for auto-generation
    const existingEmployees = await db.employee.findMany({
      select: { employeeCode: true },
    });
    const usedEmployeeCodes = new Set(existingEmployees.map((e) => e.employeeCode.toUpperCase()));
    let nextSeq = existingEmployees.length + 1;

    // Cache existing NFC cards for conflict validation
    const existingNfcCards = await db.nfcCard.findMany({
      include: { employee: true },
    });
    const nfcCardMap = new Map<string, (typeof existingNfcCards)[number]>();
    for (const card of existingNfcCards) {
      nfcCardMap.set(card.cardUid.toUpperCase().replace(/\s+/g, ""), card);
    }

    const seenBatchNfcCodes = new Set<string>();

    const validationResults: RowValidationResult[] = [];
    const validRowsToInsert: Array<{
      employeeCode: string;
      firstName: string;
      lastName: string;
      departmentId: string;
      supervisorName: string | null;
      supervisorEmail: string | null;
      nfcCode: string;
      existingCardId?: string;
      existingCardNumber?: string | null;
      existingIdentifierType?: string | null;
    }> = [];

    parsed.data.forEach((rawRow, idx) => {
      const rowNumber = idx + 2; // account for 1-based index and header
      const errors: string[] = [];

      const rawName = (
        rawRow.name_of_employee ??
        rawRow.employee_name ??
        rawRow.name ??
        rawRow.full_name ??
        ""
      ).trim();

      const rawNfc = DeduplicateRawScan(
        (rawRow.nfc_code ?? rawRow.card_uid ?? rawRow.nfc_uid ?? rawRow.nfc ?? "").trim()
      );
      const nfcCode = rawNfc.toUpperCase().replace(/\s+/g, "");

      const deptCode = (rawRow.department_code ?? rawRow.department ?? "").trim().toUpperCase();

      // Required fields
      if (!rawName) errors.push("Missing required field: name_of_employee");
      if (!nfcCode) {
        errors.push("Missing required field: nfc_code");
      } else if (nfcCode.length < 3) {
        errors.push(`Invalid nfc_code '${nfcCode}': Must be at least 3 characters.`);
      }
      if (!deptCode) errors.push("Missing required field: department_code");

      // Validate Department
      const dept = deptMap.get(deptCode);
      if (deptCode && !dept) {
        errors.push(
          `Invalid department_code '${deptCode}'. Valid codes: ${Array.from(
            new Set(allDepts.map((d) => d.code))
          ).join(", ")}`
        );
      }

      // Check NFC Card in DB
      const existingCard = nfcCode ? nfcCardMap.get(nfcCode) : undefined;
      if (existingCard) {
        if (existingCard.status === "ACTIVE" && existingCard.employeeId) {
          const holder = existingCard.employee
            ? `${existingCard.employee.firstName} ${existingCard.employee.lastName} (${existingCard.employee.employeeCode})`
            : "another employee";
          errors.push(`Duplicate nfc_code: '${nfcCode}' is already actively bound to ${holder}.`);
        } else if (["REVOKED", "LOST", "DAMAGED"].includes(existingCard.status)) {
          errors.push(
            `Cannot bind nfc_code '${nfcCode}': Card is permanently flagged as ${existingCard.status}.`
          );
        }
      }

      // Check Duplicate NFC Code within batch
      if (nfcCode && seenBatchNfcCodes.has(nfcCode)) {
        errors.push(`Duplicate nfc_code: '${nfcCode}' appears multiple times in this import file.`);
      } else if (nfcCode) {
        seenBatchNfcCodes.add(nfcCode);
      }

      const normalizedRow: NormalizedImportRow = {
        name_of_employee: rawName,
        nfc_code: nfcCode,
        department_code: dept ? dept.code : deptCode,
      };

      const isValid = errors.length === 0;
      validationResults.push({
        rowNumber,
        data: normalizedRow,
        isValid,
        errors,
      });

      if (isValid && dept) {
        const { firstName, lastName } = splitEmployeeName(rawName);
        const prefix = dept.code.toUpperCase();
        let candidateCode = `${prefix}-${String(nextSeq).padStart(3, "0")}`;
        while (usedEmployeeCodes.has(candidateCode)) {
          nextSeq++;
          candidateCode = `${prefix}-${String(nextSeq).padStart(3, "0")}`;
        }
        usedEmployeeCodes.add(candidateCode);
        nextSeq++;

        validRowsToInsert.push({
          employeeCode: candidateCode,
          firstName,
          lastName,
          departmentId: dept.id,
          supervisorName: dept.supervisorName || null,
          supervisorEmail: dept.supervisorEmail || null,
          nfcCode,
          existingCardId: existingCard?.id,
          existingCardNumber: existingCard?.cardNumber,
          existingIdentifierType: existingCard?.identifierType,
        });
      }
    });

    const totalRows = validationResults.length;
    const validCount = validRowsToInsert.length;
    const invalidCount = totalRows - validCount;

    // If commit was requested and valid rows are ready
    if (commit && validCount > 0) {
      const inserted = await db.$transaction(async (tx) => {
        const createdEmployees = [];
        for (const r of validRowsToInsert) {
          const emp = await tx.employee.create({
            data: {
              employeeCode: r.employeeCode,
              firstName: r.firstName,
              lastName: r.lastName,
              email: null,
              phoneNumber: null,
              departmentId: r.departmentId,
              designation: null,
              supervisorName: r.supervisorName,
              supervisorEmail: r.supervisorEmail,
              worksite: null,
              status: "ACTIVE",
              isActive: true,
            },
          });

          if (r.existingCardId) {
            await tx.nfcCard.update({
              where: { id: r.existingCardId },
              data: {
                employeeId: emp.id,
                status: "ACTIVE",
                enrolledByUserId: session.userId,
                cardNumber: r.existingCardNumber || `SN-${r.nfcCode}`,
                identifierType: r.existingIdentifierType || detectIdentifierType(r.nfcCode),
              },
            });
          } else {
            await tx.nfcCard.create({
              data: {
                cardUid: r.nfcCode,
                cardNumber: `SN-${r.nfcCode}`,
                identifierType: detectIdentifierType(r.nfcCode),
                readerSource: "DESK_READER",
                employeeId: emp.id,
                status: "ACTIVE",
                enrolledByUserId: session.userId,
              },
            });
          }

          createdEmployees.push(emp);
        }
        return createdEmployees;
      });

      await recordAuditLog({
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "EMPLOYEES_BULK_IMPORTED",
        entityType: "EMPLOYEE",
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

    // Return Validation Preview
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
    console.error("[Bulk Import Error]", error);
    return NextResponse.json({ error: "Failed to process bulk import" }, { status: 500 });
  }
}
