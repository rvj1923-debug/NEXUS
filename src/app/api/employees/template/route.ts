import { NextResponse } from "next/server";

export async function GET() {
  const header = "name_of_employee,nfc_code,department_code\n";
  const sample1 = "Alexander Wright,04:A1:2B:3C,OPS\n";
  const sample2 = "Elena Rostova,04:D4:5E:6F,ENG\n";
  const sample3 = "Marcus Brody,04:7A:8B:9C,FLD\n";

  const csv = header + sample1 + sample2 + sample3;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="employee_bulk_import_template.csv"',
    },
  });
}
