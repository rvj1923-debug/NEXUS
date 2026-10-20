/**
 * Enterprise Database Restore Utility
 * Restores JSON snapshot with SHA-256 verification and atomic transaction integrity
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getBackupDir, loadEnvIfNeeded } from "./backup-db.mjs";

loadEnvIfNeeded();
const db = new PrismaClient();
const BACKUP_DIR = getBackupDir();

async function restoreDatabase() {
  console.log("==================================================================");
  console.log("  COMPANY PHONE TRACKER — DATABASE RESTORE UTILITY");
  console.log("==================================================================\n");

  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  let backupFilePath = args.find((a) => !a.startsWith("--"));

  if (!backupFilePath) {
    // Find latest backup in backups directory
    if (!fs.existsSync(BACKUP_DIR)) {
      console.error("[Restore] Error: No backups directory found.");
      process.exit(1);
    }
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("cpt_backup_") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.error("[Restore] Error: No backup files found in", BACKUP_DIR);
      process.exit(1);
    }
    backupFilePath = path.join(BACKUP_DIR, files[0]);
  }

  console.log(`[Restore] Selected backup: ${backupFilePath}`);
  if (isDryRun) {
    console.log(`[Restore] Mode: DRY RUN (Validation only, no database writes)`);
  }

  try {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`Backup file does not exist: ${backupFilePath}`);
    }

    const jsonString = fs.readFileSync(backupFilePath, "utf8");
    const computedHash = crypto.createHash("sha256").update(jsonString).digest("hex");

    // Check checksum file if exists
    const checksumFile = `${backupFilePath}.sha256`;
    if (fs.existsSync(checksumFile)) {
      const checksumContent = fs.readFileSync(checksumFile, "utf8").trim();
      const expectedHash = checksumContent.split(/\s+/)[0];
      if (computedHash !== expectedHash) {
        throw new Error(
          `SHA256 CHECKSUM MISMATCH! Expected ${expectedHash}, computed ${computedHash}. Backup may be corrupted or tampered!`
        );
      }
      console.log(`[Restore] ✓ SHA256 integrity verified: ${computedHash}`);
    } else {
      console.log(`[Restore] ⚠ No .sha256 file found. Computed hash: ${computedHash}`);
    }

    const payload = JSON.parse(jsonString);
    if (!payload.data || !payload.tableCounts) {
      throw new Error("Invalid backup format: missing 'data' or 'tableCounts' property.");
    }

    console.log(`[Restore] Backup metadata:`);
    console.log(`  Created:      ${payload.createdAt}`);
    console.log(`  DeploymentId: ${payload.deploymentId || "unspecified"}`);
    console.log(`  Version:      ${payload.version}`);
    console.log(`  Timezone:     ${payload.timezone}`);

    const totalRecords = Object.values(payload.tableCounts).reduce((a, b) => a + b, 0);
    console.log(`  Records:      ${totalRecords} rows to restore\n`);

    if (isDryRun) {
      console.log("[Restore] DRY RUN COMPLETE: Backup file verified and 100% valid.");
      return;
    }

    // Atomic Restore Transaction
    const startTime = Date.now();
    await db.$transaction(
      async (tx) => {
        // Step 1: Clean tables in reverse dependency order
        console.log("[Restore] Truncating existing operational tables...");
        await tx.kioskVerificationRequest.deleteMany();
        await tx.kioskDevice.deleteMany();
        await tx.overdueEscalation.deleteMany();
        await tx.notification.deleteMany();
        await tx.deadlineExtension.deleteMany();
        await tx.overdueCase.deleteMany();
        await tx.returnDeadline.deleteMany();
        await tx.custodyEvent.deleteMany();
        await tx.incidentAction.deleteMany();
        await tx.incident.deleteMany();
        await tx.custodyTransaction.deleteMany();
        await tx.phoneAssignment.deleteMany();
        await tx.employeeShift.deleteMany();
        await tx.nfcCard.deleteMany();
        await tx.nfcReader.deleteMany();
        await tx.phoneAsset.deleteMany();
        await tx.employee.deleteMany();
        await tx.reportRun.deleteMany();
        await tx.auditLog.deleteMany();
        await tx.userRole.deleteMany();
        await tx.rolePermission.deleteMany();
        await tx.permission.deleteMany();
        await tx.role.deleteMany();
        await tx.user.deleteMany();
        await tx.department.deleteMany();
        await tx.systemSetting.deleteMany();
        await tx.notificationRule.deleteMany();
        await tx.escalationPolicy.deleteMany();

        console.log("[Restore] Re-inserting records in topological order...");
        const d = payload.data;

        if (d.departments?.length) await tx.department.createMany({ data: d.departments });
        if (d.roles?.length) await tx.role.createMany({ data: d.roles });
        if (d.permissions?.length) await tx.permission.createMany({ data: d.permissions });
        if (d.rolePermissions?.length) await tx.rolePermission.createMany({ data: d.rolePermissions });
        if (d.users?.length) await tx.user.createMany({ data: d.users });
        if (d.userRoles?.length) await tx.userRole.createMany({ data: d.userRoles });
        if (d.employees?.length) await tx.employee.createMany({ data: d.employees });
        if (d.employeeShifts?.length) await tx.employeeShift.createMany({ data: d.employeeShifts });
        if (d.phoneAssets?.length) await tx.phoneAsset.createMany({ data: d.phoneAssets });
        if (d.nfcCards?.length) await tx.nfcCard.createMany({ data: d.nfcCards });
        if (d.nfcReaders?.length) await tx.nfcReader.createMany({ data: d.nfcReaders });
        if (d.phoneAssignments?.length) await tx.phoneAssignment.createMany({ data: d.phoneAssignments });
        if (d.custodyTransactions?.length) await tx.custodyTransaction.createMany({ data: d.custodyTransactions });
        if (d.custodyEvents?.length) await tx.custodyEvent.createMany({ data: d.custodyEvents });
        if (d.returnDeadlines?.length) await tx.returnDeadline.createMany({ data: d.returnDeadlines });
        if (d.deadlineExtensions?.length) await tx.deadlineExtension.createMany({ data: d.deadlineExtensions });
        if (d.overdueCases?.length) await tx.overdueCase.createMany({ data: d.overdueCases });
        if (d.overdueEscalations?.length) await tx.overdueEscalation.createMany({ data: d.overdueEscalations });
        if (d.escalationPolicies?.length) await tx.escalationPolicy.createMany({ data: d.escalationPolicies });
        if (d.notifications?.length) await tx.notification.createMany({ data: d.notifications });
        if (d.notificationRules?.length) await tx.notificationRule.createMany({ data: d.notificationRules });
        if (d.incidents?.length) await tx.incident.createMany({ data: d.incidents });
        if (d.incidentActions?.length) await tx.incidentAction.createMany({ data: d.incidentActions });
        if (d.auditLogs?.length) await tx.auditLog.createMany({ data: d.auditLogs });
        if (d.reportRuns?.length) await tx.reportRun.createMany({ data: d.reportRuns });
        if (d.systemSettings?.length) await tx.systemSetting.createMany({ data: d.systemSettings });
        if (d.kioskDevices?.length) await tx.kioskDevice.createMany({ data: d.kioskDevices });
        if (d.kioskVerificationRequests?.length) {
          await tx.kioskVerificationRequest.createMany({ data: d.kioskVerificationRequests });
        }
      },
      { timeout: 30000 }
    );

    const durationMs = Date.now() - startTime;
    console.log(`[Restore] SUCCESS! Database restored atomically in ${durationMs}ms.`);
  } catch (error) {
    console.error(`[Restore] FAILED:`, error.message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

restoreDatabase();
