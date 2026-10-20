/**
 * Verification Script: /api/kiosk/resolve Atomicity & Concurrency
 *
 * Tests against an isolated temporary PG_DATA_DIR and BACKUP_DIR:
 *  (a) 5 concurrent resolve requests for the same card ->
 *      exactly one TIME_IN, phone status ISSUED, one open transaction, one ReturnDeadline
 *  (b) after the 15s cooldown, 5 concurrent resolve requests ->
 *      exactly one TIME_OUT, phone status AVAILABLE, the ReturnDeadline marked returned
 *  (c) simulated mid-transaction failure (CPT_TEST_FAIL_AFTER_TX_CREATE=1 when NODE_ENV !== "production") ->
 *      nothing written: phone status unchanged, no new transaction, no deadline, returns "Please tap again"
 *  (d) maintenance card ->
 *      returns { maintenance: true }, no custody transaction written
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";

const PROJECT_ROOT = process.cwd();
const APP_PORT = 5068;

// Parse .env so Next.js and PrismaClient share the exact same env vars while using temp PG_DATA_DIR/BACKUP_DIR
const envContent = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
const envVars = {};
for (const rawLine of envContent.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq > 0) {
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    envVars[k] = v;
  }
}

const PG_CONTROL_PORT = parseInt(envVars.PG_CONTROL_PORT || "54320", 10);
const KIOSK_SECRET = envVars.KIOSK_DEVICE_SECRET || "CPT-TEST-ATOMIC-KIOSK-DEVICE-SECRET-2026-KEY";
const KIOSK_CODE = envVars.KIOSK_CODE || "PHONE-KIOSK-01";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status > 0) return res;
    } catch {
      // retry
    }
    await sleep(350);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startNextDev(extraEnv = {}) {
  const nextCli = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
  const proc = spawn(process.execPath, [nextCli, "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "development",
      KIOSK_CODE,
      KIOSK_DEVICE_SECRET: KIOSK_SECRET,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

async function stopProcess(proc) {
  if (!proc || proc.killed) return;
  try {
    proc.kill();
  } catch {
    // ignore
  }
  await sleep(800);
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cpt-resolve-atomicity-"));
  const tempPgDataDir = path.join(tmpRoot, "postgres_data");
  const tempBackupDir = path.join(tmpRoot, "backups");
  const tempMirrorDir = path.join(tmpRoot, "backups_mirror");

  console.log(`[SETUP] Isolated temp PG_DATA_DIR=${tempPgDataDir}`);
  console.log(`[SETUP] Isolated temp BACKUP_DIR=${tempBackupDir}`);
  fs.cpSync(path.join(PROJECT_ROOT, "postgres_data"), tempPgDataDir, { recursive: true });
  const stalePid = path.join(tempPgDataDir, "postmaster.pid");
  if (fs.existsSync(stalePid)) fs.unlinkSync(stalePid);
  fs.mkdirSync(tempBackupDir, { recursive: true });
  fs.mkdirSync(tempMirrorDir, { recursive: true });

  let dbProc = null;
  let nextProc = null;
  let prisma = null;

  try {
    // 1. Start isolated PGlite DB server against tempPgDataDir
    dbProc = spawn(process.execPath, ["scripts/db-server.mjs"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...envVars,
        PG_DATA_DIR: tempPgDataDir,
        BACKUP_DIR: tempBackupDir,
        BACKUP_MIRROR_DIR: tempMirrorDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForHttp(`http://127.0.0.1:${PG_CONTROL_PORT}/health`, 30000);
    console.log(`[SETUP] Isolated PGlite DB server ready (control port ${PG_CONTROL_PORT})`);

    prisma = new PrismaClient({
      datasources: { db: { url: envVars.DATABASE_URL } },
    });

    // 2. Prepare deterministic test fixtures in the temporary DB
    const kioskKey = KIOSK_SECRET;

    await prisma.kioskDevice.upsert({
      where: { kioskCode: KIOSK_CODE },
      update: {
        status: "ACTIVE",
        sessionSecret: kioskKey,
      },
      create: {
        kioskCode: KIOSK_CODE,
        name: "Main Lobby Kiosk",
        location: "Main Lobby",
        status: "ACTIVE",
        sessionSecret: kioskKey,
      },
    });

    let dept = await prisma.department.findFirst();
    if (!dept) {
      dept = await prisma.department.create({
        data: { code: "ATOMIC-DEPT", name: "Atomicity Test Department" },
      });
    }

    const employee = await prisma.employee.create({
      data: {
        employeeCode: `EMP-ATOM-${Date.now().toString().slice(-4)}`,
        firstName: "Atomic",
        lastName: "Tester",
        departmentId: dept.id,
        designation: "QA Engineer",
        status: "ACTIVE",
        isActive: true,
      },
    });

    const phone = await prisma.phoneAsset.create({
      data: {
        assetTag: `PH-ATOM-${Date.now().toString().slice(-4)}`,
        imei: `3599887766${Date.now().toString().slice(-5)}`,
        brand: "Samsung",
        model: "Galaxy XCover6 Pro",
        condition: "GOOD",
        operationalStatus: "ACTIVE",
        assignmentStatus: "ASSIGNED",
        custodyStatus: "AVAILABLE",
        departmentId: dept.id,
        isActive: true,
      },
    });

    await prisma.phoneAssignment.create({
      data: {
        employeeId: employee.id,
        phoneAssetId: phone.id,
        assignmentType: "DEDICATED",
        status: "ACTIVE",
      },
    });

    const testCardUid = "04:AA:BB:CC:DD";
    const card = await prisma.nfcCard.create({
      data: {
        cardUid: testCardUid,
        cardNumber: `SN-${testCardUid}`,
        identifierType: "MIFARE_CLASSIC",
        status: "ACTIVE",
        isMaintenanceCard: false,
        employeeId: employee.id,
        phoneAssetId: phone.id,
      },
    });

    const maintCardUid = "04:FF:EE:DD:CC";
    const maintCard = await prisma.nfcCard.create({
      data: {
        cardUid: maintCardUid,
        cardNumber: `SN-${maintCardUid}`,
        identifierType: "MIFARE_CLASSIC",
        status: "ACTIVE",
        isMaintenanceCard: true,
      },
    });

    // 3. Start Next.js dev server (NODE_ENV=development)
    nextProc = startNextDev({ CPT_TEST_FAIL_AFTER_TX_CREATE: "0" });
    await waitForHttp(`http://127.0.0.1:${APP_PORT}/api/health`, 45000);
    console.log(`[SETUP] Next.js dev server ready on http://127.0.0.1:${APP_PORT}`);

    // Obtain valid KIOSK session cookie via /api/kiosk/device-login
    const loginRes = await fetch(
      `http://127.0.0.1:${APP_PORT}/api/kiosk/device-login?key=${encodeURIComponent(kioskKey)}`,
      { redirect: "manual" }
    );
    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookieHeader.includes("cpt_session=")) {
      throw new Error(`Failed to acquire kiosk session cookie: ${cookieHeader}`);
    }

    const fireResolve = async (uid) => {
      const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/kiosk/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          cardUid: uid,
          skipDebounce: true,
        }),
      });
      const json = await res.json();
      return { status: res.status, body: json };
    };

    // =========================================================================
    // (a) Fire 5 concurrent resolve requests for the same card ->
    //     exactly one TIME_IN, phone status ISSUED, one open transaction, one ReturnDeadline
    // =========================================================================
    console.log("\n=== [TEST (a)] 5 concurrent resolve requests -> exactly 1 TIME_IN ===");
    const resultsA = await Promise.all([
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
    ]);

    const timeInSuccesses = resultsA.filter((r) => r.body.success === true && r.body.action === "TIME_IN");
    const timeInBlocked = resultsA.filter(
      (r) => r.body.success === false && r.body.caseType === "CASE_DOUBLE_TAP_PREVENTED"
    );

    const phoneAfterA = await prisma.phoneAsset.findUnique({ where: { id: phone.id } });
    const openTxsAfterA = await prisma.custodyTransaction.findMany({
      where: {
        nfcCardId: card.id,
        actualReturnAt: null,
        status: { in: ["ISSUED", "TIME_IN", "OVERDUE"] },
      },
    });
    const allTxsAfterA = await prisma.custodyTransaction.findMany({
      where: { nfcCardId: card.id },
    });
    const deadlinesAfterA = await prisma.returnDeadline.findMany({
      where: { phoneAssetId: phone.id },
    });

    console.log(`TIME_IN success responses: ${timeInSuccesses.length} (expected 1)`);
    console.log(`CASE_DOUBLE_TAP_PREVENTED responses: ${timeInBlocked.length} (expected 4)`);
    console.log(`Phone custodyStatus: ${phoneAfterA.custodyStatus} (expected ISSUED)`);
    console.log(`Open CustodyTransactions for card: ${openTxsAfterA.length} (expected 1)`);
    console.log(`Total CustodyTransactions for card: ${allTxsAfterA.length} (expected 1)`);
    console.log(
      `ReturnDeadlines for phone: ${deadlinesAfterA.length} (expected 1, status=${deadlinesAfterA[0]?.status})`
    );

    if (
      timeInSuccesses.length !== 1 ||
      timeInBlocked.length !== 4 ||
      phoneAfterA.custodyStatus !== "ISSUED" ||
      openTxsAfterA.length !== 1 ||
      allTxsAfterA.length !== 1 ||
      deadlinesAfterA.length !== 1 ||
      deadlinesAfterA[0].status !== "PENDING"
    ) {
      throw new Error(`Test (a) failed! Responses: ${JSON.stringify(resultsA)}`);
    }

    // =========================================================================
    // (b) After the 15s cooldown, fire 5 concurrent resolve requests ->
    //     exactly one TIME_OUT, phone AVAILABLE, the deadline marked returned
    // =========================================================================
    console.log("\n=== [TEST (b)] Waiting 15.5s for cooldown, then firing 5 concurrent resolve requests -> exactly 1 TIME_OUT ===");
    await sleep(15500);

    const resultsB = await Promise.all([
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
      fireResolve(testCardUid),
    ]);

    const timeOutSuccesses = resultsB.filter((r) => r.body.success === true && r.body.action === "TIME_OUT");
    const timeOutBlocked = resultsB.filter(
      (r) => r.body.success === false && r.body.caseType === "CASE_DOUBLE_TAP_PREVENTED"
    );

    const phoneAfterB = await prisma.phoneAsset.findUnique({ where: { id: phone.id } });
    const openTxsAfterB = await prisma.custodyTransaction.findMany({
      where: {
        nfcCardId: card.id,
        actualReturnAt: null,
      },
    });
    const timeOutRowsAfterB = await prisma.custodyTransaction.findMany({
      where: {
        nfcCardId: card.id,
        transactionType: "TIME_OUT",
      },
    });
    const deadlinesAfterB = await prisma.returnDeadline.findMany({
      where: { phoneAssetId: phone.id },
    });

    console.log(`TIME_OUT success responses: ${timeOutSuccesses.length} (expected 1)`);
    console.log(`CASE_DOUBLE_TAP_PREVENTED responses: ${timeOutBlocked.length} (expected 4)`);
    console.log(`Phone custodyStatus: ${phoneAfterB.custodyStatus} (expected AVAILABLE)`);
    console.log(`Open CustodyTransactions for card: ${openTxsAfterB.length} (expected 0)`);
    console.log(`TIME_OUT CustodyTransaction rows: ${timeOutRowsAfterB.length} (expected 1)`);
    console.log(
      `ReturnDeadline status: ${deadlinesAfterB[0]?.status}, actualReturnAt=${deadlinesAfterB[0]?.actualReturnAt?.toISOString()}`
    );

    if (
      timeOutSuccesses.length !== 1 ||
      timeOutBlocked.length !== 4 ||
      phoneAfterB.custodyStatus !== "AVAILABLE" ||
      openTxsAfterB.length !== 0 ||
      timeOutRowsAfterB.length !== 1 ||
      deadlinesAfterB.length !== 1 ||
      deadlinesAfterB[0].status !== "RETURNED_ON_TIME" ||
      !deadlinesAfterB[0].actualReturnAt
    ) {
      throw new Error(`Test (b) failed! Responses: ${JSON.stringify(resultsB)}`);
    }

    // =========================================================================
    // (d) Maintenance card -> still no custody write
    // =========================================================================
    console.log("\n=== [TEST (d)] Maintenance card tap -> no custody write ===");
    const txCountBeforeMaint = await prisma.custodyTransaction.count();
    const deadlineCountBeforeMaint = await prisma.returnDeadline.count();
    const maintRes = await fireResolve(maintCard.cardUid);
    const txCountAfterMaint = await prisma.custodyTransaction.count();
    const deadlineCountAfterMaint = await prisma.returnDeadline.count();

    console.log(`Maintenance response: ${JSON.stringify(maintRes.body)}`);
    console.log(`CustodyTransaction count before=${txCountBeforeMaint}, after=${txCountAfterMaint}`);
    console.log(`ReturnDeadline count before=${deadlineCountBeforeMaint}, after=${deadlineCountAfterMaint}`);

    if (
      maintRes.status !== 200 ||
      maintRes.body.maintenance !== true ||
      txCountAfterMaint !== txCountBeforeMaint ||
      deadlineCountAfterMaint !== deadlineCountBeforeMaint
    ) {
      throw new Error(`Test (d) failed! Response: ${JSON.stringify(maintRes)}`);
    }

    // =========================================================================
    // (c) Simulate failure mid-transaction (CPT_TEST_FAIL_AFTER_TX_CREATE=1) ->
    //     nothing written: phone status unchanged, no new transaction, no deadline
    // =========================================================================
    console.log("\n=== [TEST (c)] Simulated mid-transaction failure (CPT_TEST_FAIL_AFTER_TX_CREATE=1) ===");
    // Backdate actualReturnAt on the closed transactions so the 15s cooldown is passed immediately
    const pastTime = new Date(Date.now() - 30000);
    await prisma.custodyTransaction.updateMany({
      where: { nfcCardId: card.id },
      data: { actualReturnAt: pastTime, timestamp: new Date(Date.now() - 60000) },
    });

    await stopProcess(nextProc);
    nextProc = startNextDev({ CPT_TEST_FAIL_AFTER_TX_CREATE: "1" });
    await waitForHttp(`http://127.0.0.1:${APP_PORT}/api/health`, 45000);

    const txCountBeforeFail = await prisma.custodyTransaction.count({ where: { nfcCardId: card.id } });
    const deadlineCountBeforeFail = await prisma.returnDeadline.count({ where: { phoneAssetId: phone.id } });
    const phoneBeforeFail = await prisma.phoneAsset.findUnique({ where: { id: phone.id } });

    const failRes = await fireResolve(testCardUid);

    const txCountAfterFail = await prisma.custodyTransaction.count({ where: { nfcCardId: card.id } });
    const deadlineCountAfterFail = await prisma.returnDeadline.count({ where: { phoneAssetId: phone.id } });
    const phoneAfterFail = await prisma.phoneAsset.findUnique({ where: { id: phone.id } });

    console.log(`HTTP status on mid-tx failure: ${failRes.status} (expected 500)`);
    console.log(`Error response body: ${JSON.stringify(failRes.body)}`);
    console.log(
      `Phone custodyStatus before=${phoneBeforeFail.custodyStatus}, after=${phoneAfterFail.custodyStatus} (expected AVAILABLE)`
    );
    console.log(
      `Card CustodyTransaction count before=${txCountBeforeFail}, after=${txCountAfterFail} (expected unchanged)`
    );
    console.log(
      `Phone ReturnDeadline count before=${deadlineCountBeforeFail}, after=${deadlineCountAfterFail} (expected unchanged)`
    );

    if (
      failRes.status !== 500 ||
      failRes.body.success !== false ||
      failRes.body.message !== "Please tap again" ||
      phoneAfterFail.custodyStatus !== "AVAILABLE" ||
      txCountAfterFail !== txCountBeforeFail ||
      deadlineCountAfterFail !== deadlineCountBeforeFail
    ) {
      throw new Error(`Test (c) failed! Response: ${JSON.stringify(failRes)}`);
    }

    console.log("\nALL RESOLVE ATOMICITY & CONCURRENCY TESTS PASSED.");
  } finally {
    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
    await stopProcess(nextProc);
    try {
      await fetch(`http://127.0.0.1:${PG_CONTROL_PORT}/shutdown`, { method: "POST" });
    } catch {
      // ignore
    }
    await sleep(800);
    await stopProcess(dbProc);
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
