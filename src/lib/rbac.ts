import type { SessionUser } from "./session-config";

export type RoleCode =
  | "SYSTEM_ADMIN"
  | "HR_ADMIN"
  | "PHONE_CUSTODIAN"
  | "DEPT_SUPERVISOR"
  | "IT_SUPPORT"
  | "AUDITOR"
  | "KIOSK";

export interface RoleMetadata {
  code: RoleCode;
  name: string;
  description: string;
  badgeColor: string;
}

export const ROLES: Record<RoleCode, RoleMetadata> = {
  SYSTEM_ADMIN: {
    code: "SYSTEM_ADMIN",
    name: "System Administrator",
    description: "Full system administration, user and role management, reader settings, configurations, and audit review",
    badgeColor: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  HR_ADMIN: {
    code: "HR_ADMIN",
    name: "HR Department",
    description: "Dedicated HR Department account for Overdue Monitoring and Incident Report management",
    badgeColor: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800",
  },
  PHONE_CUSTODIAN: {
    code: "PHONE_CUSTODIAN",
    name: "Phone Custodian",
    description: "Employee and phone registration, phone issuance and surrender, NFC card enrollment, physical inventory verification",
    badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  DEPT_SUPERVISOR: {
    code: "DEPT_SUPERVISOR",
    name: "Department Supervisor",
    description: "View employees and assigned phones within permitted departments, receive overdue alerts, review exceptions",
    badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  IT_SUPPORT: {
    code: "IT_SUPPORT",
    name: "IT Support",
    description: "View and maintain phone inventory, record damaged devices, manage repair-related phone status",
    badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  AUDITOR: {
    code: "AUDITOR",
    name: "Auditor",
    description: "Read-only access to authorized records, history, audit logs, and reports",
    badgeColor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  },
  KIOSK: {
    code: "KIOSK",
    name: "Kiosk Station Account",
    description: "Dedicated self-service turnstile account restricted solely to /kiosk and phone Time In / Time Out operations",
    badgeColor: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
  },
};

/**
 * Route protection mapping:
 * Array of allowed roles per route path prefix.
 */
export const ROUTE_ACCESS_RULES: { pathPrefix: string; allowedRoles: RoleCode[] }[] = [
  { pathPrefix: "/dashboard", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/employees", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "AUDITOR"] },
  { pathPrefix: "/nfc-cards", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "AUDITOR"] },
  { pathPrefix: "/phones", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/assignments", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/kiosk", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "KIOSK"] },
  { pathPrefix: "/custody/issue", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/custody/surrender", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/custody/operations", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/custody/active", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/custody", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/monitoring", allowedRoles: ["SYSTEM_ADMIN", "HR_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/overdue", allowedRoles: ["SYSTEM_ADMIN", "HR_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "AUDITOR"] },
  { pathPrefix: "/hr-admin", allowedRoles: ["SYSTEM_ADMIN", "HR_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "AUDITOR"] },
  { pathPrefix: "/notifications", allowedRoles: ["SYSTEM_ADMIN", "HR_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/incidents", allowedRoles: ["SYSTEM_ADMIN", "HR_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/reports", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN", "DEPT_SUPERVISOR", "IT_SUPPORT", "AUDITOR"] },
  { pathPrefix: "/audit-logs", allowedRoles: ["SYSTEM_ADMIN", "AUDITOR"] },
  { pathPrefix: "/users", allowedRoles: ["SYSTEM_ADMIN"] },
  { pathPrefix: "/readers", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/admin/kiosks", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/kiosks", allowedRoles: ["SYSTEM_ADMIN", "PHONE_CUSTODIAN"] },
  { pathPrefix: "/settings", allowedRoles: ["SYSTEM_ADMIN"] },
];

export function canAccessPath(user: SessionUser | null, pathname: string): boolean {
  if (!user) return false;

  // SYSTEM_ADMIN and HR_ADMIN have full access to HR & Overdue management
  if (user.roleCode === "SYSTEM_ADMIN") return true;

  // Normalize API route paths: e.g. /api/users -> /users, /api/custody/issue -> /custody/issue
  const normalizedPath = pathname.startsWith("/api/") ? pathname.slice(4) : pathname;

  // KIOSK role is strictly restricted to /kiosk and /api/kiosk
  if (user.roleCode === "KIOSK") {
    if (pathname === "/api/auth/logout" || pathname === "/api/auth/me") return true;
    return (
      normalizedPath === "/kiosk" ||
      normalizedPath.startsWith("/kiosk/") ||
      normalizedPath === "kiosk" ||
      normalizedPath.startsWith("kiosk/") ||
      normalizedPath.startsWith("readers") ||
      normalizedPath === "health"
    );
  }

  // Find most specific rule
  const matchedRule = ROUTE_ACCESS_RULES
    .filter((rule) => normalizedPath === rule.pathPrefix || normalizedPath.startsWith(rule.pathPrefix + "/"))
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];

  if (!matchedRule) {
    // Default open to authenticated users for unspecified internal routes
    return true;
  }

  return matchedRule.allowedRoles.includes(user.roleCode);
}

export function hasPermission(user: SessionUser | null, permissionCode: string): boolean {
  if (!user) return false;
  if (user.roleCode === "SYSTEM_ADMIN") return true;
  return user.permissions.includes(permissionCode);
}
