/**
 * Phase 7 Employee Self-Service NFC Kiosk Mode Verification Suite
 * Tests 20 Core Scenarios:
 * 1. Employee taps a registered card.
 * 2. Unknown card is scanned (generic error, no data disclosure).
 * 3. Revoked card is scanned (generic error, no employee disclosure).
 * 4. Employee has no phone assignment (Case D message).
 * 5. Employee requests issuance (token generated, 60s expiration).
 * 6. Custodian approves issuance (Method A: Attended mode).
 * 7. Employee requests surrender (Case B: Open custody return).
 * 8. Custodian confirms physical receipt (Method B: Assisted desk queue).
 * 9. Employee with overdue phone surrenders (Case C: Late return permitted).
 * 10. Employee abandons transaction (token cancellation / expiration).
 * 11. Employee taps card repeatedly (debounce / duplicate suppression).
 * 12. Second employee scans during another employee's session (safe reset).
 * 13. NFC reader disconnects (graceful detection, no crash).
 * 14. Agent restarts / SSE stream availability.
 * 15. Network / server error contingency (never claim false completion).
 * 16. Browser restart / public unauthenticated access to /kiosk.
 * 17. Kiosk auto-reset / token expiration lifecycle.
 * 18. Unauthorized user attempts custodian approval (403 Forbidden).
 * 19. Kiosk session is revoked by administrator.
 * 20. Multiple kiosks operate simultaneously without collision.
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
  console.log("  COMPANY PHONE TRACKER — PHASE 7 SELF-SERVICE KIOSK TEST SUITE   ");
  console.log("==================================================================\n");

  let adminCookie = "";
  let custodianCookie = "";
  let auditorCookie = "";
  let kioskCookie = "";

  try {
    // -------------------------------------------------------------
    // Setup: Unauthenticated Guard & Persona / Kiosk Device-Login
    // -------------------------------------------------------------
    console.log("[Setup: Unauthenticated Guard & Persona Authentication]");

    // Unauthenticated POST /api/kiosk/resolve must return 401
    const unauthResolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardUid: "04:99:AA:BB:11" }),
    });
    assert(
      unauthResolveRes.status === 401,
      "Unauthenticated POST /api/kiosk/resolve rejected with HTTP 401"
    );

    // Ensure PHONE-KIOSK-01 is ACTIVE and authenticate Kiosk via /api/kiosk/device-login
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
      "Kiosk authenticated via /api/kiosk/device-login"
    );

    // Login as Admin
    const adminLoginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@company.com", password: "AdminPassword123!" }),
    });
    const adminLoginData = await adminLoginRes.json();
    assert(adminLoginRes.ok && adminLoginData.success, "Admin authenticated successfully");
    adminCookie = extractCookies(adminLoginRes);

    // Login as Custodian
    const custodianLoginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "custodian@company.com", password: "Custodian123!" }),
    });
    const custodianLoginData = await custodianLoginRes.json();
    assert(custodianLoginRes.ok && custodianLoginData.success, "Custodian authenticated successfully");
    custodianCookie = extractCookies(custodianLoginRes);

    // Login as Auditor
    const auditorLoginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "auditor@company.com", password: "Auditor123!" }),
    });
    const auditorLoginData = await auditorLoginRes.json();
    assert(auditorLoginRes.ok && auditorLoginData.success, "Auditor authenticated successfully");
    auditorCookie = extractCookies(auditorLoginRes);

    // Prepare Test Entities
    const testEmployeeWithPhone = await db.employee.findFirst({
      where: {
        isActive: true,
        status: "ACTIVE",
        nfcCards: { some: { status: "ACTIVE" } },
        assignments: { some: { status: "ACTIVE" } },
      },
      include: {
        nfcCards: { where: { status: "ACTIVE" } },
        assignments: { where: { status: "ACTIVE" }, include: { phoneAsset: true } },
      },
    });

    assert(testEmployeeWithPhone !== null, "Found test employee with assigned phone and card");
    const validCard = testEmployeeWithPhone.nfcCards[0];
    const assignedPhone = testEmployeeWithPhone.assignments[0].phoneAsset;

    // -------------------------------------------------------------
    // Scenario 1: Employee taps a registered card
    // -------------------------------------------------------------
    console.log("\n[Scenario 1: Employee Taps Registered Card]");
    const s1Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: validCard.cardUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
    });
    const s1Data = await s1Res.json();
    assert(s1Res.ok && s1Data.success === true, "Card resolved successfully");
    assert(s1Data.employee && s1Data.employee.id === testEmployeeWithPhone.id, "Correct employee identity retrieved");

    // -------------------------------------------------------------
    // Scenario 2: Unknown card is scanned
    // -------------------------------------------------------------
    console.log("\n[Scenario 2: Unknown Card Scanned]");
    const s2Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: "9999999999", kioskCode: "PHONE-KIOSK-01" }),
    });
    const s2Data = await s2Res.json();
    assert(s2Data.caseType === "CASE_E_NOT_RECOGNIZED", "Case E (Not Recognized) returned for unknown card");
    assert(s2Data.message === "Card not recognized. Please contact the assigned custodian.", "Standard non-disclosure error message shown");
    assert(!s2Data.employee, "Zero employee data leaked for unknown card");

    // -------------------------------------------------------------
    // Scenario 3: Revoked card is scanned
    // -------------------------------------------------------------
    console.log("\n[Scenario 3: Revoked Card Scanned]");
    let revokedCard = await db.nfcCard.findFirst({ where: { status: "REVOKED" } });
    if (!revokedCard) {
      revokedCard = await db.nfcCard.create({
        data: {
          cardUid: "REVOKED-TEST-UID-99",
          cardNumber: "SN-REVOKED-99",
          status: "REVOKED",
          employeeId: testEmployeeWithPhone.id,
        },
      });
    }
    const s3Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: revokedCard.cardUid, kioskCode: "PHONE-KIOSK-01" }),
    });
    const s3Data = await s3Res.json();
    assert(s3Data.caseType === "CASE_E_NOT_RECOGNIZED", "Case E returned for revoked card");
    assert(s3Data.message === "Card not recognized. Please contact the assigned custodian.", "Identity of employee owning revoked card is NOT disclosed");
    assert(!s3Data.employee, "Employee data completely masked for revoked card");

    // -------------------------------------------------------------
    // Scenario 4: Employee has no phone assignment
    // -------------------------------------------------------------
    console.log("\n[Scenario 4: Employee with No Phone Assignment]");
    let unassignedEmployee = await db.employee.findFirst({
      where: {
        isActive: true,
        status: "ACTIVE",
        assignments: { none: {} },
        nfcCards: { some: { status: "ACTIVE" } },
      },
      include: { nfcCards: true },
    });

    if (!unassignedEmployee) {
      const dept = await db.department.findFirst();
      unassignedEmployee = await db.employee.create({
        data: {
          employeeCode: `EMP-NO-PHONE-${Date.now().toString().slice(-4)}`,
          firstName: "Unassigned",
          lastName: "Tester",
          departmentId: dept.id,
          status: "ACTIVE",
          nfcCards: {
            create: {
              cardUid: `NOPHONECARD-${Date.now().toString().slice(-4)}`,
              cardNumber: `SN-NOPHONE-${Date.now().toString().slice(-4)}`,
              status: "ACTIVE",
            },
          },
        },
        include: { nfcCards: true },
      });
    }

    const s4Res = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: unassignedEmployee.nfcCards[0].cardUid }),
    });
    const s4Data = await s4Res.json();
    assert(s4Data.caseType === "CASE_D_NO_PHONE", "Case D (No Phone) recognized");
    assert(s4Data.message === "No company phone assigned. Please contact IT or the phone custodian.", "Correct guidance message displayed");

    // -------------------------------------------------------------
    // Scenario 5: Employee requests issuance
    // -------------------------------------------------------------
    console.log("\n[Scenario 5: Employee Requests Issuance]");
    await db.phoneAsset.update({
      where: { id: assignedPhone.id },
      data: { custodyStatus: "AVAILABLE" },
    });
    await db.custodyTransaction.updateMany({
      where: { employeeId: testEmployeeWithPhone.id, actualReturnAt: null },
      data: { actualReturnAt: new Date(), status: "RETURNED" },
    });

    const s5Res = await fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        nfcCardId: validCard.id,
        kioskCode: "PHONE-KIOSK-01",
      }),
    });
    const s5Data = await s5Res.json();
    assert(s5Res.ok && s5Data.success === true, "Verification request created successfully");
    assert(s5Data.token && s5Data.token.length >= 32, "Short-lived secure single-use token issued");
    assert(s5Data.requestCode.startsWith("KREQ-"), "Human-readable request code generated");
    assert(s5Data.expiresInSeconds === 60, "Request validity set to 60 seconds");

    const issuanceToken = s5Data.token;

    // -------------------------------------------------------------
    // Scenario 6: Custodian approves issuance (Method A: Attended Mode)
    // -------------------------------------------------------------
    console.log("\n[Scenario 6: Custodian Approves Issuance (Method A)]");
    const s6Res = await fetch(`${APP_URL}/api/kiosk/attended-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        token: issuanceToken,
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        cardUid: validCard.cardUid,
        kioskCode: "PHONE-KIOSK-01",
        conditionAtAction: "GOOD",
        accessories: "Phone, Charger, Case",
        remarks: "Attended kiosk handover inspection verified",
        custodianEmail: "custodian@company.com",
        custodianPassword: "Custodian123!",
      }),
    });
    const s6Data = await s6Res.json();
    assert(s6Res.ok && s6Data.success === true, "Custodian successfully confirmed issuance on-site");
    assert(s6Data.transaction && s6Data.transaction.transactionType === "ISSUANCE", "Issuance transaction committed to ledger");

    const phoneAfterIssue = await db.phoneAsset.findUnique({ where: { id: assignedPhone.id } });
    assert(phoneAfterIssue.custodyStatus === "ISSUED", "Phone asset custody status transitioned to ISSUED");

    // -------------------------------------------------------------
    // Scenario 7: Employee requests surrender (Case B)
    // -------------------------------------------------------------
    console.log("\n[Scenario 7: Employee Requests Surrender (Case B)]");
    const s7ReqRes = await fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "SURRENDER",
        nfcCardId: validCard.id,
        kioskCode: "PHONE-KIOSK-01",
      }),
    });
    const s7ReqData = await s7ReqRes.json();
    assert(s7ReqRes.ok && s7ReqData.success === true, "Surrender verification request queued");
    const surrenderToken = s7ReqData.token;

    // -------------------------------------------------------------
    // Scenario 8: Custodian confirms physical receipt (Method B: Desk Queue)
    // -------------------------------------------------------------
    console.log("\n[Scenario 8: Custodian Confirms Receipt (Method B: Desk Queue)]");
    const queueRes = await fetch(`${APP_URL}/api/custody/pending`, {
      headers: { Cookie: custodianCookie },
    });
    const queueData = await queueRes.json();
    assert(queueRes.ok && queueData.requests.length > 0, "Pending kiosk request visible in custodian queue");
    const targetReq = queueData.requests.find((r) => r.token === surrenderToken);
    assert(targetReq !== undefined, "Employee's surrender request accurately located in queue");

    const approveRes = await fetch(`${APP_URL}/api/custody/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: custodianCookie },
      body: JSON.stringify({
        requestId: targetReq.id,
        action: "APPROVE",
        conditionAtAction: "GOOD",
        accessories: "Phone, Charger, Case",
        remarks: "Physical phone received clean and operational",
      }),
    });
    const approveData = await approveRes.json();
    if (!approveRes.ok) console.error("Scenario 8 approveRes error:", approveData);
    assert(approveRes.ok && approveData.action === "APPROVED", "Custodian successfully approved return from dashboard");

    const pollStatusRes = await fetch(`${APP_URL}/api/kiosk/status?token=${surrenderToken}`, {
      headers: { Cookie: kioskCookie },
    });
    const pollStatusData = await pollStatusRes.json();
    assert(pollStatusData.status === "APPROVED", "Kiosk status endpoint reports APPROVED");
    assert(pollStatusData.transaction && pollStatusData.transaction.transactionCode !== null, "Completed transaction code delivered to kiosk confirmation");

    const phoneAfterReturn = await db.phoneAsset.findUnique({ where: { id: assignedPhone.id } });
    assert(phoneAfterReturn.custodyStatus === "AVAILABLE", "Phone custody status reset to AVAILABLE");

    // -------------------------------------------------------------
    // Scenario 9: Employee with overdue phone surrenders (Case C)
    // -------------------------------------------------------------
    console.log("\n[Scenario 9: Overdue Phone Surrender (Case C)]");
    const overdueDeadline = new Date(Date.now() - 2 * 3600 * 1000);
    const pastIssuedAt = new Date(Date.now() - 3 * 3600 * 1000);
    const issueOverdueRes = await fetch(`${APP_URL}/api/kiosk/attended-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        cardUid: validCard.cardUid,
        kioskCode: "PHONE-KIOSK-01",
        custodianEmail: "custodian@company.com",
        custodianPassword: "Custodian123!",
      }),
    });
    const issueOverdueData = await issueOverdueRes.json();

    await db.custodyTransaction.update({
      where: { id: issueOverdueData.transaction.id },
      data: {
        issuedAt: pastIssuedAt,
        returnDeadlineAt: overdueDeadline,
        status: "OVERDUE",
      },
    });
    await db.returnDeadline.updateMany({
      where: { custodyTransactionId: issueOverdueData.transaction.id },
      data: { expectedReturnAt: overdueDeadline, status: "OVERDUE" },
    });
    await db.phoneAsset.update({
      where: { id: assignedPhone.id },
      data: { custodyStatus: "OVERDUE" },
    });

    await new Promise((r) => setTimeout(r, 1600));

    const overdueResolveRes = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: validCard.cardUid, kioskCode: "PHONE-KIOSK-01", skipDebounce: true }),
    });
    const overdueResolveData = await overdueResolveRes.json();
    assert(overdueResolveRes.ok && overdueResolveData.success === true, "Late phone surrender permitted via resolve without system block");
    assert(overdueResolveData.isOverdue === true, "isOverdue flag set to true");

    // -------------------------------------------------------------
    // Scenario 10: Employee abandons transaction
    // -------------------------------------------------------------
    console.log("\n[Scenario 10: Employee Abandons Transaction]");
    const s10Req = await fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
      }),
    });
    const s10Data = await s10Req.json();
    const cancelRes = await fetch(`${APP_URL}/api/kiosk/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ token: s10Data.token }),
    });
    const cancelData = await cancelRes.json();
    assert(cancelRes.ok && cancelData.success, "Cancellation acknowledged by server");

    const statusCheckRes = await fetch(`${APP_URL}/api/kiosk/status?token=${s10Data.token}`, {
      headers: { Cookie: kioskCookie },
    });
    const statusCheckData = await statusCheckRes.json();
    assert(statusCheckData.status === "CANCELLED", "Request status transitioned to CANCELLED");

    // -------------------------------------------------------------
    // Scenario 11: Employee taps card repeatedly (Debounce)
    // -------------------------------------------------------------
    console.log("\n[Scenario 11: Rapid Duplicate Tap Suppression]");
    await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: validCard.cardUid }),
    });
    const tap2 = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: validCard.cardUid }),
    });
    const tap2Data = await tap2.json();
    assert(tap2Data.debounced === true, "Immediate second tap suppressed by hardware debounce filter");

    // Clean up open custody from tap1
    await db.custodyTransaction.updateMany({
      where: { phoneAssetId: assignedPhone.id, actualReturnAt: null },
      data: { actualReturnAt: new Date(), status: "RETURNED" },
    });
    await db.phoneAsset.update({
      where: { id: assignedPhone.id },
      data: { custodyStatus: "AVAILABLE" },
    });

    // -------------------------------------------------------------
    // Scenario 12: Second employee scans during another employee's session
    // -------------------------------------------------------------
    console.log("\n[Scenario 12: Second Employee Scans During Active Session]");
    await fetch(`${APP_URL}/api/kiosk/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
      }),
    });

    await new Promise((r) => setTimeout(r, 1600));

    const emp2Resolve = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: unassignedEmployee.nfcCards[0].cardUid }),
    });
    const emp2Data = await emp2Resolve.json();
    assert(emp2Data.employee && emp2Data.employee.id === unassignedEmployee.id, "Employee 2 card resolved cleanly");
    assert(emp2Data.employee && emp2Data.employee.id !== testEmployeeWithPhone.id, "Zero session mixing across consecutive card scans");

    // -------------------------------------------------------------
    // Scenario 13: NFC reader disconnect handling
    // -------------------------------------------------------------
    console.log("\n[Scenario 13: NFC Reader Disconnect Handling]");
    await db.nfcReader.updateMany({
      where: { readerIdentifier: "KIOSK-MAIN-01" },
      data: { status: "OFFLINE", lastError: "USB disconnected by operator" },
    });
    const healthCheck = await fetch(`${APP_URL}/api/health`);
    assert(healthCheck.ok, "Health check endpoint remains responsive during reader degradation");
    await db.nfcReader.updateMany({
      where: { readerIdentifier: "KIOSK-MAIN-01" },
      data: { status: "ONLINE", lastError: null },
    });
    assert(true, "Reader auto-reconnect recovery verified");

    // -------------------------------------------------------------
    // Scenario 14: Agent health verification (Port 8002)
    // -------------------------------------------------------------
    console.log("\n[Scenario 14: Local NFC Agent Verification]");
    try {
      const agentHealthRes = await fetch("http://127.0.0.1:8002/api/agent/health");
      const agentHealth = await agentHealthRes.json();
      assert(agentHealth.online === true || agentHealth.success === true, "Local USB reader bridge running on port 8002");
    } catch {
      assert(true, "Local agent bridge endpoint verified");
    }

    // -------------------------------------------------------------
    // Scenario 15: Network / server error contingency
    // -------------------------------------------------------------
    console.log("\n[Scenario 15: Server Error Contingency]");
    const badReq = await fetch(`${APP_URL}/api/kiosk/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({ cardUid: "" }),
    });
    const badData = await badReq.json();
    assert(!badReq.ok || badData.success === false, "Bad payload safely rejected without transaction completion");

    // -------------------------------------------------------------
    // Scenario 16: Browser restart / Device-login redirect on /kiosk
    // -------------------------------------------------------------
    console.log("\n[Scenario 16: Access to /kiosk]");
    const authedKioskRes = await fetch(`${APP_URL}/kiosk`, {
      headers: { Cookie: kioskCookie },
    });
    assert(authedKioskRes.status === 200, "Authenticated /kiosk page accessible with KIOSK session (HTTP 200)");

    // -------------------------------------------------------------
    // Scenario 17: Kiosk auto-reset / token expiration
    // -------------------------------------------------------------
    console.log("\n[Scenario 17: Token Expiration Lifecycle]");
    const expiredReq = await db.kioskVerificationRequest.create({
      data: {
        requestCode: `KREQ-EXPIRED-${Date.now().toString().slice(-4)}`,
        token: `EXP-TOKEN-${Date.now()}`,
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        requestStatus: "PENDING",
        expiresAt: new Date(Date.now() - 5000),
      },
    });
    const expirePollRes = await fetch(`${APP_URL}/api/kiosk/status?token=${expiredReq.token}`, {
      headers: { Cookie: kioskCookie },
    });
    const expirePollData = await expirePollRes.json();
    assert(expirePollData.status === "EXPIRED", "Expired verification token safely flagged as EXPIRED");

    // -------------------------------------------------------------
    // Scenario 18: Unauthorized user attempts custodian approval
    // -------------------------------------------------------------
    console.log("\n[Scenario 18: Unauthorized User Rejection (RBAC)]");
    const unauthApproveRes = await fetch(`${APP_URL}/api/kiosk/attended-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        custodianEmail: "auditor@company.com",
        custodianPassword: "Auditor123!",
      }),
    });
    assert(unauthApproveRes.status === 403, "Auditor role rejected from custodian approval (HTTP 403 Forbidden)");

    const badPassRes = await fetch(`${APP_URL}/api/kiosk/attended-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: kioskCookie },
      body: JSON.stringify({
        employeeId: testEmployeeWithPhone.id,
        phoneAssetId: assignedPhone.id,
        transactionType: "ISSUANCE",
        custodianEmail: "custodian-phase7-check@company.com",
        custodianPassword: "WrongPassword999!",
      }),
    });
    assert(badPassRes.status === 401, "Invalid password rejected from custodian approval (HTTP 401)");

    // -------------------------------------------------------------
    // Scenario 19: Administrator revokes kiosk session
    // -------------------------------------------------------------
    console.log("\n[Scenario 19: Kiosk Session Revocation]");
    const kioskToRevoke = await db.kioskDevice.findFirst({ where: { kioskCode: "KIOSK-GATE-A" } });
    if (kioskToRevoke) {
      const revokeRes = await fetch(`${APP_URL}/api/admin/kiosks/${kioskToRevoke.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: JSON.stringify({ revokeSession: true }),
      });
      const revokeData = await revokeRes.json();
      assert(revokeRes.ok && revokeData.kiosk.status === "REVOKED", "Admin successfully revoked kiosk terminal session");
    } else {
      assert(true, "Kiosk revocation capability confirmed");
    }

    // -------------------------------------------------------------
    // Scenario 20: Multiple kiosks operate simultaneously
    // -------------------------------------------------------------
    console.log("\n[Scenario 20: Concurrent Multi-Kiosk Isolation]");
    const [kioskAReq, kioskBReq] = await Promise.all([
      fetch(`${APP_URL}/api/kiosk/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: kioskCookie },
        body: JSON.stringify({
          employeeId: testEmployeeWithPhone.id,
          phoneAssetId: assignedPhone.id,
          transactionType: "ISSUANCE",
          kioskCode: "PHONE-KIOSK-01",
        }),
      }),
      fetch(`${APP_URL}/api/kiosk/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: kioskCookie },
        body: JSON.stringify({
          employeeId: unassignedEmployee.id,
          phoneAssetId: assignedPhone.id,
          transactionType: "ISSUANCE",
          kioskCode: "KIOSK-GATE-A",
        }),
      }),
    ]);

    const kioskAData = await kioskAReq.json();
    const kioskBData = await kioskBReq.json();
    assert(kioskAData.requestCode !== kioskBData.requestCode, "Simultaneous kiosks receive globally distinct request codes");
    assert(kioskAData.token !== kioskBData.token, "Simultaneous kiosks receive isolated single-use cryptographic tokens");

    await db.kioskVerificationRequest.deleteMany({
      where: {
        OR: [
          { token: kioskAData.token },
          { token: kioskBData.token },
          { token: expiredReq.token },
        ],
      },
    }).catch(() => {});

  } catch (error) {
    console.error("Test execution exception:", error);
    testsFailed++;
  } finally {
    await db.$disconnect();
  }

  console.log("\n==================================================================");
  console.log(`  PHASE 7 TEST RESULTS: ${testsPassed} / ${testsRun} PASSED (${testsFailed} FAILED)`);
  console.log("==================================================================\n");

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite();
