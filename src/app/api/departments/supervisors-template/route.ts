import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSupervisors } from "@/lib/supervisors";

function escapeCsvCell(val?: string | null): string {
  const v = (val || "").trim();
  if (!v) return "";
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export async function GET() {
  const header =
    "department_code,department_name,supervisor_1_name,supervisor_1_email,supervisor_2_name,supervisor_2_email\n";

  try {
    const departments = await db.department.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    });

    if (departments.length > 0) {
      const rows = departments.map((dept) => {
        const parsed = parseSupervisors(dept.supervisorName, dept.supervisorEmail);
        return [
          escapeCsvCell(dept.code),
          escapeCsvCell(dept.name),
          escapeCsvCell(parsed.supervisor1Name),
          escapeCsvCell(parsed.supervisor1Email),
          escapeCsvCell(parsed.supervisor2Name),
          escapeCsvCell(parsed.supervisor2Email),
        ].join(",");
      });

      const csv = header + rows.join("\n") + "\n";
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="department_supervisors_bulk_template.csv"',
        },
      });
    }
  } catch {
    // Fallback to static sample if DB is unreachable
  }

  const sample =
    header +
    "ITD,Information Technology Department,Robby Ramirez Rivera,itsupport.pbi@gmail.com,Jayson The Legend,rvj1923@gmail.com\n" +
    "HRD,Human Resources Department,Maria Santos,hr.supervisor@company.com,,\n" +
    "FIN,Finance and Accounting Department,Carlos Reyes,finance.supervisor@company.com,,\n" +
    "OPS,Operations and Logistics Department,Marcus Vance,ops.supervisor@company.com,,\n";

  return new NextResponse(sample, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="department_supervisors_bulk_template.csv"',
    },
  });
}
