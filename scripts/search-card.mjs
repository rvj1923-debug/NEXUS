import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const emp = await db.employee.findUnique({
    where: { employeeCode: "ENG-009" },
    include: {
      department: true,
      nfcCards: true,
      assignments: {
        include: { phoneAsset: true },
      },
    },
  });
  console.log("Jane Doe Record:", JSON.stringify(emp, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
