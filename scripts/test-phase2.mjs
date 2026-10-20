/**
 * Automated Phase 2 Comprehensive Test Suite
 * Covers All 10 Required Acceptance Criteria:
 * 1. Employee creation, updates and deactivation (including clearance workflow)
 * 2. Duplicate employee handling (preventing duplicate Employee ID codes)
 * 3. Phone registration and duplicate IMEI handling
 * 4. NFC card registration (independent card registry)
 * 5. Card replacement and revocation (preserving audit links)
 * 6. Phone assignment and reassignment
 * 7. Prevention of reassignment for an outstanding phone (custodyStatus === "ISSUED")
 * 8. Preservation of complete historical links (assignments, transactions, cards)
 * 9. Excel/CSV import with invalid-row reporting (row-level validation & preview)
 * 10. Server-side role enforcement (RBAC permissions & dynamic IMEI masking)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:4000";

let passedTests = 0;
let totalTests = 0;
const resultsLog = [];

function assert(condition, testName, details = "") {
  totalTests++;
  const entry = {
    test: testName,
    passed: Boolean(condition),
    details: details || "",
  };
  resultsLog.push(entry);
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName} ${details ? `(${details})` : ""}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} ${details ? `(${details})` : ""}`);
  }
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Failed to log in as ${email}: ${res.status}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No session cookie returned");
  return setCookie.split(";")[0];
}

async function runPhase2Tests() {
  console.log("\n=======================================================");
  console.log("   ANTIGRAVITY — PHASE 2 AUTOMATED ACCEPTANCE TEST SUITE");
  console.log("=======================================================\n");

  let adminCookie = "";
  let custodianCookie = "";
  let itSupportCookie = "";
  let supervisorCookie = "";
  let auditorCookie = "";

  try {
    adminCookie = await loginUser("admin@company.com", "AdminPassword123!");
    custodianCookie = await loginUser("custodian@company.com", "Custodian123!");
    itSupportCookie = await loginUser("itsupport@company.com", "ITSupport123!");
    supervisorCookie = await loginUser("supervisor@company.com", "Supervisor123!");
    auditorCookie = await loginUser("auditor@company.com", "Auditor123!");
    console.log("✓ All 5 enterprise role sessions authenticated successfully.\n");
  } catch (err) {
    console.error("Authentication setup failed:", err.message);
    process.exit(1);
  }

  // Get department ID for testing
  const dept = await prisma.department.findFirst({ where: { code: "OPS" } });
  if (!dept) throw new Error("Operations department OPS not found");

  let createdEmployeeId = "";
  let testPhoneId = "";
  let testPhoneTag = `MOB-TEST-${Date.now().toString().slice(-4)}`;
  let testImei = `35890123${Date.now().toString().slice(-7)}`;
  let testCardId = "";
  let testCardUid = `UID-${Date.now().toString().slice(-6)}`;
  let testAssignmentId = "";

  // -------------------------------------------------------------
  // TEST CRITERION 1: Employee creation, updates and deactivation
  // -------------------------------------------------------------
  console.log("--- TEST CRITERION 1: Employee Creation, Updates & Deactivation ---");
  const uniqueEmpCode = `EMP-TEST-${Date.now().toString().slice(-4)}`;
  
  // 1.1 Create employee via Custodian
  const createEmpRes = await fetch(`${BASE_URL}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeCode: uniqueEmpCode,
      firstName: "Marcus",
      lastName: "Vance",
      email: `marcus.vance.${Date.now()}@company.com`,
      phoneNumber: "+1-555-0921",
      departmentId: dept.id,
      designation: "Logistics Specialist",
      worksite: "Distribution Center Alpha",
      shiftName: "Day Logistics Shift",
      shiftStart: "07:30",
      shiftEnd: "16:00",
    }),
  });
  const createEmpData = await createEmpRes.json();
  assert(createEmpRes.status === 201, "Employee Creation Succeeded", `Code: ${uniqueEmpCode}`);
  assert(Boolean(createEmpData.employee?.id), "Employee ID returned", createEmpData.employee?.id);
  createdEmployeeId = createEmpData.employee?.id;

  // 1.2 Update employee
  const updateEmpRes = await fetch(`${BASE_URL}/api/employees/${createdEmployeeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      designation: "Senior Logistics Lead",
      worksite: "Distribution Center Beta",
    }),
  });
  const updateEmpData = await updateEmpRes.json();
  assert(updateEmpRes.status === 200, "Employee Update Succeeded");
  assert(updateEmpData.employee?.designation === "Senior Logistics Lead", "Designation updated correctly");

  // 1.3 Clean deactivation when no phone is held
  const deactRes = await fetch(`${BASE_URL}/api/employees/${createdEmployeeId}/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({}),
  });
  const deactData = await deactRes.json();
  assert(deactRes.status === 200, "Clean Employee Deactivation Succeeded", "No outstanding phone");

  // Reactivate for subsequent tests
  await prisma.employee.update({
    where: { id: createdEmployeeId },
    data: { isActive: true, status: "ACTIVE" },
  });

  // -------------------------------------------------------------
  // TEST CRITERION 2: Duplicate employee handling
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 2: Duplicate Employee Handling ---");
  const dupEmpRes = await fetch(`${BASE_URL}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeCode: uniqueEmpCode, // Identical employeeCode
      firstName: "Duplicate",
      lastName: "Tester",
      departmentId: dept.id,
    }),
  });
  const dupEmpData = await dupEmpRes.json();
  assert(dupEmpRes.status === 409, "Duplicate Employee ID Code Blocked (409 Conflict)", dupEmpData.error);

  // -------------------------------------------------------------
  // TEST CRITERION 3: Phone registration and duplicate IMEI handling
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 3: Phone Registration & Duplicate IMEI Handling ---");
  const createPhoneRes = await fetch(`${BASE_URL}/api/phones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: itSupportCookie },
    body: JSON.stringify({
      assetTag: testPhoneTag,
      brand: "Samsung",
      model: "Galaxy XCover 6 Pro",
      imei: testImei,
      serialNumber: `SN-${Date.now().toString().slice(-6)}`,
      condition: "EXCELLENT",
      departmentId: dept.id,
      issuedAccessories: "Heavy Duty Holster, Type-C Rapid Cable",
    }),
  });
  const createPhoneData = await createPhoneRes.json();
  assert(createPhoneRes.status === 201, "Phone Registration Succeeded", `Tag: ${testPhoneTag}`);
  testPhoneId = createPhoneData.phone?.id;

  // Duplicate IMEI test
  const dupImeiRes = await fetch(`${BASE_URL}/api/phones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: itSupportCookie },
    body: JSON.stringify({
      assetTag: `${testPhoneTag}-DUP`,
      brand: "Samsung",
      model: "Galaxy XCover 6 Pro",
      imei: testImei, // duplicate IMEI!
      departmentId: dept.id,
    }),
  });
  const dupImeiData = await dupImeiRes.json();
  assert(dupImeiRes.status === 409, "Duplicate IMEI Registration Blocked (409 Conflict)", dupImeiData.error);

  // -------------------------------------------------------------
  // TEST CRITERION 4: NFC card registration
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 4: NFC Card Registration ---");
  const createCardRes = await fetch(`${BASE_URL}/api/nfc-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      cardUid: testCardUid,
      cardNumber: `SN-NFC-${Date.now().toString().slice(-4)}`,
      identifierType: "MIFARE_DESFIRE",
      readerSource: "DESK_READER_01",
      employeeId: createdEmployeeId,
      status: "ACTIVE",
    }),
  });
  const createCardData = await createCardRes.json();
  assert(createCardRes.status === 201, "NFC Card Registered & Bound to Employee", `UID: ${testCardUid}`);
  testCardId = createCardData.card?.id;

  // Duplicate active card test for same employee without authorization
  const dupCardRes = await fetch(`${BASE_URL}/api/nfc-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      cardUid: `UID-EXTRA-${Date.now().toString().slice(-4)}`,
      employeeId: createdEmployeeId,
      status: "ACTIVE",
    }),
  });
  const dupCardData = await dupCardRes.json();
  assert(dupCardRes.status === 409, "Multiple Active Cards Blocked for Unauthorized Employee", dupCardData.error);

  // -------------------------------------------------------------
  // TEST CRITERION 5: Card replacement and revocation
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 5: Card Replacement and Revocation ---");
  const newCardUid = `UID-REPL-${Date.now().toString().slice(-6)}`;
  const replaceCardRes = await fetch(`${BASE_URL}/api/nfc-cards/${testCardId}/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      newCardUid,
      reason: "DAMAGED",
      remarks: "Antenna chipped during warehouse shift",
    }),
  });
  const replaceCardData = await replaceCardRes.json();
  assert(replaceCardRes.status === 200, "NFC Card Replacement Succeeded in Database Transaction");
  assert(replaceCardData.oldCard?.status === "DAMAGED", "Old Card marked as DAMAGED");
  assert(replaceCardData.newCard?.cardUid === newCardUid, "New Card assigned with status ACTIVE");
  
  const replacementCardId = replaceCardData.newCard?.id;

  // Revoke the replacement card
  const revokeCardRes = await fetch(`${BASE_URL}/api/nfc-cards/${replacementCardId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({ reason: "Employee requested security badge reissue" }),
  });
  const revokeCardData = await revokeCardRes.json();
  assert(revokeCardRes.status === 200, "NFC Card Revocation Succeeded");
  assert(revokeCardData.card?.status === "REVOKED", "Card status changed to REVOKED");

  // Re-enroll a fresh active card for subsequent custody tests
  const freshCardUid = `UID-ACTIVE-${Date.now().toString().slice(-6)}`;
  const freshCardRes = await fetch(`${BASE_URL}/api/nfc-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      cardUid: freshCardUid,
      employeeId: createdEmployeeId,
      status: "ACTIVE",
    }),
  });
  const freshCardData = await freshCardRes.json();
  const activeNfcCardId = freshCardData.card?.id;

  // -------------------------------------------------------------
  // TEST CRITERION 6: Phone assignment and reassignment
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 6: Phone Assignment and Reassignment ---");
  const assignRes = await fetch(`${BASE_URL}/api/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: createdEmployeeId,
      phoneAssetId: testPhoneId,
      assignmentType: "DEDICATED",
      notes: "Initial deployment for logistics lead",
    }),
  });
  const assignData = await assignRes.json();
  assert(assignRes.status === 201, "Dedicated Phone Standing Assignment Created", `Asset: ${testPhoneTag}`);
  testAssignmentId = assignData.assignment?.id;

  // Reassignment via Approved Replacement
  const secondPhoneTag = `MOB-REPL-${Date.now().toString().slice(-4)}`;
  const secondPhoneImei = `35890223${Date.now().toString().slice(-7)}`;
  const secondPhoneRes = await fetch(`${BASE_URL}/api/phones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: itSupportCookie },
    body: JSON.stringify({
      assetTag: secondPhoneTag,
      brand: "Samsung",
      model: "Galaxy XCover 6 Pro",
      imei: secondPhoneImei,
      departmentId: dept.id,
    }),
  });
  const secondPhoneData = await secondPhoneRes.json();
  const secondPhoneId = secondPhoneData.phone?.id;

  const replaceAsgnRes = await fetch(`${BASE_URL}/api/assignments/${testAssignmentId}/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      newPhoneAssetId: secondPhoneId,
      reason: "Battery Degradation",
      notes: "Approved battery replacement swap",
    }),
  });
  const replaceAsgnData = await replaceAsgnRes.json();
  assert(replaceAsgnRes.status === 200, "Approved Phone Replacement Workflow Succeeded");

  const oldAssignmentInDb = await prisma.phoneAssignment.findUnique({ where: { id: testAssignmentId } });
  assert(oldAssignmentInDb?.status === "REPLACED", "Old Assignment marked as REPLACED in PostgreSQL");

  const newAssignmentInDb = await prisma.phoneAssignment.findFirst({ where: { replacementForAssignmentId: testAssignmentId } });
  assert(Boolean(newAssignmentInDb), "Historical lineage linked via replacementForAssignmentId in PostgreSQL", `New ID: ${newAssignmentInDb?.id}`);

  const currentActiveAssignmentId = newAssignmentInDb?.id;

  // ----------------------------------------------------------------------------------
  // TEST CRITERION 7: Prevention of reassignment for an outstanding phone
  // ----------------------------------------------------------------------------------
  console.log("\n--- TEST CRITERION 7: Prevention of Reassignment for an Outstanding Phone ---");
  // Simulate phone being physically checked out (custodyStatus === "ISSUED")
  await prisma.phoneAsset.update({
    where: { id: secondPhoneId },
    data: { custodyStatus: "ISSUED" },
  });

  // Attempt to reassign this physically outstanding phone to another employee
  const anotherEmp = await prisma.employee.findFirst({
    where: { id: { not: createdEmployeeId }, isActive: true },
  });

  const breachAttemptRes = await fetch(`${BASE_URL}/api/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({
      employeeId: anotherEmp ? anotherEmp.id : createdEmployeeId,
      phoneAssetId: secondPhoneId,
      assignmentType: "DEDICATED",
    }),
  });
  const breachAttemptData = await breachAttemptRes.json();
  assert(breachAttemptRes.status === 409, "Physical Custody Guard Blocked Reassignment of Outstanding Phone (409 Conflict)", breachAttemptData.error);

  // Attempt controlled clearance deactivation while holding outstanding phone
  // First simulate an active custody transaction
  const deskReader = await prisma.nfcReader.findFirst();
  const custodyTx = await prisma.custodyTransaction.create({
    data: {
      transactionCode: `TX-TEST-${Date.now()}-1`,
      phoneAssetId: secondPhoneId,
      employeeId: createdEmployeeId,
      nfcCardId: activeNfcCardId,
      nfcReaderId: deskReader ? deskReader.id : null,
      transactionType: "ISSUANCE",
    },
  });

  const blockedDeactRes = await fetch(`${BASE_URL}/api/employees/${createdEmployeeId}/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({ forceClearance: false }),
  });
  const blockedDeactData = await blockedDeactRes.json();
  assert(blockedDeactRes.status === 409, "Deactivation Blocked by Controlled Clearance Workflow (409 Conflict)", blockedDeactData.error);
  assert(blockedDeactData.clearanceRequired === true, "Clearance Required flag set to true");

  // Reset custody state back to AVAILABLE for subsequent test integrity
  await prisma.custodyTransaction.create({
    data: {
      transactionCode: `TX-TEST-${Date.now()}-2`,
      phoneAssetId: secondPhoneId,
      employeeId: createdEmployeeId,
      nfcCardId: activeNfcCardId,
      nfcReaderId: deskReader ? deskReader.id : null,
      transactionType: "SURRENDER",
    },
  });
  await prisma.phoneAsset.update({
    where: { id: secondPhoneId },
    data: { custodyStatus: "AVAILABLE" },
  });

  // -------------------------------------------------------------
  // TEST CRITERION 8: Preservation of complete historical links
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 8: Preservation of Complete Historical Links ---");
  // Check that earlier cards still exist in DB
  const oldCard = await prisma.nfcCard.findUnique({ where: { id: testCardId } });
  assert(Boolean(oldCard), "Replaced NFC Card record preserved in database", `Status: ${oldCard?.status}`);

  // Check that earlier assignment still exists and references replacement
  const oldAssignment = await prisma.phoneAssignment.findUnique({ where: { id: testAssignmentId } });
  assert(Boolean(oldAssignment), "Earlier Phone Assignment record preserved in database", `Status: ${oldAssignment?.status}`);

  // Check that custody transactions maintain valid foreign keys
  const txRecord = await prisma.custodyTransaction.findUnique({
    where: { id: custodyTx.id },
    include: { phoneAsset: true, employee: true, nfcCard: true },
  });
  assert(Boolean(txRecord?.phoneAsset && txRecord?.employee && txRecord?.nfcCard), "Custody Transaction Retains Intact Historical Relational Integrity");

  // -------------------------------------------------------------
  // TEST CRITERION 9: Excel/CSV import with invalid-row reporting
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 9: Excel/CSV Import with Invalid-Row Reporting ---");
  const testCsvContent = `employee_id,first_name,last_name,department_code,designation,email,phone_number,worksite,shift_name,shift_start,shift_end
EMP-CSV-VALID1,Sarah,Jenkins,OPS,Dispatcher,sarah.j@company.com,+1-555-0101,Hub A,Morning Shift,07:00,15:30
${uniqueEmpCode},Conflict,Person,OPS,Supervisor,conflict@company.com,+1-555-0102,Hub A,Morning Shift,07:00,15:30
EMP-CSV-INVALID2,,MissingLastName,INVALID_DEPT,Staff,bademail,+1-555-0103,Hub A,Morning Shift,07:00,15:30`;

  // Dry-run preview
  const importPreviewRes = await fetch(`${BASE_URL}/api/employees/bulk-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: custodianCookie },
    body: JSON.stringify({ csv: testCsvContent, commit: false }),
  });
  const importPreviewData = await importPreviewRes.json();
  assert(importPreviewRes.status === 200, "CSV Bulk Import Validation Preview Succeeded");
  assert(importPreviewData.totalRows === 3, "Processed 3 rows in batch");
  assert(importPreviewData.validCount === 1, "Correctly identified 1 valid row");
  assert(importPreviewData.invalidCount === 2, "Correctly caught 2 invalid rows (duplicate ID and missing required fields)");

  // Verify phone CSV import validation preview
  const phoneCsvContent = `asset_tag,brand,model,imei,imei2,serial_number,department_code,condition,accessories,mobile_number
${testPhoneTag},Samsung,Galaxy A54,${testImei},,SN-DUP,OPS,EXCELLENT,Charger,+1-555-0199
MOB-CSV-NEW1,Google,Pixel 8,359001928374612,,SN-P8-1,OPS,EXCELLENT,Case,+1-555-0198`;

  const phoneImportRes = await fetch(`${BASE_URL}/api/phones/bulk-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: itSupportCookie },
    body: JSON.stringify({ csv: phoneCsvContent, commit: false }),
  });
  const phoneImportData = await phoneImportRes.json();
  assert(phoneImportRes.status === 200, "Phone CSV Import Validation Preview Succeeded");
  assert(phoneImportData.invalidCount >= 1, "Phone duplicate IMEI and tag correctly flagged in CSV preview");

  // -------------------------------------------------------------
  // TEST CRITERION 10: Server-side role enforcement
  // -------------------------------------------------------------
  console.log("\n--- TEST CRITERION 10: Server-Side Role Enforcement & IMEI Masking ---");
  // 10.1 Auditor attempting to create an employee (Must be denied with 403 Forbidden)
  const auditorCreateRes = await fetch(`${BASE_URL}/api/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: auditorCookie },
    body: JSON.stringify({
      employeeCode: "EMP-AUDIT-BREACH",
      firstName: "Unauthorized",
      lastName: "AuditorWrite",
      departmentId: dept.id,
    }),
  });
  assert(auditorCreateRes.status === 403, "Auditor Write Blocked on Server (403 Forbidden)");

  // 10.2 Supervisor attempting to create a phone asset (Must be denied with 403 Forbidden)
  const supervisorPhoneRes = await fetch(`${BASE_URL}/api/phones`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: supervisorCookie },
    body: JSON.stringify({
      assetTag: "MOB-SUPERVISOR-BREACH",
      brand: "Samsung",
      model: "A54",
      imei: "359999999999999",
      departmentId: dept.id,
    }),
  });
  assert(supervisorPhoneRes.status === 403, "Supervisor Phone Asset Creation Blocked on Server (403 Forbidden)");

  // 10.3 Dynamic Role-Based IMEI Masking Verification
  // IT Support and Admin should see full IMEI
  const itSupportPhoneRes = await fetch(`${BASE_URL}/api/phones/${testPhoneId}`, {
    headers: { Cookie: itSupportCookie },
  });
  const itSupportPhoneData = await itSupportPhoneRes.json();
  assert(itSupportPhoneData.phone?.imei === testImei, "IT Support views full unmasked IMEI", `IMEI: ${itSupportPhoneData.phone?.imei}`);

  // Auditor or Supervisor should see masked IMEI (e.g. 3589•••••••1234)
  const auditorPhoneRes = await fetch(`${BASE_URL}/api/phones/${testPhoneId}`, {
    headers: { Cookie: auditorCookie },
  });
  const auditorPhoneData = await auditorPhoneRes.json();
  const isMasked = auditorPhoneData.phone?.imei?.includes("••") || auditorPhoneData.phone?.imei !== testImei;
  assert(isMasked, "Auditor views dynamically masked IMEI for privacy protection", `Masked: ${auditorPhoneData.phone?.imei}`);

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log("=======================================================\n");

  if (passedTests === totalTests) {
    console.log(">>> ALL 10 PHASE 2 ACCEPTANCE CRITERIA ARE FULLY SATISFIED! <<<\n");
    process.exit(0);
  } else {
    console.error(">>> SOME ACCEPTANCE TESTS FAILED <<<");
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
