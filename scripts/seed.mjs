import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

function checkProductionGuard() {
  const envMode = (process.env.NODE_ENV || "").trim().toLowerCase();
  if (envMode === "production") {
    console.error(
      "[Seed] FATAL: Refusing to run scripts/seed.mjs because NODE_ENV=production. Demo accounts with known passwords must never be created in production."
    );
    process.exit(1);
  }

  const candidateEnvPaths = [
    process.env.ENV_FILE_PATH ? path.resolve(process.cwd(), process.env.ENV_FILE_PATH) : null,
    path.join(process.cwd(), ".env"),
    "C:\\ProgramData\\PhoneTracker\\.env",
  ].filter(Boolean);

  for (const envPath of candidateEnvPaths) {
    if (envPath && fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf8");
        const match = content.match(/^\s*NODE_ENV\s*=\s*["']?([^"'\r\n#]+)["']?/m);
        if (match && match[1].trim().toLowerCase() === "production") {
          console.error(
            `[Seed] FATAL: Refusing to run scripts/seed.mjs because ${envPath} has NODE_ENV=production.`
          );
          process.exit(1);
        }
      } catch {
        // ignore read error
      }
      break;
    }
  }
}

checkProductionGuard();

const prisma = new PrismaClient();

async function main() {
  checkProductionGuard();
  console.log("[Seed] Starting enterprise database seed...");

  // 1. Roles
  const rolesData = [
    {
      code: "SYSTEM_ADMIN",
      name: "System Administrator",
      description: "Full system administration, user and role management, reader settings, configurations, and audit review",
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
      code: "DEPT_SUPERVISOR",
      name: "Department Supervisor",
      description: "View employees and assigned phones within permitted departments, receive overdue alerts, review exceptions",
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
      name: "Auditor",
      description: "Read-only access to authorized records, history, audit logs, and reports",
      isSystem: true,
    },
  ];

  const roles = {};
  for (const r of rolesData) {
    roles[r.code] = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
      create: r,
    });
  }
  console.log(`[Seed] Seeded ${Object.keys(roles).length} system roles.`);

  // 2. Permissions
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

  const permissions = {};
  for (const p of permissionsData) {
    permissions[p.code] = await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: p,
    });
  }
  console.log(`[Seed] Seeded ${Object.keys(permissions).length} permissions.`);

  // 3. Role-Permission mappings
  const rolePermissionMatrix = {
    SYSTEM_ADMIN: Object.keys(permissions), // All permissions
    HR_ADMIN: [
      "overdue:view",
      "overdue:manage",
      "incidents:view",
      "incidents:manage",
    ],
    PHONE_CUSTODIAN: [
      "dashboard:view",
      "employees:view",
      "employees:manage",
      "nfc:view",
      "nfc:manage",
      "phones:view",
      "phones:manage",
      "assignments:view",
      "assignments:manage",
      "kiosk:access",
      "custody:issue",
      "custody:surrender",
      "custody:view",
      "overdue:view",
      "incidents:view",
      "incidents:manage",
      "reports:view",
      "reports:export",
    ],
    DEPT_SUPERVISOR: [
      "dashboard:view",
      "employees:view",
      "phones:view",
      "assignments:view",
      "custody:view",
      "overdue:view",
      "overdue:manage",
      "incidents:view",
      "reports:view",
    ],
    IT_SUPPORT: [
      "dashboard:view",
      "phones:view",
      "phones:manage",
      "assignments:view",
      "custody:view",
      "incidents:view",
      "incidents:manage",
      "reports:view",
    ],
    AUDITOR: [
      "dashboard:view",
      "employees:view",
      "nfc:view",
      "phones:view",
      "assignments:view",
      "custody:view",
      "overdue:view",
      "incidents:view",
      "reports:view",
      "reports:export",
      "audit:view",
    ],
  };

  for (const [roleCode, permList] of Object.entries(rolePermissionMatrix)) {
    const roleId = roles[roleCode].id;
    for (const permCode of permList) {
      const permId = permissions[permCode].id;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId: permId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId: permId,
        },
      });
    }
  }
  console.log("[Seed] Role-permission matrix applied.");

  // 4. Departments
  const departmentsData = [
    { code: "OPS", name: "Operations & Logistics", description: "Warehouse operations, shipping, and logistics tracking" },
    { code: "ENG", name: "Engineering & Facilities", description: "Plant maintenance, hardware engineering, and infrastructure" },
    { code: "FLD", name: "Field Services", description: "On-site customer installations and inspections" },
    { code: "SEC", name: "Corporate Security", description: "Campus security, compliance, and asset protection" },
  ];

  const depts = {};
  for (const d of departmentsData) {
    depts[d.code] = await prisma.department.upsert({
      where: { code: d.code },
      update: { name: d.name, description: d.description },
      create: d,
    });
  }
  console.log(`[Seed] Seeded ${Object.keys(depts).length} departments.`);

  // 5. Users for all roles
  const hashedPasswordAdmin = await bcrypt.hash("f0wU57G_", 10);
  const hashedPasswordHr = await bcrypt.hash("W6Jk65?J", 10);
  const hashedPasswordCustodian = await bcrypt.hash("Custodian123!", 10);
  const hashedPasswordSupervisor = await bcrypt.hash("Supervisor123!", 10);
  const hashedPasswordIT = await bcrypt.hash("ITSupport123!", 10);
  const hashedPasswordAuditor = await bcrypt.hash("Auditor123!", 10);

  const usersData = [
    {
      email: "admin@company.com",
      fullName: "Global System Administrator",
      passwordHash: hashedPasswordAdmin,
      roleCode: "SYSTEM_ADMIN",
      deptCode: null,
    },
    {
      email: "hr@company.com",
      fullName: "HR Department Admin",
      passwordHash: hashedPasswordHr,
      roleCode: "HR_ADMIN",
      deptCode: null,
    },
    {
      email: "custodian@company.com",
      fullName: "Jane Rivera (Lead Custodian)",
      passwordHash: hashedPasswordCustodian,
      roleCode: "PHONE_CUSTODIAN",
      deptCode: "OPS",
    },
    {
      email: "supervisor@company.com",
      fullName: "Marcus Vance (Ops Supervisor)",
      passwordHash: hashedPasswordSupervisor,
      roleCode: "DEPT_SUPERVISOR",
      deptCode: "OPS",
    },
    {
      email: "itsupport@company.com",
      fullName: "David Chen (IT Asset Specialist)",
      passwordHash: hashedPasswordIT,
      roleCode: "IT_SUPPORT",
      deptCode: "ENG",
    },
    {
      email: "auditor@company.com",
      fullName: "Sarah Sterling (Compliance Auditor)",
      passwordHash: hashedPasswordAuditor,
      roleCode: "AUDITOR",
      deptCode: "SEC",
    },
  ];

  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.fullName,
        passwordHash: u.passwordHash,
        departmentId: u.deptCode ? depts[u.deptCode].id : null,
      },
      create: {
        email: u.email,
        fullName: u.fullName,
        passwordHash: u.passwordHash,
        departmentId: u.deptCode ? depts[u.deptCode].id : null,
      },
    });

    const roleId = roles[u.roleCode].id;
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId,
      },
    });
  }
  console.log(`[Seed] Seeded ${usersData.length} core role users.`);

  // 6. NFC Readers
  const readersData = [
    {
      readerIdentifier: "KIOSK-GATE-A",
      name: "Main Facility Gate A Kiosk",
      location: "Building 1 - Main Turnstiles",
      ipAddress: "192.168.10.45",
      status: "ONLINE",
      readerType: "KIOSK",
    },
    {
      readerIdentifier: "KIOSK-DOCK-B",
      name: "Loading Dock Kiosk",
      location: "Building 2 - Freight Bay",
      ipAddress: "192.168.10.46",
      status: "ONLINE",
      readerType: "KIOSK",
    },
    {
      readerIdentifier: "DESK-CUSTODY-01",
      name: "Asset Custody Desk Reader",
      location: "Security Office Rm 104",
      ipAddress: "192.168.10.88",
      status: "ONLINE",
      readerType: "DESKTOP",
    },
  ];

  for (const r of readersData) {
    await prisma.nfcReader.upsert({
      where: { readerIdentifier: r.readerIdentifier },
      update: { name: r.name, location: r.location, status: r.status, ipAddress: r.ipAddress },
      create: r,
    });
  }
  console.log(`[Seed] Seeded ${readersData.length} NFC readers.`);

  // 7. System Settings
  const defaultSettings = [
    { settingKey: "SYSTEM_NAME", settingValue: "NEXUS — NFC-Enabled Exchange & Usage System", category: "GENERAL", description: "Display name of system", isPublic: true },
    { settingKey: "SESSION_TIMEOUT_MINUTES", settingValue: "480", category: "SECURITY", description: "Session duration in minutes before re-authentication", isPublic: false },
    { settingKey: "DEFAULT_GRACE_PERIOD_MINUTES", settingValue: "30", category: "CUSTODY", description: "Grace period beyond shift end before marking overdue", isPublic: false },
    { settingKey: "OVERDUE_ALERT_THRESHOLD_MINUTES", settingValue: "15", category: "NOTIFICATIONS", description: "Interval after grace period to notify supervisor", isPublic: false },
    { settingKey: "AUTO_ESCALATE_HOURS", settingValue: "4", category: "CUSTODY", description: "Hours before overdue case escalates to HR", isPublic: false },
    { settingKey: "OFFLINE_KIOSK_ENABLED", settingValue: "false", category: "KIOSK", description: "Allow kiosk caching when backend unreachable", isPublic: false },
  ];

  for (const s of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { settingKey: s.settingKey },
      update: { settingValue: s.settingValue, description: s.description },
      create: s,
    });
  }
  console.log(`[Seed] Seeded ${defaultSettings.length} system settings.`);

  console.log("[Seed] Enterprise database seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("[Seed Error]", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
