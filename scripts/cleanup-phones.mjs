import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking records related to PhoneAsset...");
  
  const phoneCount = await prisma.phoneAsset.count();
  console.log(`Current PhoneAsset count: ${phoneCount}`);

  const models = await prisma.phoneAsset.groupBy({
    by: ["brand", "model"],
    _count: true,
  });
  console.log("Distinct phone models currently in DB:");
  models.forEach((m) => {
    console.log(` - ${m.brand} ${m.model}: ${m._count} devices`);
  });

  const nfcWithPhone = await prisma.nfcCard.count({
    where: { phoneAssetId: { not: null } },
  });
  console.log(`NfcCards linked to phones: ${nfcWithPhone}`);

  const assignments = await prisma.phoneAssignment.count();
  console.log(`Phone assignments: ${assignments}`);

  const transactions = await prisma.custodyTransaction.count();
  console.log(`Custody transactions: ${transactions}`);

  const custodyEvents = await prisma.custodyEvent.count();
  console.log(`Custody events: ${custodyEvents}`);

  const deadlines = await prisma.returnDeadline.count();
  console.log(`Return deadlines: ${deadlines}`);

  const overdue = await prisma.overdueCase.count();
  console.log(`Overdue cases: ${overdue}`);

  const incidents = await prisma.incident.count();
  console.log(`Incidents: ${incidents}`);

  const notifications = await prisma.notification.count();
  console.log(`Notifications: ${notifications}`);

  const kioskRequests = await prisma.kioskVerificationRequest.count();
  console.log(`Kiosk requests: ${kioskRequests}`);

  console.log("\nStarting deletion of all phone models and assets...");

  await prisma.$transaction(async (tx) => {
    // 1. Unlink or clean up NfcCards attached to phones
    const unlinkedNfc = await tx.nfcCard.updateMany({
      where: { phoneAssetId: { not: null } },
      data: { phoneAssetId: null, status: "UNASSIGNED" },
    });
    console.log(`Unlinked ${unlinkedNfc.count} NFC cards from phones.`);

    // 2. Clear foreign keys on Incidents or delete phone-related incidents
    const updatedIncidents = await tx.incident.updateMany({
      where: { phoneAssetId: { not: null } },
      data: { phoneAssetId: null, custodyTransactionId: null },
    });
    console.log(`Updated ${updatedIncidents.count} incidents to detach phones.`);

    // 3. Delete any phone assignments if any exist
    const deletedAssignments = await tx.phoneAssignment.deleteMany({});
    console.log(`Deleted ${deletedAssignments.count} phone assignments.`);

    // 4. Delete custody transactions if any
    const deletedTrans = await tx.custodyTransaction.deleteMany({});
    console.log(`Deleted ${deletedTrans.count} custody transactions.`);

    // 5. Delete custody events
    const deletedEvents = await tx.custodyEvent.deleteMany({});
    console.log(`Deleted ${deletedEvents.count} custody events.`);

    // 6. Delete return deadlines
    const deletedDeadlines = await tx.returnDeadline.deleteMany({});
    console.log(`Deleted ${deletedDeadlines.count} return deadlines.`);

    // 7. Delete overdue cases
    const deletedOverdue = await tx.overdueCase.deleteMany({});
    console.log(`Deleted ${deletedOverdue.count} overdue cases.`);

    // 8. Delete kiosk verification requests
    const deletedKiosk = await tx.kioskVerificationRequest.deleteMany({});
    console.log(`Deleted ${deletedKiosk.count} kiosk requests.`);

    // 9. Update notifications
    const updatedNotifs = await tx.notification.updateMany({
      where: { phoneAssetId: { not: null } },
      data: { phoneAssetId: null },
    });
    console.log(`Updated ${updatedNotifs.count} notifications.`);

    // 10. Delete all PhoneAsset records
    const deletedPhones = await tx.phoneAsset.deleteMany({});
    console.log(`Deleted ${deletedPhones.count} phone assets.`);
  });

  const remainingPhones = await prisma.phoneAsset.count();
  console.log(`\nVerification: PhoneAsset count in DB is now: ${remainingPhones}`);
}

main()
  .catch((err) => {
    console.error("Error during phone cleanup:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
