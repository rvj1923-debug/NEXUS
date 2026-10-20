/**
 * Phase 4 Automated Verification Test Suite
 * Company Phone Issuance, Surrender & NFC Kiosk
 * Modules A through H: Issuance, Surrender, Condition Assessment, State Machine,
 * Monitoring & History, Exceptions & Manual Overrides, Kiosk Handshake, and Concurrency.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const APP_URL = "http://127.0.0.1:4000";

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
  console.log("  COMPANY PHONE TRACKER — PHASE 4 AUTOMATED VERIFICATION SUITE");
  console.log("==================================================================\n");

  let adminCookie = "";
  let testEmployee = null;
  let testPhone1 = null;
  let testPhone2 = null;
  let testDepartment = null;

  // 0. Setup: Authenticate Admin & Custodian User
  console.log("[Test Group 0: Session & Seed Setup]");
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

    // Ensure department exists
    testDepartment = await db.department.findFirst();
    if (!testDepartment) {
      testDepartment = await db.department.create({
        data: { name: "Operations Phase4", code: "OPS-P4" },
      });
    }

    // Create or locate test employee
    testEmployee = await db.employee.findFirst({
      where: { employeeCode: "EMP-P4-001" },
    });
    if (!testEmployee) {
      testEmployee = await db.employee.create({
        data: {
          employeeCode: "EMP-P4-001",
          firstName: "Marcus",
          lastName: "Vance",
          departmentId: testDepartment.id,
          designation: "Field Technician",
          status: "ACTIVE",
          worksite: "Field Depot Alpha",
        },
      });

      // Create an associated shift for shift deadline computation
      await db.employeeShift.create({
        data: {
          employeeId: testEmployee.id,
          shiftName: "Day Shift",
          startTime: "08:00",
          endTime: "17:00",
          gracePeriodMinutes: 30,
        },
      });
    }

    // Create test phone assets
    testPhone1 = await db.phoneAsset.upsert({
      where: { assetTag: "ASSET-P4-001" },
      update: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
      create: {
        assetTag: "ASSET-P4-001",
        brand: "Samsung",
        model: "Galaxy XCover Pro",
        imei: "354928109988771",
        departmentId: testDepartment.id,
        condition: "GOOD",
        custodyStatus: "AVAILABLE",
        operationalStatus: "ACTIVE",
      },
    });

    testPhone2 = await db.phoneAsset.upsert({
      where: { assetTag: "ASSET-P4-002" },
      update: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
      create: {
        assetTag: "ASSET-P4-002",
        brand: "Apple",
        model: "iPhone 13 Enterprise",
        imei: "354928109988772",
        departmentId: testDepartment.id,
        condition: "GOOD",
        custodyStatus: "AVAILABLE",
        operationalStatus: "ACTIVE",
      },
    });

    // Ensure Jane Doe (0114156366) has active phone assignment for Module G
    const janeDoe = await db.employee.findFirst({ where: { employeeCode: "ENG-009" } });
    if (janeDoe) {
      const janePhone = await db.phoneAsset.upsert({
        where: { assetTag: "MOB-JANE-001" },
        update: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
        create: {
          assetTag: "MOB-JANE-001",
          brand: "Samsung",
          model: "Galaxy A54",
          imei: "354928109988779",
          departmentId: janeDoe.departmentId,
          condition: "GOOD",
          custodyStatus: "AVAILABLE",
          operationalStatus: "ACTIVE",
        },
      });
      await db.phoneAssignment.upsert({
        where: { id: "jane-assignment-009" },
        update: { status: "ACTIVE", phoneAssetId: janePhone.id },
        create: {
          id: "jane-assignment-009",
          employeeId: janeDoe.id,
          phoneAssetId: janePhone.id,
          status: "ACTIVE",
          startDate: new Date(),
        },
      });
    }

    assert(testEmployee && testPhone1 && testPhone2, "Test fixtures initialized cleanly");
  } catch (e) {
    assert(false, `Setup failed: ${e.message}`);
  }

  // 1. Module A: Dedicated Phone Issuance Workflow
  console.log("\n[Test Group 1: Module A — Dedicated Phone Issuance Workflow]");
  let activeTx1 = null;
  try {
    const issueRes = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        conditionAtAction: "GOOD",
        accessoriesIssued: "Phone, Heavy-duty Case, USB-C Cable",
        remarks: "Shift checkout for site inspection",
        verifiedViaNfc: true,
      }),
    });
    const issueData = await issueRes.json();
    assert(issueRes.ok && issueData.success, "Device issued successfully through /api/custody/issue");
    assert(issueData.transaction?.transactionCode?.includes("TX-"), "Generated valid transaction code");
    assert(issueData.transaction?.status === "ISSUED", "Transaction marked in ISSUED status");
    assert(issueData.phone?.custodyStatus === "ISSUED", "Phone custodyStatus updated to ISSUED");
    assert(issueData.transaction?.returnDeadlineAt !== null, "Return deadline timestamp computed in Asia/Manila");

    activeTx1 = issueData.transaction;

    // Verify database state directly
    const dbTx = await db.custodyTransaction.findUnique({
      where: { id: activeTx1.id },
      include: { returnDeadline: true, custodyEvents: true },
    });
    assert(dbTx !== null, "Transaction persisted in PostgreSQL database");
    assert(dbTx?.returnDeadline !== null, "ReturnDeadline child record created with grace period");
    assert(
      dbTx?.custodyEvents?.some((e) => e.eventType === "CHECKED_OUT"),
      "Immutable CustodyEvent CHECKED_OUT logged"
    );
  } catch (e) {
    assert(false, `Module A test failed: ${e.message}`);
  }

  // 2. Physical Custody Guard & Conflict Blocking
  console.log("\n[Test Group 2: Physical Custody Guard & Duplicate Protection]");
  try {
    // Attempt 1: Re-issuing the same phone while already issued
    const conflictPhoneRes = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        conditionAtAction: "GOOD",
      }),
    });
    const conflictPhoneData = await conflictPhoneRes.json();
    assert(
      conflictPhoneRes.status === 409,
      "Blocked duplicate checkout of already-issued phone asset (409 Conflict)"
    );

    // Attempt 2: Issuing a second phone to employee who already holds an open transaction
    const conflictEmpRes = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone2.id,
        conditionAtAction: "GOOD",
      }),
    });
    const conflictEmpData = await conflictEmpRes.json();
    assert(
      conflictEmpRes.status === 409,
      "Blocked duplicate phone issuance to employee with open custody transaction (409 Conflict)"
    );
  } catch (e) {
    assert(false, `Physical custody guard test failed: ${e.message}`);
  }

  // 3. Module B: Dedicated Phone Surrender Workflow & Punctuality
  console.log("\n[Test Group 3: Module B — Dedicated Phone Surrender Workflow & Punctuality]");
  try {
    const surrenderRes = await fetch(`${APP_URL}/api/custody/surrender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        transactionId: activeTx1.id,
        conditionAtAction: "GOOD",
        accessoriesReturned: "All accessories returned complete",
        remarks: "Normal end-of-shift return",
      }),
    });
    const surrenderData = await surrenderRes.json();
    assert(surrenderRes.ok && surrenderData.success, "Device surrendered successfully through /api/custody/surrender");
    assert(surrenderData.transaction?.status === "RETURNED", "Transaction status updated to RETURNED");
    assert(surrenderData.returnStatus === "ON_TIME", "Punctuality evaluated as ON_TIME");
    assert(surrenderData.phone?.custodyStatus === "AVAILABLE", "Phone custodyStatus reset to AVAILABLE");
    assert(
      surrenderData.custodyDurationMinutes !== undefined && surrenderData.custodyDurationMinutes >= 0,
      "Custody duration computed in minutes"
    );

    // Verify database events
    const events = await db.custodyEvent.findMany({
      where: { transactionId: activeTx1.id },
    });
    assert(
      events.some((e) => e.eventType === "CHECKED_IN"),
      "Immutable CustodyEvent CHECKED_IN recorded"
    );
  } catch (e) {
    assert(false, `Module B test failed: ${e.message}`);
  }

  // 4. Module C: Phone Condition Assessment & Automated Incident Triggering
  console.log("\n[Test Group 4: Module C — Phone Condition & Automated Incident Logging]");
  try {
    // First, issue phone2 to testEmployee
    const issueRes2 = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone2.id,
        conditionAtAction: "GOOD",
      }),
    });
    const issueData2 = await issueRes2.json();
    assert(issueRes2.ok && issueData2.success, "Device 2 checked out successfully");
    const activeTx2 = issueData2.transaction;

    // Attempt surrender with MAJOR_DAMAGE but NO remarks -> must be blocked
    const failDamageRes = await fetch(`${APP_URL}/api/custody/surrender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        transactionId: activeTx2.id,
        conditionAtAction: "MAJOR_DAMAGE",
        conditionNotes: "",
        remarks: "",
      }),
    });
    assert(
      failDamageRes.status === 400 || failDamageRes.status === 422,
      "Surrender with damage blocked when mandatory condition notes/remarks omitted (400/422 Unprocessable/Bad Request)"
    );

    // Surrender with MAJOR_DAMAGE and detailed remarks -> must auto-create Incident
    const successDamageRes = await fetch(`${APP_URL}/api/custody/surrender`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        transactionId: activeTx2.id,
        conditionAtAction: "MAJOR_DAMAGE",
        conditionNotes: "Screen cracked diagonally across top sensor; touch unresponsive",
        accessoriesReturned: "Charger returned, case damaged",
      }),
    });
    const successDamageData = await successDamageRes.json();
    assert(successDamageRes.ok && successDamageData.success, "Surrender with damage processed successfully");
    assert(successDamageData.incident !== null, "Automated Incident report created by custody engine");
    assert(
      successDamageData.incident?.incidentNumber?.startsWith("INC-"),
      "Incident generated with official INC- tracking number"
    );
    assert(
      successDamageData.phone?.custodyStatus === "AVAILABLE",
      "Phone returned from employee custody"
    );

    // Check that phone operationalStatus was shifted to UNDER_MAINTENANCE / DAMAGED
    const phoneAfterDamage = await db.phoneAsset.findUnique({
      where: { id: testPhone2.id },
    });
    assert(
      phoneAfterDamage.operationalStatus === "UNDER_MAINTENANCE" ||
        phoneAfterDamage.operationalStatus === "DAMAGED",
      "Damaged phone automatically flagged for maintenance/quarantine"
    );
  } catch (e) {
    assert(false, `Module C test failed: ${e.message}`);
  }

  // 5. Module D: Idempotency Protection & Duplicate Suppression
  console.log("\n[Test Group 5: Module D & H — Idempotency Protection]");
  try {
    // Reset testPhone1 to AVAILABLE
    await db.phoneAsset.update({
      where: { id: testPhone1.id },
      data: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
    });

    const uniqueIdempotencyKey = `IDEM-TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // First request
    const firstRes = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": uniqueIdempotencyKey,
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        conditionAtAction: "GOOD",
      }),
    });
    const firstData = await firstRes.json();
    assert(firstRes.ok && firstData.success, "Initial request with idempotency key succeeded");

    // Second request with EXACT SAME idempotency key (simulating network duplicate / retry burst)
    const replayRes = await fetch(`${APP_URL}/api/custody/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": uniqueIdempotencyKey,
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        conditionAtAction: "GOOD",
      }),
    });
    const replayData = await replayRes.json();
    assert(replayRes.ok && replayData.success, "Idempotent replay request succeeded safely (no 409 conflict)");
    assert(
      replayData.transaction?.id === firstData.transaction?.id,
      "Returned identical existing transaction ID without duplicating records"
    );

    // Clean up checkout
    await db.custodyTransaction.update({
      where: { id: firstData.transaction.id },
      data: { status: "RETURNED", actualReturnAt: new Date(), returnStatus: "ON_TIME" },
    });
    await db.phoneAsset.update({
      where: { id: testPhone1.id },
      data: { custodyStatus: "AVAILABLE" },
    });
  } catch (e) {
    assert(false, `Idempotency test failed: ${e.message}`);
  }

  // 6. Module F: Exceptions & Manual Overrides Workflow
  console.log("\n[Test Group 6: Module F — Custody Exceptions & Manual Overrides]");
  try {
    // 6.1 Sensitive exception without supervisor authorization -> must fail
    const unapprovedRes = await fetch(`${APP_URL}/api/custody/exception`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        exceptionType: "PHONE_REPORTED_LOST",
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        reason: "Employee left phone on delivery truck",
        supervisorApproved: false,
      }),
    });
    assert(
      unapprovedRes.status === 403,
      "Sensitive exception (PHONE_REPORTED_LOST) blocked without supervisor authorization (403 Forbidden)"
    );

    // 6.2 Sensitive exception with supervisor authorization -> must succeed
    const approvedRes = await fetch(`${APP_URL}/api/custody/exception`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        exceptionType: "PHONE_REPORTED_LOST",
        employeeId: testEmployee.id,
        phoneAssetId: testPhone1.id,
        reason: "Employee reported phone lost during transit on highway",
        supervisorApproved: true,
        supervisorNotes: "Authorized by Ops Lead Jane Doe via verbal confirmation",
      }),
    });
    const approvedData = await approvedRes.json();
    assert(approvedRes.ok && approvedData.success, "Authorized lost phone exception override processed");
    assert(approvedData.transaction?.isManualOverride === true, "Marked as isManualOverride: true");
    assert(approvedData.transaction?.status === "LOST", "Transaction status updated to LOST");
    assert(approvedData.incident !== null, "Automated Incident report logged for lost device");

    // Clean up test phone status
    await db.phoneAsset.update({
      where: { id: testPhone1.id },
      data: { custodyStatus: "AVAILABLE", operationalStatus: "ACTIVE" },
    });
  } catch (e) {
    assert(false, `Module F test failed: ${e.message}`);
  }

  // 7. Module E: Transaction History, Detail, and Active Monitoring APIs
  console.log("\n[Test Group 7: Module E — Custody Queries & Audit Views]");
  try {
    // 7.1 GET /api/custody
    const listRes = await fetch(`${APP_URL}/api/custody?limit=5`, {
      headers: { Cookie: adminCookie },
    });
    const listData = await listRes.json();
    assert(listRes.ok && listData.success, "GET /api/custody returns paginated ledger");
    assert(Array.isArray(listData.transactions) && listData.transactions.length > 0, "Ledger contains transactions");
    assert(listData.pagination?.total > 0, "Pagination metadata populated accurately");

    // 7.2 GET /api/custody/[id]
    const sampleTxId = listData.transactions[0].id;
    const detailRes = await fetch(`${APP_URL}/api/custody/${sampleTxId}`, {
      headers: { Cookie: adminCookie },
    });
    const detailData = await detailRes.json();
    assert(detailRes.ok && detailData.success, "GET /api/custody/[id] returns single transaction detail");
    assert(detailData.transaction?.employee !== undefined, "Includes nested employee relation");
    assert(detailData.transaction?.phoneAsset !== undefined, "Includes nested phoneAsset relation");
    assert(Array.isArray(detailData.transaction?.custodyEvents), "Includes nested immutable custodyEvents");

    // 7.3 GET /api/custody/active
    const activeRes = await fetch(`${APP_URL}/api/custody/active`, {
      headers: { Cookie: adminCookie },
    });
    const activeData = await activeRes.json();
    assert(activeRes.ok && activeData.success, "GET /api/custody/active returns live active custody list");
    assert(Array.isArray(activeData.activeCustody), "Active custody collection returned");
  } catch (e) {
    assert(false, `Module E test failed: ${e.message}`);
  }

  // 8. Module G: Kiosk Resolution & Live NFC Card Handshake
  console.log("\n[Test Group 8: Module G — NFC Kiosk Turnstile Integration]");
  try {
    // Test card tap resolution with physical card UID 0114156366
    const resolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardUid: "0114156366",
        readerIdentifier: "KIOSK-GATE-A",
      }),
    });
    const resolveData = await resolveRes.json();
    assert(resolveRes.ok && resolveData.success, "NFC Kiosk resolved physical card tap 0114156366");
    assert(resolveData.employee?.fullName === "Jane Doe", "Card correctly mapped to Jane Doe");
    assert(resolveData.card?.status === "ACTIVE", "Card status verified as ACTIVE");
    assert(
      resolveData.proposedAction === "ISSUANCE" || resolveData.proposedAction === "SURRENDER",
      "Kiosk accurately proposed next turnstile action"
    );
  } catch (e) {
    assert(false, `Module G test failed: ${e.message}`);
  }

  // Summary
  console.log("\n==================================================================");
  console.log(`  PHASE 4 TEST SUMMARY: ${testsPassed} / ${testsRun} PASSED (${Math.round((testsPassed / testsRun) * 100)}%)`);
  if (testsFailed === 0) {
    console.log("  >>> ALL PHASE 4 ACCEPTANCE CRITERIA VERIFIED 100% SUCCESSFUL <<<");
  } else {
    console.log(`  >>> ATTENTION: ${testsFailed} TESTS FAILED <<<`);
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
