import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding default Kiosk devices...");

  const kiosks = [
    {
      kioskCode: "KIOSK-MAIN-01",
      name: "Main Lobby Self-Service Turnstile",
      location: "Ground Floor Tower 1 Lobby",
      readerIdentifier: "KIOSK-MAIN-01",
      status: "ACTIVE",
      displayLanguage: "EN",
      inactivityTimeoutSeconds: 30,
      notes: "Primary employee self-service kiosk with Mode A USB NFC reader",
    },
    {
      kioskCode: "KIOSK-GATE-A",
      name: "Operations Gate A Attendance Kiosk",
      location: "Logistics Hub Gate A",
      readerIdentifier: "KIOSK-GATE-A",
      status: "ACTIVE",
      displayLanguage: "EN",
      inactivityTimeoutSeconds: 45,
      notes: "High-throughput turnstile kiosk for field personnel",
    },
  ];

  for (const k of kiosks) {
    const existing = await prisma.kioskDevice.findUnique({
      where: { kioskCode: k.kioskCode },
    });

    if (!existing) {
      await prisma.kioskDevice.create({
        data: k,
      });
      console.log(`Created kiosk: ${k.kioskCode}`);
    } else {
      console.log(`Kiosk already exists: ${k.kioskCode}`);
    }
  }

  console.log("Kiosk seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
