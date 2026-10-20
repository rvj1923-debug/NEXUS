import { NextResponse } from "next/server";

export async function GET() {
  const header = "department_code,department_name,description,supervisor_name,supervisor_email\n";
  const sample1 = "ITD,Information Technology Department,IT Infrastructure and Systems Support,Roberto Mendoza,it.supervisor@company.com\n";
  const sample2 = "HRD,Human Resources Department,Personnel Administration and Employee Relations,Maria Santos,hr.supervisor@company.com\n";
  const sample3 = "FIN,Finance and Accounting Department,Corporate Finance and Accounting Operations,Carlos Reyes,finance.supervisor@company.com\n";
  const sample4 = "OPS,Operations and Logistics Department,Warehouse and Field Operations,,\n";
  const sample5 = "QAD,Quality Assurance Department,Quality Control and Compliance Inspection,,\n";

  const csv = header + sample1 + sample2 + sample3 + sample4 + sample5;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="department_bulk_import_template.csv"',
    },
  });
}
