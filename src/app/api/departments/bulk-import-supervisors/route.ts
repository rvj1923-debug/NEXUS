import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import {
  formatSupervisorEmails,
  formatSupervisorNames,
  isValidSupervisorEmailList,
  parseSupervisors,
} from "@/lib/supervisors";

export interface SupervisorBulkImportRow {
  department_code: string;
  department_name?: string;
  supervisor_1_name?: string;
  supervisor_1_email?: string;
  supervisor_2_name?: string;
  supervisor_2_email?: string;
}

export interface SupervisorBulkValidationResult {
  rowNumber: number;
  data: SupervisorBulkImportRow;
  resolvedDepartmentName: string;
  combinedSupervisorName: string | null;
  combinedSupervisorEmail: string | null;
  previousSupervisorName: string | null;
  previousSupervisorEmail: string | null;
  isValid: boolean;
  action: "UPDATE" | "CREATE_DEPT" | "MERGED_INTO_FIRST" | "INVALID";
  errors: string[];
  warnings: string[];
}

const KNOWN_CODE_HEADERS = new Set([
  "department_code",
  "code",
  "dept_code",
  "initial",
  "initials",
  "department_initial",
  "dept_initial",
  "acronym",
  "dept",
]);

const KNOWN_NAME_HEADERS = new Set([
  "department_name",
  "name",
  "department",
  "dept_name",
  "full_name",
  "title",
]);

const KNOWN_SUP1_NAME_HEADERS = new Set([
  "supervisor_1_name",
  "supervisor1_name",
  "supervisor_name",
  "supervisor",
  "primary_supervisor_name",
  "sup1_name",
  "head_name",
  "manager_name",
  "supervisor_1",
]);

const KNOWN_SUP1_EMAIL_HEADERS = new Set([
  "supervisor_1_email",
  "supervisor1_email",
  "supervisor_email",
  "email",
  "primary_supervisor_email",
  "sup1_email",
  "head_email",
  "manager_email",
  "supervisor_1_mail",
]);

const KNOWN_SUP2_NAME_HEADERS = new Set([
  "supervisor_2_name",
  "supervisor2_name",
  "secondary_supervisor_name",
  "sup2_name",
  "supervisor_2",
  "co_supervisor_name",
  "second_supervisor_name",
]);

const KNOWN_SUP2_EMAIL_HEADERS = new Set([
  "supervisor_2_email",
  "supervisor2_email",
  "secondary_supervisor_email",
  "sup2_email",
  "co_supervisor_email",
  "second_supervisor_email",
  "supervisor_2_mail",
]);

function normalizeHeader(h: string): string {
  const clean = h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (KNOWN_CODE_HEADERS.has(clean)) return "department_code";
  if (KNOWN_NAME_HEADERS.has(clean)) return "department_name";
  if (KNOWN_SUP1_NAME_HEADERS.has(clean)) return "supervisor_1_name";
  if (KNOWN_SUP1_EMAIL_HEADERS.has(clean)) return "supervisor_1_email";
  if (KNOWN_SUP2_NAME_HEADERS.has(clean)) return "supervisor_2_name";
  if (KNOWN_SUP2_EMAIL_HEADERS.has(clean)) return "supervisor_2_email";
  return clean;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    let csvString = "";
    let commit = false;
    let createMissingDepts = true;
    let mergeDuplicateCodeRows = true;

    if (contentType.includes("application/json")) {
      const json = await request.json();
      csvString = json.csv || "";
      commit = Boolean(json.commit);
      if (typeof json.createMissingDepts === "boolean") {
        createMissingDepts = json.createMissingDepts;
      }
      if (typeof json.mergeDuplicateCodeRows === "boolean") {
        mergeDuplicateCodeRows = json.mergeDuplicateCodeRows;
      }
    } else {
      csvString = await request.text();
    }

    if (!csvString.trim()) {
      return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });
    }

    const firstLinePreview = Papa.parse<string[]>(csvString.trim().split(/\r?\n/)[0], {
      header: false,
    });
    const firstRowCells = (firstLinePreview.data[0] || []).map((c) =>
      String(c || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    );
    const hasHeaderRow = firstRowCells.some(
      (cell) =>
        KNOWN_CODE_HEADERS.has(cell) ||
        KNOWN_NAME_HEADERS.has(cell) ||
        KNOWN_SUP1_NAME_HEADERS.has(cell) ||
        KNOWN_SUP1_EMAIL_HEADERS.has(cell)
    );

    let rawRows: SupervisorBulkImportRow[] = [];

    if (hasHeaderRow) {
      const parsed = Papa.parse<Record<string, string>>(csvString, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: normalizeHeader,
      });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return NextResponse.json(
          { error: "CSV parsing error", details: parsed.errors.map((e) => e.message) },
          { status: 400 }
        );
      }

      rawRows = parsed.data.map((row) => {
        // Also support combined supervisor_name / supervisor_email if 2 supervisors were put in one column
        let s1Name = (row.supervisor_1_name || "").trim();
        let s1Email = (row.supervisor_1_email || "").trim().toLowerCase();
        let s2Name = (row.supervisor_2_name || "").trim();
        let s2Email = (row.supervisor_2_email || "").trim().toLowerCase();

        if ((!s2Name && !s2Email) && (s1Email.includes(",") || s1Email.includes(";") || s1Name.includes("/"))) {
          const split = parseSupervisors(s1Name, s1Email);
          s1Name = split.supervisor1Name;
          s1Email = split.supervisor1Email;
          s2Name = split.supervisor2Name;
          s2Email = split.supervisor2Email;
        }

        return {
          department_code: (row.department_code || "").trim().toUpperCase(),
          department_name: (row.department_name || "").trim().replace(/\s+/g, " "),
          supervisor_1_name: s1Name,
          supervisor_1_email: s1Email,
          supervisor_2_name: s2Name,
          supervisor_2_email: s2Email,
        };
      });
    } else {
      const parsed = Papa.parse<string[]>(csvString, {
        header: false,
        skipEmptyLines: "greedy",
      });

      if (parsed.errors.length > 0 && parsed.data.length === 0) {
        return NextResponse.json(
          { error: "CSV parsing error", details: parsed.errors.map((e) => e.message) },
          { status: 400 }
        );
      }

      rawRows = parsed.data.map((cols) => {
        const c0 = String(cols[0] || "").trim().toUpperCase();
        const c1 = String(cols[1] || "").trim();
        const c2 = String(cols[2] || "").trim();
        const c3 = String(cols[3] || "").trim();
        const c4 = String(cols[4] || "").trim();
        const c5 = String(cols[5] || "").trim();

        // Format A: CODE, email1 [, email2]
        if (c1.includes("@")) {
          return {
            department_code: c0,
            department_name: "",
            supervisor_1_name: "",
            supervisor_1_email: c1.toLowerCase(),
            supervisor_2_name: "",
            supervisor_2_email: c2.includes("@") ? c2.toLowerCase() : "",
          };
        }
        // Format B: CODE, sup1_name, sup1_email [, sup2_name, sup2_email]
        if (c2.includes("@") || (!c3.includes("@") && cols.length <= 5)) {
          return {
            department_code: c0,
            department_name: "",
            supervisor_1_name: c1,
            supervisor_1_email: c2.toLowerCase(),
            supervisor_2_name: c3,
            supervisor_2_email: c4.toLowerCase(),
          };
        }
        // Format C: CODE, dept_name, sup1_name, sup1_email, sup2_name, sup2_email
        return {
          department_code: c0,
          department_name: c1,
          supervisor_1_name: c2,
          supervisor_1_email: c3.toLowerCase(),
          supervisor_2_name: c4,
          supervisor_2_email: c5.toLowerCase(),
        };
      });
    }

    const existingDepartments = await db.department.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        supervisorName: true,
        supervisorEmail: true,
        isActive: true,
      },
    });

    const existingByCode = new Map<string, (typeof existingDepartments)[0]>();
    for (const d of existingDepartments) {
      existingByCode.set(d.code.toUpperCase(), d);
    }

    // Group rows by department_code if mergeDuplicateCodeRows is true (e.g., 2 rows for the same department code)
    const firstRowIndexByCode = new Map<string, number>();
    const mergedRows: Array<{
      rowNumber: number;
      row: SupervisorBulkImportRow;
      mergedFromRows: number[];
      mergedIntoRow?: number;
    }> = rawRows.map((row, idx) => ({
      rowNumber: hasHeaderRow ? idx + 2 : idx + 1,
      row: { ...row },
      mergedFromRows: [],
    }));

    if (mergeDuplicateCodeRows) {
      for (let i = 0; i < mergedRows.length; i++) {
        const entry = mergedRows[i];
        const code = entry.row.department_code;
        if (!code) continue;

        const prevIdx = firstRowIndexByCode.get(code);
        if (prevIdx === undefined) {
          firstRowIndexByCode.set(code, i);
        } else {
          const primary = mergedRows[prevIdx];
          entry.mergedIntoRow = primary.rowNumber;
          primary.mergedFromRows.push(entry.rowNumber);

          // If primary doesn't have supervisor 2 yet, promote entry's supervisor 1 into primary's supervisor 2
          if (!primary.row.supervisor_2_email && !primary.row.supervisor_2_name) {
            primary.row.supervisor_2_name =
              entry.row.supervisor_1_name || entry.row.supervisor_2_name || "";
            primary.row.supervisor_2_email =
              entry.row.supervisor_1_email || entry.row.supervisor_2_email || "";
          }
          if (!primary.row.department_name && entry.row.department_name) {
            primary.row.department_name = entry.row.department_name;
          }
        }
      }
    }

    const validationResults: SupervisorBulkValidationResult[] = [];
    const validOperations: Array<{
      mode: "UPDATE" | "CREATE_DEPT";
      existingId?: string;
      code: string;
      name: string;
      supervisorName: string | null;
      supervisorEmail: string | null;
    }> = [];

    for (const entry of mergedRows) {
      const { rowNumber, row, mergedFromRows, mergedIntoRow } = entry;
      const errors: string[] = [];
      const warnings: string[] = [];

      const code = row.department_code;
      const existingDept = code ? existingByCode.get(code) : undefined;
      const resolvedName =
        row.department_name || existingDept?.name || (code ? `${code} Department` : "—");

      const combinedName = formatSupervisorNames(row.supervisor_1_name, row.supervisor_2_name);
      const combinedEmail = formatSupervisorEmails(row.supervisor_1_email, row.supervisor_2_email);

      if (mergedIntoRow !== undefined) {
        warnings.push(
          `Merged as 2nd supervisor into Row #${mergedIntoRow} for department '${code}'.`
        );
        validationResults.push({
          rowNumber,
          data: row,
          resolvedDepartmentName: resolvedName,
          combinedSupervisorName: combinedName,
          combinedSupervisorEmail: combinedEmail,
          previousSupervisorName: existingDept?.supervisorName || null,
          previousSupervisorEmail: existingDept?.supervisorEmail || null,
          isValid: false,
          action: "MERGED_INTO_FIRST",
          errors: [],
          warnings,
        });
        continue;
      }

      if (!code) {
        errors.push("Missing required field: department_code (e.g. ITD)");
      } else if (code.length > 15) {
        errors.push(`Department code '${code}' exceeds maximum length of 15 characters.`);
      } else if (!/^[A-Z0-9_-]+$/.test(code)) {
        errors.push(
          `Department code '${code}' must contain only letters, numbers, hyphens, or underscores.`
        );
      }

      if (row.supervisor_1_email && !isValidSupervisorEmailList(row.supervisor_1_email)) {
        errors.push(`Invalid Supervisor 1 email format: '${row.supervisor_1_email}'`);
      }
      if (row.supervisor_2_email && !isValidSupervisorEmailList(row.supervisor_2_email)) {
        errors.push(`Invalid Supervisor 2 email format: '${row.supervisor_2_email}'`);
      }

      if (!combinedEmail && !combinedName) {
        warnings.push(
          `No supervisor name or email specified for '${code}' — supervisor fields will be cleared.`
        );
      }

      if (mergedFromRows.length > 0) {
        warnings.push(
          `Combined with Row ${mergedFromRows.map((r) => `#${r}`).join(", ")} for department '${code}'.`
        );
      }

      let actionMode: "UPDATE" | "CREATE_DEPT" = "UPDATE";
      if (!existingDept) {
        if (createMissingDepts) {
          actionMode = "CREATE_DEPT";
          warnings.push(
            `Department code '${code}' does not exist yet — will be auto-created as '${resolvedName}'.`
          );
        } else {
          errors.push(
            `Department code '${code}' was not found in the database. Enable 'Auto-create missing departments' or create the department first.`
          );
        }
      }

      const isValid = errors.length === 0;

      validationResults.push({
        rowNumber,
        data: row,
        resolvedDepartmentName: resolvedName,
        combinedSupervisorName: combinedName,
        combinedSupervisorEmail: combinedEmail,
        previousSupervisorName: existingDept?.supervisorName || null,
        previousSupervisorEmail: existingDept?.supervisorEmail || null,
        isValid,
        action: isValid ? actionMode : "INVALID",
        errors,
        warnings,
      });

      if (isValid) {
        validOperations.push({
          mode: actionMode,
          existingId: existingDept?.id,
          code,
          name: resolvedName,
          supervisorName: combinedName,
          supervisorEmail: combinedEmail,
        });
      }
    }

    const totalRows = validationResults.length;
    const validCount = validOperations.length;
    const mergedCount = validationResults.filter((r) => r.action === "MERGED_INTO_FIRST").length;
    const invalidCount = validationResults.filter((r) => r.action === "INVALID").length;

    if (commit && validCount > 0) {
      let syncedOverdueCasesCount = 0;

      const processed = await db.$transaction(async (tx) => {
        const results = [];
        for (const op of validOperations) {
          let deptRecord;
          if (op.mode === "UPDATE" && op.existingId) {
            deptRecord = await tx.department.update({
              where: { id: op.existingId },
              data: {
                supervisorName: op.supervisorName,
                supervisorEmail: op.supervisorEmail,
                isActive: true,
              },
            });
          } else {
            deptRecord = await tx.department.create({
              data: {
                code: op.code,
                name: op.name,
                supervisorName: op.supervisorName,
                supervisorEmail: op.supervisorEmail,
                isActive: true,
              },
            });
          }
          results.push(deptRecord);

          // Also sync open OverdueCase records for employees in this department if supervisorEmail is set
          if (op.supervisorEmail) {
            const updatedCases = await tx.overdueCase.updateMany({
              where: {
                employee: { departmentId: deptRecord.id },
                status: {
                  notIn: ["RETURNED", "RESOLVED", "CLEARED", "CANCELLED"],
                },
              },
              data: {
                supervisorEmail: op.supervisorEmail,
              },
            });
            syncedOverdueCasesCount += updatedCases.count;
          }
        }
        return results;
      });

      await recordAuditLog({
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "DEPARTMENT_SUPERVISORS_BULK_IMPORTED",
        entityType: "DEPARTMENT",
        changes: {
          updatedDepartmentsCount: processed.length,
          createdDepartmentsCount: validOperations.filter((o) => o.mode === "CREATE_DEPT").length,
          mergedRowsCount: mergedCount,
          syncedOverdueCasesCount,
          departmentCodes: validOperations.map((o) => o.code),
        },
      });

      return NextResponse.json({
        success: true,
        committed: true,
        totalRows,
        importedCount: processed.length,
        mergedCount,
        invalidCount,
        syncedOverdueCasesCount,
        results: validationResults,
      });
    }

    return NextResponse.json({
      success: true,
      committed: false,
      totalRows,
      validCount,
      mergedCount,
      invalidCount,
      canCommit: validCount > 0,
      results: validationResults,
    });
  } catch (error: any) {
    console.error("[Bulk Import Supervisors Error]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process bulk supervisor import" },
      { status: 500 }
    );
  }
}
