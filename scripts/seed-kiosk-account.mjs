import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEnvIfNeeded } from "./backup-db.mjs";

loadEnvIfNeeded();

const prisma = new PrismaClient();

function loadPhonixCredentials() {
  const defaults = {
    KIOSK: {
      accountName: "Kiosk Account",
      email: "phone-kiosk-01@company.local",
      password: "F4'Sq737",
      role: "KIOSK",
      redirectsTo: "/kiosk",
    },
    SYSTEM_ADMIN: {
      accountName: "Admin Account",
      email: "admin@company.com",
      password: "f0wU57G_",
      role: "SYSTEM_ADMIN",
      redirectsTo: "/dashboard",
    },
    HR_ADMIN: {
      accountName: "HR Department Account",
      email: "hr@company.com",
      password: "W6Jk65?J",
      role: "HR_ADMIN",
      redirectsTo: "/overdue",
    },
  };

  const candidatePaths = [
    process.env.PHONIX_CREDENTIALS_FILE,
    "C:\\Users\\itsup\\OneDrive\\Desktop\\ACCOUNT CREDENTIALS PHONIX.txt",
    path.join(os.homedir(), "OneDrive", "Desktop", "ACCOUNT CREDENTIALS PHONIX.txt"),
    path.join(os.homedir(), "Desktop", "ACCOUNT CREDENTIALS PHONIX.txt"),
    path.join(process.cwd(), "ACCOUNT CREDENTIALS PHONIX.txt"),
  ].filter(Boolean);

  for (const credPath of candidatePaths) {
    try {
      if (fs.existsSync(credPath)) {
        const raw = fs.readFileSync(credPath, "utf8");
        const blocks = raw.split(/\r?\n\s*\r?\n/);
        for (const block of blocks) {
          const lines = block
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length === 0) continue;
          const entry = {};
          for (const line of lines) {
            const idx = line.indexOf(":");
            if (idx === -1) continue;
            const k = line.slice(0, idx).trim().toLowerCase();
            const v = line.slice(idx + 1).trim();
            if (k === "account") entry.accountName = v;
            else if (k === "email") entry.email = v.toLowerCase();
            else if (k === "new password" || k === "password") entry.password = v;
            else if (k === "role") entry.role = v.toUpperCase();
            else if (k === "redirects to") entry.redirectsTo = v;
          }
          if (entry.role && entry.email && entry.password && defaults[entry.role]) {
            defaults[entry.role] = { ...defaults[entry.role], ...entry };
          }
        }
        console.log(`[Seed] Loaded PHONIX credentials from '${credPath}'.`);
        break;
      }
    } catch {
      // Fallback to built-in credentials from ACCOUNT CREDENTIALS PHONIX.txt
    }
  }

  return defaults;
}

async function main() {
  const KIOSK_CODE = (process.env.KIOSK_CODE || "PHONE-KIOSK-01").trim() || "PHONE-KIOSK-01";
  const phonixCreds = loadPhonixCredentials();
  console.log(`Seeding dedicated KIOSK, SYSTEM_ADMIN, and HR_ADMIN accounts (KIOSK_CODE=${KIOSK_CODE})...`);

  // 0. Ensure core system roles exist (for fresh empty database installs)
  const baseRoles = [
    {
      code: "SYSTEM_ADMIN",
      name: "System Administrator",
      description: "Full administrative access across all modules and settings",
      isSystem: true,
    },
    {
      code: "HR_ADMIN",
      name: "HR Department",
      description: "Dedicated HR Department account for Overdue Monitoring and Incident Report management",
      isSystem: true,
    },
    {
      code: "PHONE_CUSTODIAN",
      name: "Phone Custodian",
      description: "Employee and phone registration, phone issuance and surrender, NFC card enrollment, physical inventory verification",
      isSystem: true,
    },
    {
      code: "IT_CUSTODIAN",
      name: "IT Asset Custodian",
      description: "Manages phone inventory, assignments, and custody operations",
      isSystem: true,
    },
    {
      code: "SECURITY_OFFICER",
      name: "Security Officer",
      description: "Monitors turnstile custody, overdue escalations, and incidents",
      isSystem: true,
    },
    {
      code: "DEPT_SUPERVISOR",
      name: "Department Supervisor",
      description: "Reviews department custody, extensions, and overdue approvals",
      isSystem: true,
    },
    {
      code: "IT_SUPPORT",
      name: "IT Support",
      description: "View and maintain phone inventory, record damaged devices, manage repair-related phone status",
      isSystem: true,
    },
    {
      code: "AUDITOR",
      name: "Compliance Auditor",
      description: "Read-only access to reports, audit logs, and compliance history",
      isSystem: true,
    },
  ];

  const rolesByCode = {};
  for (const r of baseRoles) {
    rolesByCode[r.code] = await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: r,
    });
  }

  // Ensure standard permissions and role-permission mappings exist on fresh installs
  const permissionsData = [
    { code: "dashboard:view", module: "Dashboard", description: "View the main operational dashboard" },
    { code: "employees:view", module: "Employees", description: "View employee profiles and status" },
    { code: "employees:manage", module: "Employees", description: "Create, edit, and deactivate employee records" },
    { code: "nfc:view", module: "NFC Cards", description: "View enrolled NFC cards and binding status" },
    { code: "nfc:manage", module: "NFC Cards", description: "Issue, replace, revoke, and manage NFC cards" },
    { code: "phones:view", module: "Phones", description: "View inventory of company phones" },
    { code: "phones:manage", module: "Phones", description: "Add, update phone specifications and status" },
    { code: "assignments:view", module: "Assignments", description: "View standing employee phone assignments" },
    { code: "assignments:manage", module: "Assignments", description: "Assign or modify phone-to-employee designations" },
    { code: "kiosk:access", module: "Kiosk", description: "Access and operate the NFC attendance/custody kiosk" },
    { code: "custody:issue", module: "Custody", description: "Issue phones out to employees" },
    { code: "custody:surrender", module: "Custody", description: "Accept phone surrender / return" },
    { code: "custody:view", module: "Custody", description: "View active custody logs and status" },
    { code: "overdue:view", module: "Overdue", description: "View overdue phones and breach notices" },
    { code: "overdue:manage", module: "Overdue", description: "Escalate and resolve overdue cases" },
    { code: "incidents:view", module: "Incidents", description: "View damage and incident reports" },
    { code: "incidents:manage", module: "Incidents", description: "File, update, and close incident cases" },
    { code: "reports:view", module: "Reports", description: "View and execute data reports" },
    { code: "reports:export", module: "Reports", description: "Export report data to CSV/PDF" },
    { code: "audit:view", module: "Audit", description: "Inspect system audit logs and security trails" },
    { code: "users:view", module: "Users", description: "View application users and roles" },
    { code: "users:manage", module: "Users", description: "Create, edit, and assign roles to system users" },
    { code: "settings:view", module: "Settings", description: "View system configurations and reader health" },
    { code: "settings:manage", module: "Settings", description: "Modify system settings and reader configurations" },
  ];

  const permsByCode = {};
  for (const p of permissionsData) {
    permsByCode[p.code] = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
  }

  const rolePermissionMatrix = {
    SYSTEM_ADMIN: Object.keys(permsByCode),
    HR_ADMIN: ["overdue:view", "overdue:manage", "incidents:view", "incidents:manage"],
    PHONE_CUSTODIAN: [
      "dashboard:view", "employees:view", "employees:manage", "nfc:view", "nfc:manage",
      "phones:view", "phones:manage", "assignments:view", "assignments:manage", "kiosk:access",
      "custody:issue", "custody:surrender", "custody:view", "overdue:view", "incidents:view",
      "incidents:manage", "reports:view", "reports:export",
    ],
    DEPT_SUPERVISOR: [
      "dashboard:view", "employees:view", "phones:view", "assignments:view", "custody:view",
      "overdue:view", "overdue:manage", "incidents:view", "reports:view",
    ],
    IT_SUPPORT: [
      "dashboard:view", "phones:view", "phones:manage", "assignments:view", "custody:view",
      "incidents:view", "incidents:manage", "reports:view",
    ],
    AUDITOR: [
      "dashboard:view", "employees:view", "nfc:view", "phones:view", "assignments:view",
      "custody:view", "overdue:view", "incidents:view", "reports:view", "reports:export", "audit:view",
    ],
  };

  for (const [roleCode, permCodes] of Object.entries(rolePermissionMatrix)) {
    const roleObj = rolesByCode[roleCode];
    if (!roleObj) continue;
    for (const permCode of permCodes) {
      const permObj = permsByCode[permCode];
      if (!permObj) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleObj.id,
            permissionId: permObj.id,
          },
        },
        update: {},
        create: {
          roleId: roleObj.id,
          permissionId: permObj.id,
        },
      });
    }
  }

  // Ensure default system settings exist
  const defaultSettings = [
    { settingKey: "SYSTEM_NAME", settingValue: "Enterprise Company Phone Tracker", category: "GENERAL", description: "Display name of system", isPublic: true },
    { settingKey: "SESSION_TIMEOUT_MINUTES", settingValue: "480", category: "SECURITY", description: "Session duration in minutes before re-authentication", isPublic: false },
    { settingKey: "DEFAULT_GRACE_PERIOD_MINUTES", settingValue: "30", category: "CUSTODY", description: "Grace period beyond shift end before marking overdue", isPublic: false },
    { settingKey: "OVERDUE_ALERT_THRESHOLD_MINUTES", settingValue: "15", category: "NOTIFICATIONS", description: "Interval after grace period to notify supervisor", isPublic: false },
    { settingKey: "AUTO_ESCALATE_HOURS", settingValue: "4", category: "CUSTODY", description: "Hours before overdue case escalates to HR", isPublic: false },
    { settingKey: "OFFLINE_KIOSK_ENABLED", settingValue: "false", category: "KIOSK", description: "Allow kiosk caching when backend unreachable", isPublic: false },
  ];

  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { settingKey: s.settingKey },
      update: {},
      create: s,
    });
  }

  // 1. Upsert KIOSK Role
  const kioskRole = await prisma.role.upsert({
    where: { code: "KIOSK" },
    update: {
      name: "Kiosk Terminal Account",
      description: "Dedicated kiosk turnstile role restricted solely to /kiosk and phone Time In / Time Out operations",
      isSystem: true,
    },
    create: {
      code: "KIOSK",
      name: "Kiosk Terminal Account",
      description: "Dedicated kiosk turnstile role restricted solely to /kiosk and phone Time In / Time Out operations",
      isSystem: true,
    },
  });
  console.log(`[Seed] KIOSK role created/verified (ID: ${kioskRole.id})`);

  // 2. Upsert and link kiosk:access permission to KIOSK role
  const kioskPermission = await prisma.permission.upsert({
    where: { code: "kiosk:access" },
    update: {},
    create: {
      code: "kiosk:access",
      module: "kiosk",
      description: "Access self-service NFC kiosk terminal",
    },
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: kioskRole.id,
        permissionId: kioskPermission.id,
      },
    },
    update: {},
    create: {
      roleId: kioskRole.id,
      permissionId: kioskPermission.id,
    },
  });
  console.log("[Seed] Linked 'kiosk:access' permission to KIOSK role.");

  // 3. Provision Kiosk User Account(s) (phone-kiosk-01@company.local + KIOSK_CODE account)
  const kioskPasswordHash = await bcrypt.hash(phonixCreds.KIOSK.password, 10);
  const kioskEmails = Array.from(
    new Set([phonixCreds.KIOSK.email, `${KIOSK_CODE.toLowerCase()}@company.local`])
  );

  for (const kioskEmail of kioskEmails) {
    const labelCode = kioskEmail === phonixCreds.KIOSK.email ? "PHONE-KIOSK-01" : KIOSK_CODE;
    const kioskUser = await prisma.user.upsert({
      where: { email: kioskEmail },
      update: {
        fullName: `${labelCode} Terminal`,
        passwordHash: kioskPasswordHash,
        isActive: true,
      },
      create: {
        email: kioskEmail,
        fullName: `${labelCode} Terminal`,
        passwordHash: kioskPasswordHash,
        isActive: true,
      },
    });

    await prisma.userRole.deleteMany({
      where: {
        userId: kioskUser.id,
        roleId: { not: kioskRole.id },
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: kioskUser.id,
          roleId: kioskRole.id,
        },
      },
      update: {},
      create: {
        userId: kioskUser.id,
        roleId: kioskRole.id,
      },
    });
    console.log(`[Seed] Provisioned Kiosk User '${kioskEmail}' with KIOSK role.`);
  }

  // 3b. Provision System Admin Account (admin@company.com -> /dashboard)
  const adminPasswordHash = await bcrypt.hash(phonixCreds.SYSTEM_ADMIN.password, 10);
  const adminRole = rolesByCode["SYSTEM_ADMIN"];
  const adminUser = await prisma.user.upsert({
    where: { email: phonixCreds.SYSTEM_ADMIN.email },
    update: {
      fullName: "Global System Administrator",
      passwordHash: adminPasswordHash,
      isActive: true,
    },
    create: {
      email: phonixCreds.SYSTEM_ADMIN.email,
      fullName: "Global System Administrator",
      passwordHash: adminPasswordHash,
      isActive: true,
    },
  });
  await prisma.userRole.deleteMany({
    where: {
      userId: adminUser.id,
      roleId: { not: adminRole.id },
    },
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });
  console.log(`[Seed] Provisioned Admin User '${phonixCreds.SYSTEM_ADMIN.email}' with SYSTEM_ADMIN role.`);

  // 3c. Provision HR Department Account (hr@company.com -> /overdue)
  const hrPasswordHash = await bcrypt.hash(phonixCreds.HR_ADMIN.password, 10);
  const hrRole = rolesByCode["HR_ADMIN"];
  const hrUser = await prisma.user.upsert({
    where: { email: phonixCreds.HR_ADMIN.email },
    update: {
      fullName: "HR Department Admin",
      passwordHash: hrPasswordHash,
      isActive: true,
    },
    create: {
      email: phonixCreds.HR_ADMIN.email,
      fullName: "HR Department Admin",
      passwordHash: hrPasswordHash,
      isActive: true,
    },
  });
  await prisma.userRole.deleteMany({
    where: {
      userId: hrUser.id,
      roleId: { not: hrRole.id },
    },
  });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: hrUser.id,
        roleId: hrRole.id,
      },
    },
    update: {},
    create: {
      userId: hrUser.id,
      roleId: hrRole.id,
    },
  });
  console.log(`[Seed] Provisioned HR User '${phonixCreds.HR_ADMIN.email}' with HR_ADMIN role.`);

  // 4. Ensure KioskDevice entries for PHONE-KIOSK-01 and KIOSK_CODE
  const kioskDeviceCodes = Array.from(new Set(["PHONE-KIOSK-01", KIOSK_CODE]));
  for (const devCode of kioskDeviceCodes) {
    const sessionSecret = crypto.randomBytes(32).toString("hex");
    await prisma.kioskDevice.upsert({
      where: { kioskCode: devCode },
      update: {
        name: `${devCode} Station`,
        status: "ACTIVE",
        sessionSecret,
        readerIdentifier: "KIOSK-GATE-A",
        location: "Main Lobby Central Turnstile",
      },
      create: {
        kioskCode: devCode,
        name: `${devCode} Station`,
        location: "Main Lobby Central Turnstile",
        readerIdentifier: "KIOSK-GATE-A",
        status: "ACTIVE",
        displayLanguage: "EN",
        inactivityTimeoutSeconds: 30,
        sessionSecret,
      },
    });
    console.log(`[Seed] KioskDevice '${devCode}' configured.`);
  }

  // 5. Mount NFC Tags onto Company Phones (Phone-Mounted Tag Architecture)
  // Physical Card 0114156366 -> Mounted on Jane Doe's phone MOB-JANE-001
  const janePhone = await prisma.phoneAsset.findFirst({
    where: { assetTag: "MOB-JANE-001" },
  });

  if (janePhone) {
    await prisma.nfcCard.updateMany({
      where: {
        OR: [
          { cardUid: "0114156366" },
          { cardNumber: "SN-0114156366" },
        ],
      },
      data: {
        phoneAssetId: janePhone.id,
      },
    });
    console.log(`[Seed] Attached NFC Tag 0114156366 physically to Phone '${janePhone.assetTag}'`);
  }

  // Sample Tag 04:A2:8B:71:68 -> Mounted on Marcus Vance's phone ASSET-P4-001
  const p4Phone = await prisma.phoneAsset.findFirst({
    where: { assetTag: "ASSET-P4-001" },
  });

  if (p4Phone) {
    await prisma.nfcCard.upsert({
      where: { cardUid: "04:A2:8B:71:68" },
      update: {
        phoneAssetId: p4Phone.id,
        status: "ACTIVE",
      },
      create: {
        cardUid: "04:A2:8B:71:68",
        cardNumber: "SN-04A28B7168",
        identifierType: "MIFARE_CLASSIC",
        phoneAssetId: p4Phone.id,
        status: "ACTIVE",
      },
    });
    console.log(`[Seed] Attached NFC Tag 04:A2:8B:71:68 physically to Phone '${p4Phone.assetTag}'`);

    const marcus = await prisma.employee.findFirst({
      where: { firstName: "Marcus", lastName: "Vance" },
    });
    if (marcus) {
      await prisma.phoneAssignment.upsert({
        where: { id: "assign-p4-marcus-vance" },
        update: {
          phoneAssetId: p4Phone.id,
          employeeId: marcus.id,
          status: "ACTIVE",
        },
        create: {
          id: "assign-p4-marcus-vance",
          phoneAssetId: p4Phone.id,
          employeeId: marcus.id,
          status: "ACTIVE",
          assignmentType: "DEDICATED",
          startDate: new Date(),
        },
      });
      console.log(`[Seed] Assigned Phone '${p4Phone.assetTag}' to Employee '${marcus.firstName} ${marcus.lastName}'`);
    }
  }

  // 6. Deactivate and rotate passwords on any legacy demo accounts from older seeds
  const legacyDemoEmails = [
    "custodian@company.com",
    "supervisor@company.com",
    "itsupport@company.com",
    "auditor@company.com",
    "kiosk@company.com",
  ];
  const rotatedHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
  const demoCleanup = await prisma.user.updateMany({
    where: { email: { in: legacyDemoEmails } },
    data: {
      isActive: false,
      passwordHash: rotatedHash,
    },
  });
  if (demoCleanup.count > 0) {
    console.log(`[Seed] Deactivated and rotated credentials for ${demoCleanup.count} legacy demo account(s).`);
  }

  // 7. Ensure at least one active Maintenance NFC card exists for kiosk escape/maintenance
  const activeMaintCount = await prisma.nfcCard.count({
    where: { isMaintenanceCard: true, status: "ACTIVE" },
  });
  if (activeMaintCount === 0) {
    await prisma.nfcCard.upsert({
      where: { cardUid: "MAINT-MASTER-01" },
      update: {
        isMaintenanceCard: true,
        status: "ACTIVE",
        notes: "System Master Maintenance Card for Kiosk Administration",
      },
      create: {
        cardUid: "MAINT-MASTER-01",
        cardNumber: "SN-MAINT-001",
        identifierType: "MIFARE_CLASSIC",
        isMaintenanceCard: true,
        status: "ACTIVE",
        notes: "System Master Maintenance Card for Kiosk Administration",
      },
    });
    console.log("[Seed] Enrolled default active Maintenance NFC card (MAINT-MASTER-01).");
  }

  console.log("Seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
