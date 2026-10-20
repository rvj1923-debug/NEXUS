import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit";
import {
  formatSupervisorEmails,
  formatSupervisorNames,
  isValidSupervisorEmailList,
} from "@/lib/supervisors";

export interface DepartmentImportRow {
  department_code: string;
  department_name: string;
  description?: string;
  supervisor_name?: string;
  supervisor_email?: string;
}

export interface RepeatingGroupSummary {
  key: string;
  code: string;
  name: string;
  repeatType: "EXACT_REPEAT" | "CODE_CONFLICT" | "NAME_CONFLICT";
  occurrences: number;
  firstRow: number;
  repeatRows: number[];
  details: string;
}

export interface DepartmentValidationResult {
  rowNumber: number;
  data: DepartmentImportRow;
  isValid: boolean;
  isRepeatingInFile: boolean;
  firstSeenRowNumber?: number;
  repeatedOnRows?: number[];
  action:
    | "CREATE"
    | "UPDATE"
    | "REACTIVATE"
    | "REPEAT_SKIPPED"
    | "REPEAT_ERROR"
    | "INVALID";
  errors: string[];
  warnings: string[];
}

const KNOWN_CODE_HEADERS = new Set([
  "department_code",
  "code",
  "initial",
  "initials",
  "department_initial",
  "dept_code",
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

function normalizeHeader(h: string): string {
  const clean = h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (KNOWN_CODE_HEADERS.has(clean)) return "department_code";
  if (KNOWN_NAME_HEADERS.has(clean)) return "department_name";
  if (["description", "desc", "notes", "remarks"].includes(clean)) return "description";
  if (
    [
      "supervisor_name",
      "supervisor",
      "head_name",
      "manager_name",
      "supervisor_1_name",
      "supervisor1_name",
      "primary_supervisor_name",
    ].includes(clean)
  )
    return "supervisor_name";
  if (
    [
      "supervisor_email",
      "email",
      "head_email",
      "manager_email",
      "supervisor_1_email",
      "supervisor1_email",
      "primary_supervisor_email",
    ].includes(clean)
  )
    return "supervisor_email";
  if (
    [
      "supervisor_2_name",
      "supervisor2_name",
      "secondary_supervisor_name",
      "co_supervisor_name",
    ].includes(clean)
  )
    return "supervisor_2_name";
  if (
    [
      "supervisor_2_email",
      "supervisor2_email",
      "secondary_supervisor_email",
      "co_supervisor_email",
    ].includes(clean)
  )
    return "supervisor_2_email";
  return clean;
}

function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
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
    let updateExisting = false;
    let skipRepeating = false;

    if (contentType.includes("application/json")) {
      const json = await request.json();
      csvString = json.csv || "";
      commit = Boolean(json.commit);
      updateExisting = Boolean(json.updateExisting);
      skipRepeating = Boolean(json.skipRepeating);
    } else {
      csvString = await request.text();
    }

    if (!csvString.trim()) {
      return NextResponse.json({ error: "No CSV content provided" }, { status: 400 });
    }

    // Detect whether the first line is a header row or raw data (e.g. "ITD,Information Technology Department")
    const firstLinePreview = Papa.parse<string[]>(csvString.trim().split(/\r?\n/)[0], {
      header: false,
    });
    const firstRowCells = (firstLinePreview.data[0] || []).map((c) =>
      String(c || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
    );
    const hasHeaderRow = firstRowCells.some(
      (cell) => KNOWN_CODE_HEADERS.has(cell) || KNOWN_NAME_HEADERS.has(cell)
    );

    let normalizedRows: DepartmentImportRow[] = [];

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

      normalizedRows = parsed.data.map((row) => ({
        department_code: (row.department_code || "").trim().toUpperCase(),
        department_name: (row.department_name || "").trim().replace(/\s+/g, " "),
        description: (row.description || "").trim(),
        supervisor_name:
          formatSupervisorNames(row.supervisor_name, row.supervisor_2_name) || "",
        supervisor_email:
          formatSupervisorEmails(row.supervisor_email, row.supervisor_2_email) || "",
      }));
    } else {
      // Headerless mode: col 0 = code/initial, col 1 = department name, col 2 = description, col 3 = supervisor_name, col 4 = supervisor_email
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

      normalizedRows = parsed.data.map((cols) => ({
        department_code: String(cols[0] || "").trim().toUpperCase(),
        department_name: String(cols[1] || "").trim().replace(/\s+/g, " "),
        description: String(cols[2] || "").trim(),
        supervisor_name:
          formatSupervisorNames(String(cols[3] || ""), String(cols[5] || "")) || "",
        supervisor_email:
          formatSupervisorEmails(String(cols[4] || ""), String(cols[6] || "")) || "",
      }));
    }

    // ============================================================================
    // PASS 1: FILE-WIDE REPEATING DEPARTMENT SCANNER
    // ============================================================================
    const codeRowsMap = new Map<string, Array<{ rowNumber: number; name: string; code: string }>>();
    const nameRowsMap = new Map<string, Array<{ rowNumber: number; name: string; code: string }>>();

    normalizedRows.forEach((row, idx) => {
      const rowNumber = hasHeaderRow ? idx + 2 : idx + 1;
      const code = row.department_code;
      const name = row.department_name;
      const nameKey = normalizeNameKey(name);

      if (code) {
        const list = codeRowsMap.get(code) || [];
        list.push({ rowNumber, name, code });
        codeRowsMap.set(code, list);
      }
      if (nameKey) {
        const list = nameRowsMap.get(nameKey) || [];
        list.push({ rowNumber, name, code });
        nameRowsMap.set(nameKey, list);
      }
    });

    const repeatingGroups: RepeatingGroupSummary[] = [];
    const processedRepeatKeys = new Set<string>();

    for (const [code, entries] of codeRowsMap.entries()) {
      if (entries.length > 1) {
        const firstEntry = entries[0];
        const repeatRows = entries.slice(1).map((e) => e.rowNumber);
        const distinctNames = Array.from(new Set(entries.map((e) => normalizeNameKey(e.name))));
        const isExact = distinctNames.length === 1;

        repeatingGroups.push({
          key: `CODE:${code}`,
          code,
          name: firstEntry.name,
          repeatType: isExact ? "EXACT_REPEAT" : "CODE_CONFLICT",
          occurrences: entries.length,
          firstRow: firstEntry.rowNumber,
          repeatRows,
          details: isExact
            ? `Department '${code} — ${firstEntry.name}' is repeated ${entries.length} times in the file (First at Row #${firstEntry.rowNumber}, repeated at Row ${repeatRows.map((r) => `#${r}`).join(", ")}).`
            : `Department code '${code}' is repeated ${entries.length} times with conflicting names across Row #${firstEntry.rowNumber} and Row ${repeatRows.map((r) => `#${r}`).join(", ")}.`,
        });

        if (isExact && firstEntry.name) {
          processedRepeatKeys.add(`NAME:${normalizeNameKey(firstEntry.name)}`);
        }
      }
    }

    for (const [nameKey, entries] of nameRowsMap.entries()) {
      if (entries.length > 1 && !processedRepeatKeys.has(`NAME:${nameKey}`)) {
        const firstEntry = entries[0];
        const repeatRows = entries.slice(1).map((e) => e.rowNumber);
        const distinctCodes = Array.from(new Set(entries.map((e) => e.code)));
        const isExact = distinctCodes.length === 1;

        repeatingGroups.push({
          key: `NAME:${nameKey}`,
          code: distinctCodes.join(" / "),
          name: firstEntry.name,
          repeatType: isExact ? "EXACT_REPEAT" : "NAME_CONFLICT",
          occurrences: entries.length,
          firstRow: firstEntry.rowNumber,
          repeatRows,
          details: `Department name '${firstEntry.name}' is repeated ${entries.length} times with different codes (${distinctCodes.join(", ")}) at Row #${firstEntry.rowNumber} and Row ${repeatRows.map((r) => `#${r}`).join(", ")}.`,
        });
      }
    }

    // ============================================================================
    // PASS 2: DATABASE LOOKUP & ROW-BY-ROW VALIDATION
    // ============================================================================
    const existingDepartments = await db.department.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
      },
    });

    const existingByCode = new Map<string, (typeof existingDepartments)[0]>();
    const existingByName = new Map<string, (typeof existingDepartments)[0]>();

    for (const d of existingDepartments) {
      existingByCode.set(d.code.toUpperCase(), d);
      existingByName.set(normalizeNameKey(d.name), d);
    }

    const firstSeenCodeRow = new Map<string, { rowNumber: number; name: string }>();
    const firstSeenNameRow = new Map<string, { rowNumber: number; code: string; name: string }>();

    const validationResults: DepartmentValidationResult[] = [];
    const validOperations: Array<{
      mode: "CREATE" | "UPDATE" | "REACTIVATE";
      existingId?: string;
      code: string;
      name: string;
      description: string | null;
      supervisorName: string | null;
      supervisorEmail: string | null;
    }> = [];

    let repeatingRowCount = 0;

    normalizedRows.forEach((row, idx) => {
      const rowNumber = hasHeaderRow ? idx + 2 : idx + 1;
      const errors: string[] = [];
      const warnings: string[] = [];

      const code = row.department_code;
      const existingDeptForCode = code ? existingByCode.get(code) : undefined;
      const name = row.department_name || existingDeptForCode?.name || "";
      if (!row.department_name && existingDeptForCode?.name) {
        row.department_name = existingDeptForCode.name;
      }
      const nameKey = normalizeNameKey(name);
      const description = row.description || "";
      const supervisorName = row.supervisor_name || "";
      const supervisorEmail = row.supervisor_email || "";

      // Required checks
      if (!code) {
        errors.push("Missing required field: department_code (e.g. ITD)");
      } else if (code.length > 15) {
        errors.push(`Department code '${code}' exceeds maximum length of 15 characters.`);
      } else if (!/^[A-Z0-9_-]+$/.test(code)) {
        errors.push(
          `Department code '${code}' must contain only letters, numbers, hyphens, or underscores.`
        );
      }

      if (!name) {
        errors.push(
          "Missing required field: department_name (e.g. Information Technology Department)"
        );
      }

      // Check supervisor email format if provided (supports 1 or 2 comma-separated emails)
      if (supervisorEmail && !isValidSupervisorEmailList(supervisorEmail)) {
        errors.push(`Invalid supervisor_email format: '${supervisorEmail}'`);
      }

      // Check repeating within the uploaded file
      let isRepeatingInFile = false;
      let isExactRepeat = false;
      let firstSeenRowNumber: number | undefined;
      let repeatedOnRows: number[] | undefined;

      const codeOccurrences = code ? codeRowsMap.get(code) || [] : [];
      const nameOccurrences = nameKey ? nameRowsMap.get(nameKey) || [] : [];

      const prevCodeEntry = code ? firstSeenCodeRow.get(code) : undefined;
      const prevNameEntry = nameKey ? firstSeenNameRow.get(nameKey) : undefined;

      if (prevCodeEntry || prevNameEntry) {
        isRepeatingInFile = true;
        repeatingRowCount++;

        if (
          prevCodeEntry &&
          prevNameEntry &&
          prevCodeEntry.rowNumber === prevNameEntry.rowNumber &&
          normalizeNameKey(prevCodeEntry.name) === nameKey
        ) {
          isExactRepeat = true;
          firstSeenRowNumber = prevCodeEntry.rowNumber;
          const allRows = codeOccurrences.map((o) => `#${o.rowNumber}`).join(", ");
          const msg = `Repeating department in file: Exact duplicate of Row #${prevCodeEntry.rowNumber} ('${code} — ${name}', appears ${codeOccurrences.length}x on rows ${allRows}).`;
          if (skipRepeating) {
            warnings.push(`${msg} (Automatically skipped)`);
          } else {
            errors.push(msg);
          }
        } else {
          if (prevCodeEntry) {
            firstSeenRowNumber = prevCodeEntry.rowNumber;
            errors.push(
              `Repeating department_code '${code}' in file: Already defined at Row #${prevCodeEntry.rowNumber} as '${prevCodeEntry.name}'.`
            );
          }
          if (prevNameEntry && (!prevCodeEntry || prevNameEntry.rowNumber !== prevCodeEntry.rowNumber)) {
            firstSeenRowNumber = firstSeenRowNumber || prevNameEntry.rowNumber;
            errors.push(
              `Repeating department_name '${name}' in file: Already defined at Row #${prevNameEntry.rowNumber} with code '${prevNameEntry.code}'.`
            );
          }
        }
      } else {
        if (code) {
          firstSeenCodeRow.set(code, { rowNumber, name });
        }
        if (nameKey) {
          firstSeenNameRow.set(nameKey, { rowNumber, code, name });
        }

        // If this is the 1st occurrence of a department that repeats later in the file, attach a helpful warning
        const laterCodeRepeats = codeOccurrences.filter((o) => o.rowNumber > rowNumber);
        const laterNameRepeats = nameOccurrences.filter((o) => o.rowNumber > rowNumber);
        const combinedLaterRows = Array.from(
          new Set([
            ...laterCodeRepeats.map((o) => o.rowNumber),
            ...laterNameRepeats.map((o) => o.rowNumber),
          ])
        ).sort((a, b) => a - b);

        if (combinedLaterRows.length > 0) {
          repeatedOnRows = combinedLaterRows;
          warnings.push(
            `1st occurrence in file — also repeated later at Row ${combinedLaterRows.map((r) => `#${r}`).join(", ")}.`
          );
        }
      }

      // Check against existing database records (only if not already a repeating row in the file)
      let actionMode: "CREATE" | "UPDATE" | "REACTIVATE" = "CREATE";
      let targetExistingId: string | undefined;

      if (!isRepeatingInFile) {
        const matchedByCode = code ? existingByCode.get(code) : undefined;
        const matchedByName = nameKey ? existingByName.get(nameKey) : undefined;

        if (matchedByCode) {
          if (!matchedByCode.isActive) {
            actionMode = "REACTIVATE";
            targetExistingId = matchedByCode.id;
          } else if (updateExisting) {
            actionMode = "UPDATE";
            targetExistingId = matchedByCode.id;
          } else {
            errors.push(
              `Department code '${code}' already exists in database ('${matchedByCode.name}'). Enable 'Update existing departments' to overwrite.`
            );
          }
        } else if (matchedByName) {
          if (!matchedByName.isActive) {
            actionMode = "REACTIVATE";
            targetExistingId = matchedByName.id;
          } else if (updateExisting) {
            actionMode = "UPDATE";
            targetExistingId = matchedByName.id;
          } else {
            errors.push(
              `Department name '${name}' already exists in database with code '${matchedByName.code}'.`
            );
          }
        }

        if (
          (actionMode === "UPDATE" || actionMode === "REACTIVATE") &&
          matchedByCode &&
          matchedByName &&
          matchedByCode.id !== matchedByName.id
        ) {
          errors.push(
            `Conflict: Code '${code}' belongs to '${matchedByCode.name}', while name '${name}' belongs to code '${matchedByName.code}'.`
          );
        }
      }

      const isSkippedRepeat = isRepeatingInFile && isExactRepeat && skipRepeating && errors.length === 0;
      const isValid = errors.length === 0 && !isRepeatingInFile;

      let rowAction: DepartmentValidationResult["action"] = "INVALID";
      if (isSkippedRepeat) {
        rowAction = "REPEAT_SKIPPED";
      } else if (isRepeatingInFile) {
        rowAction = "REPEAT_ERROR";
      } else if (isValid) {
        rowAction = actionMode;
      }

      validationResults.push({
        rowNumber,
        data: row,
        isValid,
        isRepeatingInFile,
        firstSeenRowNumber,
        repeatedOnRows,
        action: rowAction,
        errors,
        warnings,
      });

      if (isValid) {
        validOperations.push({
          mode: actionMode,
          existingId: targetExistingId,
          code,
          name,
          description: description || null,
          supervisorName: supervisorName || null,
          supervisorEmail: supervisorEmail || null,
        });
      }
    });

    const totalRows = validationResults.length;
    const validCount = validOperations.length;
    const invalidCount = validationResults.filter(
      (r) => !r.isValid && r.action !== "REPEAT_SKIPPED"
    ).length;

    if (commit && validCount > 0) {
      const processed = await db.$transaction(async (tx) => {
        const results = [];
        for (const op of validOperations) {
          if ((op.mode === "UPDATE" || op.mode === "REACTIVATE") && op.existingId) {
            const updated = await tx.department.update({
              where: { id: op.existingId },
              data: {
                code: op.code,
                name: op.name,
                ...(op.description !== null ? { description: op.description } : {}),
                ...(op.supervisorName !== null ? { supervisorName: op.supervisorName } : {}),
                ...(op.supervisorEmail !== null ? { supervisorEmail: op.supervisorEmail } : {}),
                isActive: true,
              },
            });
            results.push(updated);
          } else {
            const created = await tx.department.create({
              data: {
                code: op.code,
                name: op.name,
                description: op.description,
                supervisorName: op.supervisorName,
                supervisorEmail: op.supervisorEmail,
                isActive: true,
              },
            });
            results.push(created);
          }
        }
        return results;
      });

      await recordAuditLog({
        userId: session.userId,
        userEmail: session.email,
        userRole: session.roleCode,
        action: "DEPARTMENTS_BULK_IMPORTED",
        entityType: "DEPARTMENT",
        changes: {
          importedCount: processed.length,
          createdCount: validOperations.filter((o) => o.mode === "CREATE").length,
          updatedCount: validOperations.filter((o) => o.mode !== "CREATE").length,
          repeatingRowsDetected: repeatingRowCount,
          skippedInvalidCount: invalidCount,
        },
      });

      return NextResponse.json({
        success: true,
        committed: true,
        totalRows,
        importedCount: processed.length,
        repeatingCount: repeatingRowCount,
        repeatingGroups,
        invalidCount,
        results: validationResults,
      });
    }

    return NextResponse.json({
      success: true,
      committed: false,
      totalRows,
      validCount,
      repeatingCount: repeatingRowCount,
      repeatingGroups,
      invalidCount,
      canCommit: validCount > 0,
      results: validationResults,
    });
  } catch (error: any) {
    console.error("[Department Bulk Import Error]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process department bulk import" },
      { status: 500 }
    );
  }
}
