import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking NFC cards to remove (UNASSIGNED or REVOKED)...");

  const cardsToRemove = await prisma.nfcCard.findMany({
    where: {
      OR: [
        { status: "UNASSIGNED" },
        { status: "REVOKED" },
        { revokedAt: { not: null } },
      ],
    },
    select: {
      id: true,
      cardUid: true,
      cardNumber: true,
      status: true,
    },
  });

  console.log(`Found ${cardsToRemove.length} unassigned/revoked cards to remove.`);

  const result = await prisma.nfcCard.deleteMany({
    where: {
      id: { in: cardsToRemove.map((c) => c.id) },
    },
  });

  console.log(`Successfully deleted ${result.count} unassigned/revoked NFC cards.`);

  const remaining = await prisma.nfcCard.findMany({
    select: {
      id: true,
      cardUid: true,
      cardNumber: true,
      status: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  console.log(`\nRemaining NFC Cards in DB (${remaining.length}):`);
  remaining.forEach((c) => {
    console.log(
      ` - UID: ${c.cardUid} | Badge: ${c.cardNumber} | Status: ${c.status} | Employee: ${c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : "None"}`
    );
  });
}

main()
  .catch((err) => {
    console.error("Error cleaning up NFC cards:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
