import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  getBackupDir,
  getOrCreateDeploymentId,
  listBackupFilesNewestFirst,
  verifyBackupFile,
} from "./backup-db.mjs";
import { createNotification } from "../src/lib/notifications/core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");

const VALID_RESTORE_REASONS = new Set(["missing", "corrupt", "schema"]);

function parseReasonFlag(argv) {
  const arg = argv.find((a) => a.startsWith("--reason="));
  if (!arg) return null;
  return arg.slice("--reason=".length).trim().toLowerCase() || null;
}

async function recordAutoRestoreAuditAndNotification(
  prisma,
  { backupFileName, backupTimestamp, healReason, deploymentId }
) {
  const restoredAt = new Date().toISOString();

  // 1. Write AuditLog entry "DB_AUTO_RESTORED" (backup file name + timestamp)
  const systemAdminUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: {
        some: {
          role: { code: "SYSTEM_ADMIN" },
        },
      },
    },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  });

  const primaryAdmin = systemAdminUsers[0] || null;

  const auditEntry = await prisma.auditLog.create({
    data: {
      userId: primaryAdmin?.id || null,
      userEmail: primaryAdmin?.email || "system@company.local",
      userRole: "SYSTEM_ADMIN",
      action: "DB_AUTO_RESTORED",
      entityType: "DATABASE",
      entityId: backupFileName,
      changes: JSON.stringify({
        backupFileName,
        backupTimestamp,
        restoredAt,
        healReason,
        deploymentId,
        reason: `Automatic recovery after database data loss (--reason=${healReason})`,
      }),
    },
  });
  console.log(
    `[Auto-Heal] ✓ Recorded AuditLog entry DB_AUTO_RESTORED (id=${auditEntry.id}, file=${backupFileName}, backupTimestamp=${backupTimestamp}).`
  );

  // 2. Create notification(s) for SYSTEM_ADMIN users via src/lib/notifications
  const title = `Database Auto-Restored from Backup (${backupFileName})`;
  const message = `The database was automatically restored at ${restoredAt} from backup "${backupFileName}" (snapshot timestamp: ${backupTimestamp}, trigger: ${healReason}) following an unclean shutdown or storage loss. Any transactions after ${backupTimestamp} may have been lost.`;

  if (systemAdminUsers.length > 0) {
    for (const admin of systemAdminUsers) {
      await createNotification(
        {
          recipientUserId: admin.id,
          recipientRoleCode: "SYSTEM_ADMIN",
          title,
          message,
          type: "URGENT",
          severity: "CRITICAL",
          linkUrl: "/admin/kiosks",
        },
        prisma
      );
    }
    console.log(
      `[Auto-Heal] ✓ Created SYSTEM_ADMIN notification for ${systemAdminUsers.length} admin user(s) (${systemAdminUsers.map((u) => u.email).join(", ")}).`
    );
  } else {
    await createNotification(
      {
        recipientUserId: null,
        recipientRoleCode: "SYSTEM_ADMIN",
        title,
        message,
        type: "URGENT",
        severity: "CRITICAL",
        linkUrl: "/admin/kiosks",
      },
      prisma
    );
    console.log(`[Auto-Heal] ✓ Created role-level SYSTEM_ADMIN notification.`);
  }
}

async function main() {
  const healReason = parseReasonFlag(process.argv.slice(2));
  const shouldAttemptRestore = Boolean(healReason && VALID_RESTORE_REASONS.has(healReason));
  const pgDataDir = path.resolve(APP_ROOT, process.env.PG_DATA_DIR || "postgres_data");
  const activeBackupDir = getBackupDir();
  const currentDeploymentId = getOrCreateDeploymentId();

  console.log(
    `[Auto-Heal] Verifying database connectivity and schema (reason=${healReason || "none"}, deploymentId=${currentDeploymentId})...`
  );

  try {
    // 1. Sync Prisma schema using bundled node.exe + local prisma CLI if present
    console.log("[Auto-Heal] Pushing Prisma schema to PostgreSQL...");
    const localPrismaCli = path.join(APP_ROOT, "node_modules", "prisma", "build", "index.js");
    const schemaPath = path.join(APP_ROOT, "prisma", "schema.prisma");
    const prismaCmd = fs.existsSync(localPrismaCli)
      ? `"${process.execPath}" "${localPrismaCli}" db push --skip-generate --schema="${schemaPath}"`
      : "npx prisma db push --skip-generate";
    execSync(prismaCmd, {
      stdio: "inherit",
      cwd: APP_ROOT,
      env: process.env,
    });
    console.log("[Auto-Heal] Schema in sync.");

    const prisma = new PrismaClient();
    let restoredSnapshot = null;

    try {
      // 2. Decide whether to restore based ONLY on the --reason=missing|corrupt|schema flag
      if (!shouldAttemptRestore) {
        console.log(
          `[Auto-Heal] No data-loss restore reason flag provided (--reason=${healReason || "none"}). Skipping backup restore.`
        );
      } else {
        console.log(
          `[Auto-Heal] Data-loss recovery triggered (--reason=${healReason}). Searching for valid backups matching DEPLOYMENT_ID=${currentDeploymentId}...`
        );

        const candidateDirs = [activeBackupDir];
        const mirrorDir = (process.env.BACKUP_MIRROR_DIR || "").trim();
        if (mirrorDir && fs.existsSync(mirrorDir)) {
          candidateDirs.push(mirrorDir);
        }

        let totalCandidateFiles = 0;
        for (const dir of candidateDirs) {
          if (fs.existsSync(dir)) {
            totalCandidateFiles += listBackupFilesNewestFirst(dir).length;
          }
        }

        if (totalCandidateFiles === 0) {
          console.log(
            `[Auto-Heal] Fresh install detected (reason=${healReason} and no backups exist in ${activeBackupDir}). Initializing empty database (seeding roles and kiosk account only)...`
          );
        } else {
          const restoreScript = path.join(__dirname, "restore-db.mjs");
          for (const dir of candidateDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = listBackupFilesNewestFirst(dir);
            for (const fileName of files) {
              const filePath = path.join(dir, fileName);
              const verification = verifyBackupFile(filePath);
              if (!verification.valid) {
                console.warn(
                  `[Auto-Heal] ⚠ Skipping corrupt/invalid backup ${fileName} in ${dir}: ${verification.reason}. Falling back to next newest backup...`
                );
                continue;
              }

              const backupDeploymentId = verification.payload?.deploymentId || null;
              if (!backupDeploymentId || backupDeploymentId !== currentDeploymentId) {
                console.warn(
                  `[Auto-Heal] ⚠ Skipping backup ${fileName} in ${dir}: deploymentId mismatch (backup deploymentId=${backupDeploymentId || "<missing>"}, current DEPLOYMENT_ID=${currentDeploymentId}).`
                );
                continue;
              }

              console.log(
                `[Auto-Heal] ✓ SHA-256 and deploymentId (${backupDeploymentId}) verified for ${fileName} (${verification.hash}). Restoring snapshot from ${filePath}...`
              );
              try {
                execSync(`"${process.execPath}" "${restoreScript}" "${filePath}"`, {
                  stdio: "inherit",
                  cwd: APP_ROOT,
                  env: process.env,
                });
                const backupTimestamp =
                  verification.payload?.createdAt || fs.statSync(filePath).mtime.toISOString();
                restoredSnapshot = {
                  backupFileName: fileName,
                  backupTimestamp,
                  healReason,
                  deploymentId: currentDeploymentId,
                };
                break;
              } catch (restoreErr) {
                console.error(
                  `[Auto-Heal] ⚠ Restore failed for ${fileName} (${restoreErr.message}). Falling back to next newest backup...`
                );
              }
            }
            if (restoredSnapshot) break;
          }

          if (!restoredSnapshot) {
            console.log(
              `[Auto-Heal] No valid backup with matching deploymentId (${currentDeploymentId}) could be restored. Initializing empty database (seeding roles and kiosk account only)...`
            );
          }
        }
      }

      // 3. Ensure system roles, Kiosk account & reader binding
      const kioskSeedScript = path.join(__dirname, "seed-kiosk-account.mjs");
      if (fs.existsSync(kioskSeedScript)) {
        console.log("[Auto-Heal] Verifying system roles, Kiosk accounts, and NFC hardware bindings...");
        execSync(`"${process.execPath}" "${kioskSeedScript}"`, {
          stdio: "inherit",
          cwd: APP_ROOT,
          env: process.env,
        });
      }

      // 4. Write install marker postgres_data\.cpt_initialized containing the install time
      const installMarkerPath = path.join(pgDataDir, ".cpt_initialized");
      if (!fs.existsSync(installMarkerPath)) {
        const initializedAt = new Date().toISOString();
        fs.mkdirSync(pgDataDir, { recursive: true });
        fs.writeFileSync(installMarkerPath, `${initializedAt}\n`, "utf8");
        console.log(`[Auto-Heal] ✓ Wrote install marker ${installMarkerPath} (${initializedAt}).`);
      }

      // 5. Record DB_AUTO_RESTORED AuditLog + SYSTEM_ADMIN notification AFTER restore & seed
      if (restoredSnapshot) {
        await recordAutoRestoreAuditAndNotification(prisma, restoredSnapshot);
      }
    } finally {
      await prisma.$disconnect();
    }

    console.log("[Auto-Heal] Database schema and initialization check completed.");
  } catch (err) {
    console.error("[Auto-Heal] Error during auto-heal:", err.message);
    process.exit(1);
  }
}

main();
