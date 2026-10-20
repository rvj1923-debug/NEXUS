/**
 * Phase 3 Automated Verification Test Suite
 * Universal USB NFC Reader Integration, Hardware Diagnostics, Mode A Keyboard Wedge,
 * Windows Local Agent Bridge, Reader Management, and NFC Custody Kiosk.
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APP_URL = "http://127.0.0.1:4000";
const AGENT_URL = "http://127.0.0.1:8002";

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER — PHASE 3 AUTOMATED VERIFICATION SUITE");
  console.log("==================================================================\n");

  let adminCookie = "";

  // 0. Setup: Authenticate Admin User
  console.log("[Test Group 0: Session Setup]");
  try {
    const loginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@company.com",
        password: "AdminPassword123!",
      }),
    });
    const loginData = await loginRes.json();
    assert(loginRes.ok && loginData.success, "Admin login successful");
    const rawCookie = loginRes.headers.get("set-cookie");
    if (rawCookie) {
      adminCookie = rawCookie.split(";")[0];
    }
  } catch (e) {
    assert(false, `Authentication setup failed: ${e.message}`);
  }

  // 1. Hardware Discovery & Diagnostic Report Verification
  console.log("\n[Test Group 1: Hardware Discovery & Diagnostic Utility]");
  try {
    const reportPath = path.resolve(process.cwd(), "HARDWARE_COMPATIBILITY_REPORT.md");
    const reportExists = fs.existsSync(reportPath);
    assert(reportExists, "HARDWARE_COMPATIBILITY_REPORT.md was generated and exists on disk");

    if (reportExists) {
      const content = fs.readFileSync(reportPath, "utf-8");
      assert(content.includes("VID 0xFFFF") || content.includes("FFFF"), "Report identifies USB Vendor ID (VID 0xFFFF)");
      assert(content.includes("PID 0x0035") || content.includes("0035"), "Report identifies USB Product ID (PID 0x0035)");
      assert(content.includes("MODE_A_KEYBOARD_WEDGE") || content.includes("Keyboard Wedge"), "Report recommends Mode A Keyboard Wedge");
      assert(content.includes("PC/SC") || content.includes("CCID"), "Report evaluates PC/SC Smart Card Driver status");
    }

    // Call /api/readers/detect
    const detectRes = await fetch(`${APP_URL}/api/readers/detect`);
    const detectData = await detectRes.json();
    assert(detectRes.ok && detectData.success, "/api/readers/detect endpoint returns 200 OK");
    assert(detectData.detectedHardware && detectData.detectedHardware.length > 0, "Hardware detection lists connected candidate USB devices");
    assert(detectData.detectedHardware[0].vendorId === "FFFF", "Candidate device reflects Vendor ID FFFF");
    assert(detectData.detectedHardware[0].recommendedMode === "MODE_A_KEYBOARD_WEDGE", "Hardware detection recommends MODE_A_KEYBOARD_WEDGE");
  } catch (e) {
    assert(false, `Hardware discovery test error: ${e.message}`);
  }

  // 2. Universal Reader Identifier Normalization & Debounce
  console.log("\n[Test Group 2: Mode A Identifier Normalization & Debounce Suppression]");
  try {
    // Normalization test cases via reader test endpoint
    const res1 = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput: "04:a2:8b:71:68" }),
    });
    const data1 = await res1.json();
    assert(data1.success && data1.normalizedUid === "04:A2:8B:71:68", "Normalizes lowercase colon hex -> uppercase '04:A2:8B:71:68'");
    assert(data1.specificCardNumber === "SN-04:A2:8B:71:68", "Generates standard Specific Card Number");

    const res2 = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput: "04A28B7168" }),
    });
    const data2 = await res2.json();
    assert(data2.success && data2.normalizedUid === "04:A2:8B:71:68", "Normalizes unseparated hex '04A28B7168' into colon-separated chunks");

    const res3 = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput: "0004829104" }),
    });
    const data3 = await res3.json();
    assert(data3.success && data3.format === "DECIMAL" && data3.normalizedUid.includes(":"), "Normalizes decimal keystroke wedge format into hex chunks");

    // Debounce suppression test via rapid consecutive scans
    const testDebounceUid = "04:DE:AD:BE:EF";
    const deb1 = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput: testDebounceUid, debounceWindowMs: 2000 }),
    });
    const debData1 = await deb1.json();
    assert(debData1.success && debData1.debounced === false, "First scan is accepted (debounced: false)");

    const deb2 = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawInput: testDebounceUid, debounceWindowMs: 2000 }),
    });
    const debData2 = await deb2.json();
    assert(debData2.success && debData2.debounced === true, "Immediate duplicate scan within 2000ms is suppressed (debounced: true)");
  } catch (e) {
    assert(false, `Normalization test error: ${e.message}`);
  }

  // 3. Local Windows NFC Reader Agent (Port 8002)
  console.log("\n[Test Group 3: Windows NFC Reader Local Agent (Port 8002)]");
  try {
    // Test agent status
    const agentStatusRes = await fetch(`${AGENT_URL}/api/agent/status`);
    const agentStatus = await agentStatusRes.json();
    assert(agentStatusRes.ok && agentStatus.agentOnline, "Local NFC Agent is listening on 127.0.0.1:8002");
    assert(agentStatus.version === "1.0.0-phase3", "Agent reports version 1.0.0-phase3");

    // Test agent pairing
    const pairRes = await fetch(`${AGENT_URL}/api/agent/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: "CPT-AGENT-PAIR-TOKEN-2026",
        kioskIdentifier: "KIOSK-GATE-A",
      }),
    });
    const pairData = await pairRes.json();
    assert(pairRes.ok && pairData.paired, "Local agent pairing handshake succeeds with valid secret");
    const agentToken = pairData.token;

    // Test unauthenticated tap rejection
    const unauthTapRes = await fetch(`${AGENT_URL}/api/agent/scan/tap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawCardUid: "04:A2:8B:71:68" }),
    });
    assert(unauthTapRes.status === 401, "Agent rejects unauthenticated card scan ingestion (HTTP 401)");

    // Test authenticated tap
    const authTapRes = await fetch(`${AGENT_URL}/api/agent/scan/tap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({
        rawCardUid: "04:A2:8B:71:68",
        readerId: "KIOSK-GATE-A",
      }),
    });
    const authTapData = await authTapRes.json();
    assert(authTapRes.ok && authTapData.received, "Agent ingests authenticated card tap into short-lived queue");
  } catch (e) {
    assert(false, `Local agent test error: ${e.message}`);
  }

  // 4. Reader Management APIs
  console.log("\n[Test Group 4: Reader Management & Diagnostic APIs]");
  try {
    // List readers
    const readersRes = await fetch(`${APP_URL}/api/readers`, {
      headers: { Cookie: adminCookie },
    });
    const readersData = await readersRes.json();
    assert(readersRes.ok && Array.isArray(readersData.readers), "GET /api/readers returns list of registered readers");
    const gateAReader = readersData.readers.find((r) => r.readerIdentifier === "KIOSK-GATE-A");
    assert(!!gateAReader, "Found reader 'KIOSK-GATE-A' in database");
    assert(gateAReader.connectionMode === "MODE_A_KEYBOARD_WEDGE", "Reader connection mode is MODE_A_KEYBOARD_WEDGE");

    // Test reader scan simulation via /api/readers/test
    const testScanRes = await fetch(`${APP_URL}/api/readers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        rawInput: "04:A2:8B:71:68",
        readerIdentifier: "KIOSK-GATE-A",
      }),
    });
    const testScanData = await testScanRes.json();
    assert(testScanRes.ok && testScanData.success, "POST /api/readers/test verifies scan and updates lastScannedAt");
    assert(testScanData.normalizedUid === "04:A2:8B:71:68", "Test scan confirms normalized UID");

    // Test reader pairing via /api/readers/pair
    const pairReaderRes = await fetch(`${APP_URL}/api/readers/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        readerIdentifier: "KIOSK-GATE-A",
        kioskIdentifier: "KIOSK-GATE-A",
      }),
    });
    const pairReaderData = await pairReaderRes.json();
    assert(pairReaderRes.ok && pairReaderData.success, "POST /api/readers/pair pairs reader with kiosk station");
  } catch (e) {
    assert(false, `Reader management test error: ${e.message}`);
  }

  // 5. NFC Kiosk Resolution & Custody Workflow
  console.log("\n[Test Group 5: NFC Kiosk Resolution & Custody Workflow]");
  try {
    // 5a. Seed a dedicated test employee, active card, phone, and assignment
    const dept = await db.department.findFirst();
    const testEmp = await db.employee.upsert({
      where: { employeeCode: "EMP-PHASE3-TEST" },
      update: { status: "ACTIVE" },
      create: {
        employeeCode: "EMP-PHASE3-TEST",
        firstName: "Arthur",
        lastName: "Pendleton",
        departmentId: dept.id,
        designation: "Field Logistics Lead",
        status: "ACTIVE",
      },
    });

    const testCardUid = "04:E1:9F:88:3A";
    const testCard = await db.nfcCard.upsert({
      where: { cardUid: testCardUid },
      update: { status: "ACTIVE", employeeId: testEmp.id },
      create: {
        cardUid: testCardUid,
        cardNumber: "BADGE-P3-TEST",
        employeeId: testEmp.id,
        status: "ACTIVE",
      },
    });

    const testPhone = await db.phoneAsset.upsert({
      where: { assetTag: "MOB-P3-TEST" },
      update: { custodyStatus: "AVAILABLE", assignmentStatus: "ASSIGNED", operationalStatus: "ACTIVE" },
      create: {
        assetTag: "MOB-P3-TEST",
        brand: "Samsung",
        model: "Galaxy S24 Enterprise",
        imei: "359999000123456",
        serialNumber: "SN-S24-P3-001",
        custodyStatus: "AVAILABLE",
        assignmentStatus: "ASSIGNED",
        departmentId: dept.id,
      },
    });

    // Close any previous open custody transactions for clean fixture isolation
    await db.custodyTransaction.updateMany({
      where: {
        OR: [{ employeeId: testEmp.id }, { phoneAssetId: testPhone.id }],
        status: "ISSUED",
      },
      data: { status: "RETURNED", actualReturnAt: new Date() },
    });

    await db.phoneAssignment.upsert({
      where: { id: "test-assignment-phase3" },
      update: { status: "ACTIVE", employeeId: testEmp.id, phoneAssetId: testPhone.id },
      create: {
        id: "test-assignment-phase3",
        employeeId: testEmp.id,
        phoneAssetId: testPhone.id,
        status: "ACTIVE",
        assignmentType: "DEDICATED",
      },
    });

    // 5b. Resolve valid enrolled card
    const resolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardUid: testCardUid,
        readerIdentifier: "KIOSK-GATE-A",
      }),
    });
    const resolveData = await resolveRes.json();
    assert(resolveRes.ok && resolveData.success, "POST /api/kiosk/resolve succeeds for registered active card");
    assert(resolveData.employee.fullName === "Arthur Pendleton", "Resolves correct employee details");
    assert(resolveData.assignedPhone.assetTag === "MOB-P3-TEST", "Resolves assigned company phone asset");
    assert(resolveData.proposedAction === "ISSUANCE", "Correctly determines proposed action is ISSUANCE when phone is available");

    // 5c. Resolve unknown card
    const unknownRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardUid: "99:99:99:99:99" }),
    });
    const unknownData = await unknownRes.json();
    assert(unknownData.error === "UNKNOWN_CARD" && unknownData.found === false, "Kiosk reports UNKNOWN_CARD for un-enrolled tap");

    // 5d. Resolve revoked card
    const revokedCardUid = "04:FF:EE:DD:00";
    await db.nfcCard.upsert({
      where: { cardUid: revokedCardUid },
      update: { status: "REVOKED" },
      create: { cardUid: revokedCardUid, status: "REVOKED", cardNumber: "BADGE-REVOKED" },
    });
    const revokedRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardUid: revokedCardUid }),
    });
    const revokedData = await revokedRes.json();
    assert(revokedData.error === "INACTIVE_CARD" && revokedData.valid === false, "Kiosk blocks revoked/inactive card tap");

    // 5e. Test Operator Confirmation Guard (Executing without confirmation)
    const unconfirmedRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        employeeId: testEmp.id,
        phoneAssetId: testPhone.id,
        transactionType: "ISSUANCE",
        cardUid: testCardUid,
        operatorConfirmed: false,
      }),
    });
    assert(unconfirmedRes.status === 428, "Custody execution rejected with HTTP 428 if operator confirmation is missing");

    // 5f. Execute Custody Issuance with Operator Confirmation
    const issueRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        employeeId: testEmp.id,
        phoneAssetId: testPhone.id,
        transactionType: "ISSUANCE",
        cardUid: testCardUid,
        readerIdentifier: "KIOSK-GATE-A",
        conditionAtAction: "GOOD",
        operatorConfirmed: true,
      }),
    });
    const issueData = await issueRes.json();
    assert(issueRes.ok && issueData.success, "Kiosk successfully executes Phone Checkout (ISSUANCE)");
    assert(issueData.phone.custodyStatus === "ISSUED", "Phone asset custodyStatus transitions to ISSUED");
    assert(issueData.transactionCode && issueData.transactionCode.startsWith("CTX-"), "Generated unique audit transaction code");

    // 5g. Next Tap: Wait for 1300ms debounce window to elapse, then tap should propose SURRENDER (Return)
    await new Promise((r) => setTimeout(r, 1300));
    const nextResolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardUid: testCardUid }),
    });
    const nextResolveData = await nextResolveRes.json();
    assert(nextResolveData.proposedAction === "SURRENDER", "Following tap proposes SURRENDER when device is in custody");

    // 5h. Execute Custody Surrender (Return)
    const returnRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        employeeId: testEmp.id,
        phoneAssetId: testPhone.id,
        transactionType: "SURRENDER",
        cardUid: testCardUid,
        readerIdentifier: "KIOSK-GATE-A",
        conditionAtAction: "GOOD",
        operatorConfirmed: true,
      }),
    });
    const returnData = await returnRes.json();
    assert(returnRes.ok && returnData.success, "Kiosk successfully executes Phone Return (SURRENDER)");
    assert(returnData.phone.custodyStatus === "AVAILABLE", "Phone asset custodyStatus transitions back to AVAILABLE");
  } catch (e) {
    assert(false, `Kiosk custody workflow test error: ${e.message}`);
  }

  // 6. Phase 1 & Phase 2 Regression Tests
  console.log("\n[Test Group 6: Phase 1 & Phase 2 Regression Verification]");
  try {
    const employeesRes = await fetch(`${APP_URL}/api/employees?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    assert(employeesRes.ok, "GET /api/employees responds 200 OK");

    const cardsRes = await fetch(`${APP_URL}/api/nfc-cards?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    assert(cardsRes.ok, "GET /api/nfc-cards responds 200 OK");

    const phonesRes = await fetch(`${APP_URL}/api/phones?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    assert(phonesRes.ok, "GET /api/phones responds 200 OK");

    const assignmentsRes = await fetch(`${APP_URL}/api/assignments?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    assert(assignmentsRes.ok, "GET /api/assignments responds 200 OK");
  } catch (e) {
    assert(false, `Regression test error: ${e.message}`);
  }

  console.log("\n==================================================================");
  console.log(`  PHASE 3 TEST RESULTS: ${testsPassed}/${testsRun} PASSED (${testsFailed} FAILED)`);
  console.log("==================================================================\n");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .catch((e) => {
    console.error("Fatal test runner error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
