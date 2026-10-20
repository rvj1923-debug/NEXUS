import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { loadEnvIfNeeded } from "./backup-db.mjs";

loadEnvIfNeeded();

const prisma = new PrismaClient();

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

function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur.trim());
  return result;
}

function formatSupervisorNames(name1, name2) {
  const list = [name1, name2]
    .flatMap((v) => String(v || "").split(/\s*(?:\/|;|,|\s&\s)\s*/))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return null;
  const unique = [];
  for (const item of list) {
    if (!unique.some((u) => u.toLowerCase() === item.toLowerCase())) {
      unique.push(item);
    }
  }
  return unique.slice(0, 2).join(" / ");
}

function formatSupervisorEmails(email1, email2) {
  const rawList = [email1, email2]
    .flatMap((v) => String(v || "").split(/[,;]+/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (rawList.length === 0) return null;
  const unique = Array.from(new Set(rawList));
  return unique.slice(0, 2).join(", ");
}

function normalizeHeader(h) {
  const clean = String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (KNOWN_CODE_HEADERS.has(clean)) return "department_code";
  if (KNOWN_NAME_HEADERS.has(clean)) return "department_name";
  if (KNOWN_SUP1_NAME_HEADERS.has(clean)) return "supervisor_1_name";
  if (KNOWN_SUP1_EMAIL_HEADERS.has(clean)) return "supervisor_1_email";
  if (KNOWN_SUP2_NAME_HEADERS.has(clean)) return "supervisor_2_name";
  if (KNOWN_SUP2_EMAIL_HEADERS.has(clean)) return "supervisor_2_email";
  return clean;
}

function resolveCsvFilePath() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith("--file=")) {
      const val = arg.slice("--file=".length).trim().replace(/^["']|["']$/g, "");
      if (val && fs.existsSync(val)) return path.resolve(val);
    } else if (!arg.startsWith("-") && fs.existsSync(arg)) {
      return path.resolve(arg);
    }
  }

  const candidates = [
    process.env.SUPERVISORS_CSV_FILE,
    "C:\\ProgramData\\PhoneTracker\\supervisors.csv",
    "C:\\ProgramData\\PhoneTracker\\data\\supervisors.csv",
    path.join(process.cwd(), "supervisors.csv"),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return path.resolve(c);
    }
  }
  return null;
}

async function exportSupervisorsCsv(exportPath) {
  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  const escapeCsv = (val) => {
    const v = String(val || "").trim();
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const header =
    "department_code,department_name,supervisor_1_name,supervisor_1_email,supervisor_2_name,supervisor_2_email";

  const rows = departments.map((dept) => {
    const emails = String(dept.supervisorEmail || "")
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const names = String(dept.supervisorName || "")
      .split(/\s*(?:\/|;|,|\s&\s)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    return [
      escapeCsv(dept.code),
      escapeCsv(dept.name),
      escapeCsv(names[0]),
      escapeCsv(emails[0]),
      escapeCsv(names[1]),
      escapeCsv(emails[1]),
    ].join(",");
  });

  const csvContent = [header, ...rows].join("\n") + "\n";
  const resolved = path.resolve(exportPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, csvContent, "utf8");
  console.log(
    `[ImportSupervisors] Exported ${departments.length} department(s) to '${resolved}'.`
  );
}

async function main() {
  const exportArg = process.argv
    .slice(2)
    .find((a) => a.startsWith("--export="));
  if (exportArg) {
    const target = exportArg
      .slice("--export=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    await exportSupervisorsCsv(target || "supervisors.csv");
    return;
  }

  const csvPath = resolveCsvFilePath();
  if (!csvPath) {
    console.log("[ImportSupervisors] No supervisors.csv file specified or found; skipping bulk supervisor import.");
    return;
  }

  console.log(`[ImportSupervisors] Reading department supervisors from '${csvPath}'...`);
  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    console.log("[ImportSupervisors] File is empty; nothing to import.");
    return;
  }

  const firstCells = parseCsvLine(lines[0]).map(normalizeHeader);
  const hasHeader = firstCells.some(
    (c) =>
      c === "department_code" ||
      c === "department_name" ||
      c === "supervisor_1_name" ||
      c === "supervisor_1_email"
  );

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const byCode = new Map();

  for (const rawLine of dataLines) {
    const cols = parseCsvLine(rawLine);
    let code = "";
    let deptName = "";
    let s1Name = "";
    let s1Email = "";
    let s2Name = "";
    let s2Email = "";

    if (hasHeader) {
      const rowObj = {};
      firstCells.forEach((h, idx) => {
        rowObj[h] = cols[idx] || "";
      });
      code = String(rowObj.department_code || "").trim().toUpperCase();
      deptName = String(rowObj.department_name || "").trim();
      s1Name = String(rowObj.supervisor_1_name || "").trim();
      s1Email = String(rowObj.supervisor_1_email || "").trim().toLowerCase();
      s2Name = String(rowObj.supervisor_2_name || "").trim();
      s2Email = String(rowObj.supervisor_2_email || "").trim().toLowerCase();
    } else {
      code = String(cols[0] || "").trim().toUpperCase();
      const c1 = String(cols[1] || "").trim();
      const c2 = String(cols[2] || "").trim();
      const c3 = String(cols[3] || "").trim();
      const c4 = String(cols[4] || "").trim();
      const c5 = String(cols[5] || "").trim();

      if (c1.includes("@")) {
        s1Email = c1.toLowerCase();
        s2Email = c2.includes("@") ? c2.toLowerCase() : "";
      } else if (c2.includes("@") || (!c3.includes("@") && cols.length <= 5)) {
        s1Name = c1;
        s1Email = c2.toLowerCase();
        s2Name = c3;
        s2Email = c4.toLowerCase();
      } else {
        deptName = c1;
        s1Name = c2;
        s1Email = c3.toLowerCase();
        s2Name = c4;
        s2Email = c5.toLowerCase();
      }
    }

    if (!code) continue;

    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        deptName,
        s1Name,
        s1Email,
        s2Name,
        s2Email,
      });
    } else {
      const existing = byCode.get(code);
      if (!existing.s2Email && !existing.s2Name) {
        existing.s2Name = s1Name || s2Name;
        existing.s2Email = s1Email || s2Email;
      }
      if (!existing.deptName && deptName) {
        existing.deptName = deptName;
      }
    }
  }

  let updatedCount = 0;
  let createdCount = 0;
  let syncedCasesCount = 0;

  for (const entry of byCode.values()) {
    const combinedName = formatSupervisorNames(entry.s1Name, entry.s2Name);
    const combinedEmail = formatSupervisorEmails(entry.s1Email, entry.s2Email);

    const existingDept = await prisma.department.findFirst({
      where: {
        code: {
          equals: entry.code,
          mode: "insensitive",
        },
      },
    });

    let deptRecord;
    if (existingDept) {
      deptRecord = await prisma.department.update({
        where: { id: existingDept.id },
        data: {
          supervisorName: combinedName,
          supervisorEmail: combinedEmail,
          isActive: true,
        },
      });
      updatedCount++;
      console.log(
        `  [Updated] ${deptRecord.code} (${deptRecord.name}) -> Supervisor(s): ${combinedName || "None"} <${combinedEmail || "None"}>`
      );
    } else {
      const resolvedName = entry.deptName || `${entry.code} Department`;
      deptRecord = await prisma.department.create({
        data: {
          code: entry.code,
          name: resolvedName,
          supervisorName: combinedName,
          supervisorEmail: combinedEmail,
          isActive: true,
        },
      });
      createdCount++;
      console.log(
        `  [Created] ${deptRecord.code} (${deptRecord.name}) -> Supervisor(s): ${combinedName || "None"} <${combinedEmail || "None"}>`
      );
    }

    if (combinedEmail) {
      const casesRes = await prisma.overdueCase.updateMany({
        where: {
          employee: { departmentId: deptRecord.id },
          status: {
            notIn: ["RETURNED", "RESOLVED", "CLEARED", "CANCELLED"],
          },
        },
        data: {
          supervisorEmail: combinedEmail,
        },
      });
      syncedCasesCount += casesRes.count;
    }
  }

  console.log(
    `[ImportSupervisors] Completed: ${updatedCount} department(s) updated, ${createdCount} created, ${syncedCasesCount} active overdue case(s) synced.`
  );
}

main()
  .catch((e) => {
    console.error("[ImportSupervisors] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
