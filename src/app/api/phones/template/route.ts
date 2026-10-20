import { NextResponse } from "next/server";

export async function GET() {
  const header = "asset_tag,brand,model,imei,imei2,serial_number,department_code,condition,accessories,mobile_number\n";
  const sample1 = "PHN-2026-001,OUKITEL,OUKITEL G1,354892019482011,,SN-OUK-001,OPS,EXCELLENT,Charger, Rugged Case,+1-555-0201\n";
  const sample2 = "PHN-2026-002,OUKITEL,OUKITEL G1,358912093847122,,SN-OUK-002,ENG,EXCELLENT,Fast Charger, Rugged Case,+1-555-0202\n";
  const sample3 = "PHN-2026-003,OUKITEL,OUKITEL G1,352981049281933,,SN-OUK-003,FLD,GOOD,Standard Charger, Rugged Case,+1-555-0203\n";

  const csv = header + sample1 + sample2 + sample3;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="company_phone_import_template.csv"',
    },
  });
}
