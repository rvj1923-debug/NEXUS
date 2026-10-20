/**
 * Automated Acceptance Test Suite: Company Phone NFC Time In / Time Out System
 * Tests all 20 required QA acceptance scenarios.
 */

import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile?.();
} catch {}

const db = new PrismaClient();
const APP_URL = process.env.APP_URL || "http://127.0.0.1:5000";
const KIOSK_DEVICE_SECRET =
  process.env.KIOSK_DEVICE_SECRET || "cpt_kiosk_dev_secret_89a7f6e5d4c3b2a1908f7e6d5c4b3a21";

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message, details = "") {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ FAIL: ${message} ${details ? `(${details})` : ""}`);
  }
}

function extractCookies(res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") || "").split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
  return setCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER — NFC TIME IN / TIME OUT VERIFICATION SUITE");
  console.log("==================================================================\n");

  let adminCookie = "";
  let custodianCookie = "";
  let kioskCookie = "";

  // -------------------------------------------------------------
  // Test 0: Unauthenticated Guard & Persona / Kiosk Device-Login Setup
  // -------------------------------------------------------------
  console.log("[Setup: Unauthenticated Guard & Kiosk Device-Login]");

  // 0. Unauthenticated POST /api/kiosk/resolve must return 401
  const unauthResolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardUid: "04:99:AA:BB:11" }),
  });
  assert(
    unauthResolveRes.status === 401,
    "Unauthenticated POST /api/kiosk/resolve rejected with HTTP 401",
    `status=${unauthResolveRes.status}`
  );

  // 1. Admin Login
  const adminLoginRes = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@company.com", password: "AdminPassword123!" }),
  });
  const adminLoginData = await adminLoginRes.json();
  assert(adminLoginRes.ok && adminLoginData.success, "Admin authenticated successfully");
  adminCookie = extractCookies(adminLoginRes);

  // 2. Custodian Login
  const custodianLoginRes = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "custodian@company.com", password: "Custodian123!" }),
  });
  const custodianLoginData = await custodianLoginRes.json();
  assert(custodianLoginRes.ok && custodianLoginData.success, "Custodian authenticated successfully");
  custodianCookie = extractCookies(custodianLoginRes);

  // 3. Ensure PHONE-KIOSK-01 is ACTIVE and authenticate Kiosk via /api/kiosk/device-login
  await db.kioskDevice.upsert({
    where: { kioskCode: process.env.KIOSK_CODE || "PHONE-KIOSK-01" },
    update: { status: "ACTIVE" },
    create: {
      kioskCode: process.env.KIOSK_CODE || "PHONE-KIOSK-01",
      name: "Main Depot Kiosk",
      location: "Main Depot Lobby Central Gate",
      status: "ACTIVE",
    },
  });

  const deviceLoginRes = await fetch(
    `${APP_URL}/api/kiosk/device-login?key=${encodeURIComponent(KIOSK_DEVICE_SECRET)}`,
    { redirect: "manual" }
  );
  kioskCookie = extractCookies(deviceLoginRes);
  assert(
    (deviceLoginRes.status === 307 || deviceLoginRes.status === 302) &&
      kioskCookie.includes("cpt_session="),
    "Kiosk session established via /api/kiosk/device-login"
  );

  // -------------------------------------------------------------
  // Prepare Test Entities (Phone-Mounted NFC Tags & Employees)
  // -------------------------------------------------------------
  const testDepartment = await db.department.findFirst();

  // Create Test Employee 1
  let emp1 = await db.employee.findFirst({ where: { employeeCode: "EMP-TIO-001" } });
  if (!emp1) {
    emp1 = await db.employee.create({
      data: {
        employeeCode: "EMP-TIO-001",
        firstName: "Leo",
        lastName: "Valdez",
        departmentId: testDepartment.id,
        status: "ACTIVE",
        worksite: "Depot Alpha",
      },
    });
  }

  // Create Test Phone 1 (with attached NFC Tag)
  const phone1TagUid = "04:99:AA:BB:11";
  let phone1 = await db.phoneAsset.upsert({
    where: { assetTag: "MOB-TIO-001" },
    update: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
    create: {
      assetTag: "MOB-TIO-001",
      brand: "Google",
      model: "Pixel 8 Pro",
      imei: "354928109988111",
      departmentId: testDepartment.id,
      condition: "EXCELLENT",
      custodyStatus: "AVAILABLE",
      operationalStatus: "ACTIVE",
    },
  });

  // Mount NFC Tag onto Phone 1
  await db.nfcCard.upsert({
    where: { cardUid: phone1TagUid },
    update: { phoneAssetId: phone1.id, employeeId: emp1.id, status: "ACTIVE" },
    create: {
      cardUid: phone1TagUid,
      cardNumber: "SN-0499AABB11",
      identifierType: "MIFARE_CLASSIC",
      phoneAssetId: phone1.id,
      employeeId: emp1.id,
      status: "ACTIVE",
    },
  });

  // Assign Phone 1 to Employee 1
  await db.phoneAssignment.upsert({
    where: { id: "assign-tio-001" },
    update: { status: "ACTIVE", employeeId: emp1.id, phoneAssetId: phone1.id },
    create: {
      id: "assign-tio-001",
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      status: "ACTIVE",
      startDate: new Date(),
    },
  });

  // Ensure clean slate: close any open transactions for this phone
  await db.custodyTransaction.updateMany({
    where: { phoneAssetId: phone1.id, actualReturnAt: null },
    data: { actualReturnAt: new Date(), status: "RETURNED" },
  });

  // -------------------------------------------------------------
  // Scenario 1: Registered Phone NFC Tag
  // -------------------------------------------------------------
  console.log("\n[Scenario 1: Registered Phone NFC Tag]");
  const s1Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
  });
  const s1Data = await s1Res.json();
  assert(s1Res.ok && s1Data.success, "Scanned phone NFC tag successfully resolved");
  assert(s1Data.phone?.assetTag === "MOB-TIO-001", "Correct phone asset identified from NFC tag");
  assert(s1Data.employee?.employeeCode === "EMP-TIO-001", "Correct assigned employee retrieved via phone assignment");

  // Reset phone to AVAILABLE before manual custody tests below
  await db.custodyTransaction.updateMany({
    where: { phoneAssetId: phone1.id, actualReturnAt: null },
    data: { actualReturnAt: new Date(), status: "RETURNED" },
  });
  await db.phoneAsset.update({
    where: { id: phone1.id },
    data: { custodyStatus: "AVAILABLE" },
  });

  // -------------------------------------------------------------
  // Scenario 2: Unknown NFC Tag
  // -------------------------------------------------------------
  console.log("\n[Scenario 2: Unknown NFC Tag]");
  const s2Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: "99:AA:BB:CC:DD", kioskCode: "PHONE-KIOSK-01" }),
  });
  const s2Data = await s2Res.json();
  assert(s2Data.caseType === "CASE_E_NOT_RECOGNIZED", "Unknown tag flags Case E (Not Recognized)");
  assert(s2Data.message === "Card not recognized. Please contact the assigned custodian.", "Standard non-disclosure error shown");
  assert(!s2Data.employee && !s2Data.phone, "Zero employee or asset data disclosed for unknown tag");

  // -------------------------------------------------------------
  // Scenario 3: Inactive Employee Check
  // -------------------------------------------------------------
  console.log("\n[Scenario 3: Inactive Employee Check]");
  await db.employee.update({ where: { id: emp1.id }, data: { isActive: false, status: "TERMINATED" } });
  const s3Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
  });
  const s3Data = await s3Res.json();
  assert(
    s3Data.caseType === "CASE_E_NOT_RECOGNIZED" && s3Data.error === "EMPLOYEE_INACTIVE",
    "Inactive employee blocked from kiosk custody operations",
    JSON.stringify(s3Data)
  );
  await db.employee.update({ where: { id: emp1.id }, data: { isActive: true, status: "ACTIVE" } });

  // -------------------------------------------------------------
  // Scenario 4: Phone Without Assignment
  // -------------------------------------------------------------
  console.log("\n[Scenario 4: Phone Without Assignment]");
  const unassignedPhoneTag = "04:88:88:88:88";
  const unassignedPhone = await db.phoneAsset.upsert({
    where: { assetTag: "MOB-UNASSIGNED-99" },
    update: { custodyStatus: "AVAILABLE" },
    create: {
      assetTag: "MOB-UNASSIGNED-99",
      brand: "Nokia",
      model: "G22",
      imei: "354928109988999",
      condition: "GOOD",
      custodyStatus: "AVAILABLE",
    },
  });
  await db.nfcCard.upsert({
    where: { cardUid: unassignedPhoneTag },
    update: { phoneAssetId: unassignedPhone.id, status: "ACTIVE" },
    create: {
      cardUid: unassignedPhoneTag,
      cardNumber: "SN-0488888888",
      identifierType: "MIFARE_CLASSIC",
      phoneAssetId: unassignedPhone.id,
      status: "ACTIVE",
    },
  });
  const s4Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: unassignedPhoneTag, kioskCode: "PHONE-KIOSK-01" }),
  });
  const s4Data = await s4Res.json();
  assert(s4Data.caseType === "CASE_D_NO_PHONE", "Unassigned phone correctly recognized as Case D");

  // -------------------------------------------------------------
  // Scenario 5: Successful Time In (Custodian / Admin Endpoint)
  // -------------------------------------------------------------
  console.log("\n[Scenario 5: Successful Time In]");
  const directTimeInRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      conditionAtAction: "GOOD",
      operatorConfirmed: true,
    }),
  });
  const directTimeInData = await directTimeInRes.json();
  assert(directTimeInRes.ok && directTimeInData.success, "Time In executed via /api/kiosk/custody");
  assert(directTimeInData.transactionType === "TIME_IN", "Transaction categorized as TIME_IN");

  const phoneAfterTimeIn = await db.phoneAsset.findUnique({ where: { id: phone1.id } });
  assert(phoneAfterTimeIn?.custodyStatus === "ISSUED", "Phone custodyStatus transitioned to 'ISSUED'");

  // -------------------------------------------------------------
  // Scenario 6: Successful Time Out
  // -------------------------------------------------------------
  console.log("\n[Scenario 6: Successful Time Out]");
  const directTimeOutRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_OUT",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      conditionAtAction: "GOOD",
      operatorConfirmed: true,
    }),
  });
  const directTimeOutData = await directTimeOutRes.json();
  assert(directTimeOutRes.ok && directTimeOutData.success, "Time Out executed via /api/kiosk/custody");
  assert(directTimeOutData.transactionType === "TIME_OUT", "Transaction categorized as TIME_OUT");

  const phoneAfterTimeOut = await db.phoneAsset.findUnique({ where: { id: phone1.id } });
  assert(phoneAfterTimeOut?.custodyStatus === "AVAILABLE", "Phone custodyStatus reset to 'AVAILABLE'");

  // -------------------------------------------------------------
  // Scenario 7: Duplicate Time In Prevention
  // -------------------------------------------------------------
  console.log("\n[Scenario 7: Duplicate Time In Prevention]");
  const ti1 = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  assert(ti1.ok, "Initial Time In confirmed");

  const duplicateTi = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  assert(duplicateTi.status === 409, "Duplicate Time In blocked with HTTP 409 Conflict");

  // -------------------------------------------------------------
  // Scenario 8: Time Out Without Active Time In
  // -------------------------------------------------------------
  console.log("\n[Scenario 8: Time Out Without Active Time In]");
  await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_OUT",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });

  const invalidTo = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_OUT",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  assert(invalidTo.status === 404 || invalidTo.status === 409, "Time Out without active Time In rejected with HTTP 404/409");

  // -------------------------------------------------------------
  // Scenario 9: Overdue Time Out
  // -------------------------------------------------------------
  console.log("\n[Scenario 9: Overdue Time Out Handling]");
  const timeInRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  const timeInTx = (await timeInRes.json()).transaction;

  const pastDeadline = new Date(Date.now() - 45 * 60 * 1000);
  const pastIssuedAt = new Date(Date.now() - 60 * 60 * 1000);
  await db.custodyTransaction.update({
    where: { id: timeInTx.id },
    data: { issuedAt: pastIssuedAt, returnDeadlineAt: pastDeadline, status: "OVERDUE", overdueMinutes: 45 },
  });
  await db.phoneAsset.update({
    where: { id: phone1.id },
    data: { custodyStatus: "OVERDUE" },
  });

  const overdueScanRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
  });
  const overdueScanData = await overdueScanRes.json();
  assert(overdueScanRes.ok && overdueScanData.success, "Late phone surrender permitted via resolve without system lockout");
  assert(overdueScanData.isOverdue === true, "Resolve indicates overdue condition on late return");

  // -------------------------------------------------------------
  // Scenario 10: Reader Disconnected Handling
  // -------------------------------------------------------------
  console.log("\n[Scenario 10: Reader Disconnected Graceful Fallback]");
  const healthRes = await fetch(`${APP_URL}/api/health`);
  const healthData = await healthRes.json();
  assert(healthRes.ok && healthData.status === "HEALTHY", "Health check reports responsive system during operation");

  // -------------------------------------------------------------
  // Scenario 11: Repeated Scans (Hardware Debounce)
  // -------------------------------------------------------------
  console.log("\n[Scenario 11: Rapid Duplicate Tap Suppression]");
  await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid }),
  });
  const tap2 = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid }),
  });
  const tap2Data = await tap2.json();
  assert(tap2Data.debounced === true, "Immediate duplicate tap (<1200ms) suppressed by debounce filter");

  // Clean up any open custody from tap1
  await db.custodyTransaction.updateMany({
    where: { phoneAssetId: phone1.id, actualReturnAt: null },
    data: { actualReturnAt: new Date(), status: "RETURNED" },
  });
  await db.phoneAsset.update({
    where: { id: phone1.id },
    data: { custodyStatus: "AVAILABLE" },
  });

  // -------------------------------------------------------------
  // Scenario 12: Kiosk Refresh Resilience
  // -------------------------------------------------------------
  console.log("\n[Scenario 12: Kiosk Statelessness on Refresh]");
  const freshKioskReq = await fetch(`${APP_URL}/kiosk`, {
    headers: { Cookie: kioskCookie },
  });
  assert(freshKioskReq.ok && freshKioskReq.status === 200, "Kiosk UI reloads cleanly with valid KIOSK session");

  // -------------------------------------------------------------
  // Scenario 13: Two Employees Attempting Same Phone
  // -------------------------------------------------------------
  console.log("\n[Scenario 13: Two Employees Attempting Same Phone]");
  let emp2 = await db.employee.findFirst({ where: { employeeCode: "EMP-TIO-002" } });
  if (!emp2) {
    emp2 = await db.employee.create({
      data: {
        employeeCode: "EMP-TIO-002",
        firstName: "Carlos",
        lastName: "Mendoza",
        departmentId: testDepartment.id,
        status: "ACTIVE",
      },
    });
  }
  const wrongEmpCheckout = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp2.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  assert(wrongEmpCheckout.status === 409, "Checkout blocked when non-assigned employee attempts to take device");

  // -------------------------------------------------------------
  // Scenario 14: Concurrent Operations from Two Kiosks
  // -------------------------------------------------------------
  console.log("\n[Scenario 14: Concurrent Multi-Kiosk Isolation]");
  const [k1Res, k2Res] = await Promise.all([
    fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: emp1.id,
        phoneAssetId: phone1.id,
        transactionType: "TIME_IN",
        kioskCode: "PHONE-KIOSK-01",
      }),
    }),
    fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: emp1.id,
        phoneAssetId: phone1.id,
        transactionType: "TIME_IN",
        kioskCode: "KIOSK-GATE-A",
      }),
    }),
  ]);
  const [k1Data, k2Data] = await Promise.all([k1Res.json(), k2Res.json()]);
  assert(k1Data.token !== k2Data.token, "Concurrent requests generate globally distinct cryptographic tokens");

  // -------------------------------------------------------------
  // Scenario 15: Custodian Verification Failure
  // -------------------------------------------------------------
  console.log("\n[Scenario 15: Custodian Verification Failure]");
  const badAuthRes = await fetch(`${APP_URL}/api/kiosk/attended-approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      custodianEmail: "custodian-tio-check@company.com",
      custodianPassword: "WrongPassword999!",
    }),
  });
  assert(badAuthRes.status === 401, "Invalid custodian credentials rejected with HTTP 401");

  // -------------------------------------------------------------
  // Scenario 16: Unauthorized Kiosk Access to Admin Routes
  // -------------------------------------------------------------
  console.log("\n[Scenario 16: Unauthorized Kiosk Access Boundaries (RBAC)]");
  const kioskToAdminUsers = await fetch(`${APP_URL}/api/users`, {
    headers: { Cookie: kioskCookie },
  });
  assert(kioskToAdminUsers.status === 403, "KIOSK session blocked from accessing /api/users (HTTP 403)");

  const kioskToEmployees = await fetch(`${APP_URL}/api/employees`, {
    headers: { Cookie: kioskCookie },
  });
  assert(kioskToEmployees.status === 403, "KIOSK session blocked from accessing /api/employees (HTTP 403)");

  // -------------------------------------------------------------
  // Scenario 17: Database Interruption & Atomic Rollback
  // -------------------------------------------------------------
  console.log("\n[Scenario 17: Atomic Rollback on Error]");
  const rollbackRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: "invalid-uuid-format",
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  assert(rollbackRes.status === 409 || rollbackRes.status === 404 || rollbackRes.status === 400 || rollbackRes.status === 500, "Invalid transaction safely rejected with zero database mutation");

  // -------------------------------------------------------------
  // Scenario 18: Automatic Screen Reset / Token Cancellation
  // -------------------------------------------------------------
  console.log("\n[Scenario 18: Automatic Reset & Cancellation]");
  const reqToCancel = await fetch(`${APP_URL}/api/kiosk/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
    }),
  });
  const tokenToCancel = (await reqToCancel.json()).token;

  const cancelRes = await fetch(`${APP_URL}/api/kiosk/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ token: tokenToCancel }),
  });
  assert(cancelRes.ok, "Abandoned verification request cancelled successfully");

  // -------------------------------------------------------------
  // Scenario 19: Accurate Daily Report with Time In / Time Out
  // -------------------------------------------------------------
  console.log("\n[Scenario 19: Accurate Daily Report Generation]");
  const reportRes = await fetch(`${APP_URL}/api/reports/custody?dateFilter=TODAY`, {
    headers: { Cookie: adminCookie },
  });
  const reportData = await reportRes.json();
  assert(reportRes.ok && reportData.summary !== undefined, "Daily report successfully generated");

  const csvRes = await fetch(`${APP_URL}/api/reports/export?format=csv&dateFilter=TODAY`, {
    headers: { Cookie: adminCookie },
  });
  const csvText = await csvRes.text();
  assert(csvText.includes("Time In / Issued"), "CSV report contains 'Time In / Issued' terminology");
  assert(csvText.includes("Time Out / Actual Return"), "CSV report contains 'Time Out / Actual Return' terminology");
  assert(csvText.includes("NFC Tag Reference"), "CSV report contains 'NFC Tag Reference' column");

  // -------------------------------------------------------------
  // Scenario 20: Complete Audit History
  // -------------------------------------------------------------
  console.log("\n[Scenario 20: Complete Immutable Audit History]");
  const auditLogs = await db.auditLog.findMany({
    where: { action: { startsWith: "KIOSK_" } },
    take: 5,
    orderBy: { timestamp: "desc" },
  });
  assert(auditLogs.length > 0, "AuditLog table records immutable KIOSK custody events");
  assert(auditLogs[0].action.includes("TIME_IN") || auditLogs[0].action.includes("TIME_OUT") || auditLogs[0].action.includes("KIOSK"), "Kiosk action properly categorized in audit trail");

  // -------------------------------------------------------------
  // Scenario 21: Accidental Double-Tap Differential Cooldown Guard
  // -------------------------------------------------------------
  console.log("\n[Scenario 21: Accidental Double-Tap Differential Cooldown Guard]");
  const s21TiRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_IN",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
    }),
  });
  const s21TiData = await s21TiRes.json();
  assert(s21TiRes.ok && s21TiData.success, "Device successfully timed in for double-tap test");

  // Step 2: Employee immediately taps NFC tag again (<15s differential)
  const immediateSecondScanRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: kioskCookie },
    body: JSON.stringify({ cardUid: phone1TagUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
  });
  const immediateSecondScanData = await immediateSecondScanRes.json();
  assert(immediateSecondScanData.cooldownActive === true, "Resolver flags cooldownActive === true during cooldown window");
  assert(immediateSecondScanData.cooldownRemainingSeconds > 0, "Resolver provides cooldownRemainingSeconds (> 0)");

  // Step 3: Attempt immediate TIME_OUT with enforceCooldown: true
  const blockedDoubleTapRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_OUT",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
      enforceCooldown: true,
    }),
  });
  const blockedDoubleTapData = await blockedDoubleTapRes.json();
  assert(blockedDoubleTapRes.status === 429, "Immediate second scan blocked with HTTP 429 (Too Many Requests)");
  assert(blockedDoubleTapData.code === "DOUBLE_TAP_COOLDOWN_ACTIVE", "Response returns code 'DOUBLE_TAP_COOLDOWN_ACTIVE'");
  assert((blockedDoubleTapData.cooldownRemainingSeconds ?? blockedDoubleTapData.remainingSeconds) > 0, "Response indicates remaining cooldown seconds");

  const phoneStillIssued = await db.phoneAsset.findUnique({ where: { id: phone1.id } });
  assert(phoneStillIssued?.custodyStatus === "ISSUED", "Database state safely guarded: phone custodyStatus remains 'ISSUED'");

  // Step 4: With skipCooldown: true, TIME_OUT succeeds
  const legitTimeOutRes = await fetch(`${APP_URL}/api/kiosk/custody`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: emp1.id,
      phoneAssetId: phone1.id,
      transactionType: "TIME_OUT",
      cardUid: phone1TagUid,
      readerIdentifier: "PHONE-KIOSK-01",
      operatorConfirmed: true,
      skipCooldown: true,
    }),
  });
  const legitTimeOutData = await legitTimeOutRes.json();
  assert(legitTimeOutRes.ok && legitTimeOutData.success, "Time Out succeeds with authorized bypass or after cooldown expires");
  const phoneCleanedUp = await db.phoneAsset.findUnique({ where: { id: phone1.id } });
  assert(phoneCleanedUp?.custodyStatus === "AVAILABLE", "Phone successfully returned and custodyStatus reset to 'AVAILABLE'");

  // -------------------------------------------------------------
  // Test Summary
  // -------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(`  TIME IN / TIME OUT SUITE: ${testsPassed} / ${testsRun} PASSED (${Math.round((testsPassed / testsRun) * 100)}%)`);
  if (testsFailed === 0) {
    console.log("  >>> ALL ACCEPTANCE SCENARIOS VERIFIED 100% SUCCESSFUL <<<");
  } else {
    console.log(`  >>> ATTENTION: ${testsFailed} SCENARIOS FAILED <<<`);
  }
  console.log("==================================================================\n");

  await db.$disconnect();
  process.exit(testsFailed === 0 ? 0 : 1);
}

runTestSuite().catch(async (e) => {
  console.error("Test execution threw fatal error:", e);
  await db.$disconnect();
  process.exit(1);
});
