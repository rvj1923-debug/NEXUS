# Role-Permission Matrix & Access Boundaries
**Company Phone Tracker — Enterprise Security Specification**

## 1. System Roles Overview

| Role Code | Role Name | Operational Scope & Clearance |
|---|---|---|
| `SYSTEM_ADMIN` | **System Administrator** | Full system administration, user provisioning, role assignments, NFC reader configurations, global parameters, and compliance audit log review. |
| `PHONE_CUSTODIAN` | **Phone Custodian** | Employee registration, phone hardware enrollment, NFC smart card issuance/replacement, physical check-out/return custody desk, and physical inventory audits. |
| `DEPT_SUPERVISOR` | **Department Supervisor** | Scoped departmental visibility over employees and assigned phones, real-time overdue return breach alerts, and exception approvals. |
| `IT_SUPPORT` | **IT Support** | Hardware inventory maintenance, recording damaged/defective devices, vendor repair lifecycle tracking, and equipment retirement. |
| `AUDITOR` | **Auditor** | Read-only compliance access to authorized historical transactions, employee rosters, fleet statuses, reports, and immutable audit logs. |

---

## 2. Server-Enforced Route Access Matrix

This matrix is enforced at the **server tier** via Next.js Edge Middleware (`src/middleware.ts`) and Server Component layouts. Client-side link hiding provides visual ergonomics, but direct URL navigation is guarded and denied with `307 Redirect` to `/unauthorized` or `403 Forbidden` API responses.

| Area / Route | `SYSTEM_ADMIN` | `PHONE_CUSTODIAN` | `DEPT_SUPERVISOR` | `IT_SUPPORT` | `AUDITOR` |
|---|:---:|:---:|:---:|:---:|:---:|
| `/dashboard` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/employees` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ⛔ DENY | ✅ ALLOW |
| `/nfc-cards` | ✅ ALLOW | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ✅ ALLOW |
| `/phones` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/assignments` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/kiosk` | ✅ ALLOW | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ⛔ DENY |
| `/custody/operations` | ✅ ALLOW | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ⛔ DENY |
| `/custody/active` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/overdue` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ⛔ DENY | ✅ ALLOW |
| `/incidents` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/reports` | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW |
| `/audit-logs` | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ⛔ DENY | ✅ ALLOW |
| `/users` | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ⛔ DENY | ⛔ DENY |
| `/settings` | ✅ ALLOW | ⛔ DENY | ⛔ DENY | ⛔ DENY | ⛔ DENY |

---

## 3. Granular Permission Mapping (24 Permissions)

| Permission Code | Module | Description | Admin | Custodian | Supervisor | IT Support | Auditor |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| `dashboard:view` | Dashboard | View operational metrics & panels | ✅ | ✅ | ✅ | ✅ | ✅ |
| `employees:view` | Employees | View employee directory & shifts | ✅ | ✅ | ✅ | ❌ | ✅ |
| `employees:manage` | Employees | Register, update, and deactivate employees | ✅ | ✅ | ❌ | ❌ | ❌ |
| `nfc:view` | NFC Cards | View enrolled NFC smart cards | ✅ | ✅ | ❌ | ❌ | ✅ |
| `nfc:manage` | NFC Cards | Enroll, bind, revoke, or re-issue NFC cards | ✅ | ✅ | ❌ | ❌ | ❌ |
| `phones:view` | Phones | View phone fleet inventory & specs | ✅ | ✅ | ✅ | ✅ | ✅ |
| `phones:manage` | Phones | Add, edit specs, update phone hardware state | ✅ | ✅ | ❌ | ✅ | ❌ |
| `assignments:view` | Assignments | View designated phone assignments | ✅ | ✅ | ✅ | ✅ | ✅ |
| `assignments:manage` | Assignments | Assign/reassign phones to employees | ✅ | ✅ | ❌ | ❌ | ❌ |
| `kiosk:access` | Kiosk | Launch & operate NFC attendance turnstile kiosk | ✅ | ✅ | ❌ | ❌ | ❌ |
| `custody:issue` | Custody | Perform device checkout/issuance transactions | ✅ | ✅ | ❌ | ❌ | ❌ |
| `custody:surrender`| Custody | Perform device return/surrender transactions | ✅ | ✅ | ❌ | ❌ | ❌ |
| `custody:view` | Custody | View active in-possession custody records | ✅ | ✅ | ✅ | ✅ | ✅ |
| `overdue:view` | Overdue | View overdue cases & shift return breaches | ✅ | ✅ | ✅ | ❌ | ✅ |
| `overdue:manage` | Overdue | Escalate & resolve overdue cases | ✅ | ❌ | ✅ | ❌ | ❌ |
| `incidents:view` | Incidents | View damage & loss incident cases | ✅ | ✅ | ✅ | ✅ | ✅ |
| `incidents:manage` | Incidents | Create, update, resolve damage cases | ✅ | ✅ | ❌ | ✅ | ❌ |
| `reports:view` | Reports | View report catalog & preview records | ✅ | ✅ | ✅ | ✅ | ✅ |
| `reports:export` | Reports | Generate & download CSV/PDF data exports | ✅ | ✅ | ❌ | ❌ | ✅ |
| `audit:view` | Audit | Inspect immutable audit trails | ✅ | ❌ | ❌ | ❌ | ✅ |
| `users:view` | Users | View user accounts & assigned roles | ✅ | ❌ | ❌ | ❌ | ❌ |
| `users:manage` | Users | Provision users & modify role assignments | ✅ | ❌ | ❌ | ❌ | ❌ |
| `settings:view` | Settings | View system settings & reader parameters | ✅ | ❌ | ❌ | ❌ | ❌ |
| `settings:manage` | Settings | Modify system settings & reader bindings | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 4. Test Verification Evidence

Live automated route probing confirmed 100% compliance against the live Next.js HTTP server at `http://localhost:5000`:

```
| Role            | /dashboard | /employees | /nfc-cards | /phones   | /kiosk     | /custody/operations | /audit-logs | /users     | /settings  |
|-----------------|------------|------------|------------|-----------|------------|---------------------|-------------|------------|------------|
| SYSTEM_ADMIN    | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ✅ 200 OK  | ✅ 200 OK           | ✅ 200 OK   | ✅ 200 OK  | ✅ 200 OK  |
| PHONE_CUSTODIAN | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ✅ 200 OK  | ✅ 200 OK           | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| DEPT_SUPERVISOR | ✅ 200 OK  | ✅ 200 OK  | ⛔ 403/Redir| ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| IT_SUPPORT      | ✅ 200 OK  | ⛔ 403/Redir| ⛔ 403/Redir| ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| AUDITOR         | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ✅ 200 OK   | ⛔ 403/Redir| ⛔ 403/Redir|
```
