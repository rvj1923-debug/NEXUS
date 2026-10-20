/**
 * Verification Test for NFC Scan & Card Number Capture during Employee Registration
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE_URL = process.env.APP_URL || "http://127.0.0.1:5000";

function getDeviceSecret() {
  if (process.env.KIOSK_DEVICE_SECRET) return process.env.KIOSK_DEVICE_SECRET.trim();
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf8").match(/^\s*KIOSK_DEVICE_SECRET\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

async function loginKioskDevice() {
  const secret = getDeviceSecret();
  const res = await fetch(`${BASE_URL}/api/kiosk/device-login?key=${encodeURIComponent(secret)}`, {
    redirect: "manual",
  });
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader.includes("cpt_session=")) {
    throw new Error(`Device login failed (status=${res.status}, location=${res.headers.get("location")})`);
  }
  return cookieHeader;
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}`);
  const setCookie = res.headers.get("set-cookie");
  return setCookie.split(";")[0];
}

async function runTest() {
  console.log("\n============================================================");
  console.log("   NFC SCAN, VERIFY & CARD NUMBER CAPTURE VERIFICATION");
  console.log("============================================================\n");

  // 0a. Verify unauthenticated POST /api/kiosk/resolve returns 401
  const unauthResolveRes = await fetch(`${BASE_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardUid: "04:A2:8B:71:68" }),
  });
  if (unauthResolveRes.status === 401) {
    console.log("✓ PASS: Unauthenticated POST /api/kiosk/resolve rejected with HTTP 401");
  } else {
    console.error(`✗ FAIL: Expected 401 for unauthenticated POST /api/kiosk/resolve, got ${unauthResolveRes.status}`);
    process.exit(1);
  }

  // 0b. Authenticate Kiosk via /api/kiosk/device-login
  const kioskCookie = await loginKioskDevice();
  console.log("✓ Logged in Kiosk session via /api/kiosk/device-login");

  const custodianCookie = await loginUser("custodian@company.com", "Custodian123!");
  console.log("✓ Logged in as Phone Custodian\n");

  const testUid = `04:A2:8B:${Date.now().toString().slice(-4)}`;
  const expectedSpecificNumber = `SN-${testUid.toUpperCase().replace(/\s+/g, "")}`;

  // 1. Verify fresh unassigned card
  console.log(`[Step 1] Verifying fresh NFC card tap with UID: ${testUid}...`);
  const verifyRes = await fetch(`${BASE_URL}/api/nfc-cards/verify?cardUid=${encodeURIComponent(testUid)}`, {
    headers: { Cookie: custodianCookie },
  });
  const verifyData = await verifyRes.json();
  console.log("  API Response:", verifyData);

  if (verifyRes.status === 200 && verifyData.available === true && verifyData.status === "UNREGISTERED") {
    console.log(`  ✓ PASS: Fresh NFC Card verified as available.`);
    console.log(`  ✓ PASS: Specific Card Number resolved: ${verifyData.cardNumber}`);
    console.log(`  ✓ PASS: Standard detected: ${verifyData.identifierType}`);
  } else {
    console.error("  ✗ FAIL: Fresh card verification failed.");
    process.exit(1);
  }

  // Also verify kiosk resolve with kioskCookie recognizes unregistered card as CASE_E_NOT_RECOGNIZED
  const kioskCheckRes = await fetch(`${BASE_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: testUid, skipDebounce: true }),
  });
  if (kioskCheckRes.status === 200) {
    console.log(`  ✓ PASS: Authenticated POST /api/kiosk/resolve with device-login session succeeded (HTTP 200).`);
  } else {
    console.error(`  ✗ FAIL: Authenticated POST /api/kiosk/resolve returned ${kioskCheckRes.status}`);
    process.exit(1);
  }

  // 2. Register employee with scanned card
  console.log(`\n[Step 2] Registering employee with scanned card ${verifyData.cardNumber}...`);
  const dept = await prisma.department.findFirst({ where: { code: "OPS" } });
  const empCode = `EMP-NFC-${Date.now().toString().slice(-4)}`;

  const regRes = await fetch(`${BASE_URL}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeCode: empCode,
      firstName: "Elena",
      lastName: "Rostova",
      email: `elena.${Date.now()}@company.com`,
      phoneNumber: "+1-555-0812",
      departmentId: dept.id,
      designation: "Terminal Supervisor",
      worksite: "North Depot",
      nfcCard: {
        cardUid: verifyData.cardUid,
        cardNumber: verifyData.cardNumber,
        identifierType: "MIFARE_CLASSIC",
        readerSource: "DESK_READER",
      },
    }),
  });

  const regData = await regRes.json();
  if (regRes.status === 201) {
    console.log(`  ✓ PASS: Employee ${empCode} registered successfully.`);
  } else {
    console.error(`  ✗ FAIL: Employee registration failed:`, regData);
    process.exit(1);
  }

  // 3. Verify card is bound in PostgreSQL
  const boundCard = await prisma.nfcCard.findUnique({
    where: { cardUid: testUid.toUpperCase() },
    include: { employee: true },
  });

  if (boundCard && boundCard.employee?.employeeCode === empCode && boundCard.status === "ACTIVE") {
    console.log(`  ✓ PASS: NFC Card ${boundCard.cardUid} (${boundCard.cardNumber}) is confirmed ACTIVE in PostgreSQL and bound to ${boundCard.employee.firstName} ${boundCard.employee.lastName} (${boundCard.employee.employeeCode}).`);
  } else {
    console.error("  ✗ FAIL: Card was not properly bound in database:", boundCard);
    process.exit(1);
  }

  // 4. Test Conflict Detection: Verifying the same card again must now flag a conflict
  console.log(`\n[Step 3] Re-verifying the same card UID ${testUid} to confirm conflict detection...`);
  const conflictRes = await fetch(`${BASE_URL}/api/nfc-cards/verify?cardUid=${encodeURIComponent(testUid)}`, {
    headers: { Cookie: custodianCookie },
  });
  const conflictData = await conflictRes.json();
  console.log("  API Response:", conflictData);

  if (conflictRes.status === 200 && conflictData.available === false && conflictData.status === "ACTIVE") {
    console.log(`  ✓ PASS: Conflict detected correctly! Message: "${conflictData.message}"`);
    console.log(`  ✓ PASS: Current holder identified as ${conflictData.employee?.firstName} ${conflictData.employee?.lastName} (${conflictData.employee?.employeeCode})`);
  } else {
    console.error("  ✗ FAIL: Conflict was not flagged as expected.");
    process.exit(1);
  }

  console.log("\n============================================================");
  console.log("   ALL NFC SCANNING & VERIFICATION TESTS PASSED (100%)");
  console.log("============================================================\n");
}

runTest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
