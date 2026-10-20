import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  await db.nfcReader.updateMany({
    where: { readerIdentifier: "KIOSK-GATE-A" },
    data: {
      connectionMode: "MODE_A_KEYBOARD_WEDGE",
      vendorId: "FFFF",
      productId: "0035",
      deviceInstanceId: "USB\\VID_FFFF&PID_0035\\E4D155F50F01",
      pairedKiosk: "KIOSK-GATE-A",
      agentVersion: "1.0.0-phase3",
      status: "ONLINE",
      lastHeartbeatAt: new Date(),
    },
  });

  await db.nfcReader.updateMany({
    where: { readerIdentifier: "DESK-CUSTODY-01" },
    data: {
      connectionMode: "MODE_A_KEYBOARD_WEDGE",
      vendorId: "FFFF",
      productId: "0035",
      deviceInstanceId: "USB\\VID_FFFF&PID_0035\\E4D155F50F01",
      pairedKiosk: "DESK-CUSTODY-01",
      agentVersion: "1.0.0-phase3",
      status: "ONLINE",
      lastHeartbeatAt: new Date(),
    },
  });

  console.log("Updated readers with detected hardware parameters.");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
