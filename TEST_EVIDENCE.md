# Test Evidence Report — Phase 1 Acceptance
**Company Phone Tracker — Automated Verification & Audit Trail**

**Test Execution Date:** 2026-10-12  
**Target Environment:** Windows x64 • Node.js v24.20.0 • PostgreSQL on `127.0.0.1:5432`  
**Application Endpoint:** `http://localhost:5000`  

---

## 1. Automated Test Suite Execution Log

Execution of `node scripts/test-phase1.mjs`:

```text
===============================================================
   COMPANY PHONE TRACKER - PHASE 1 AUTOMATED TEST SUITE        
===============================================================

=== TEST SUITE 1: PostgreSQL Database & Normalized Schema ===
  ✓ PASS: System Roles Seeded (Expected 5 roles, got 5)
  ✓ PASS: Granular Permissions Seeded (Expected >=24, got 24)
  ✓ PASS: Role-Permission Matrix populated (70 mappings found)
  ✓ PASS: Role Test Accounts Provisioned (6 users found)
  ✓ PASS: Departments Configured (4 departments found)
  ✓ PASS: Hardware NFC Readers Configured (3 readers found)
  ✓ PASS: Default System Settings Seeded (6 settings found)
  ✓ PASS: All 22 Normalized Table Models Active in Prisma (23 models verified)

=== TEST SUITE 2: Authentication API & Brute-Force Rate Limiting ===
  ✓ PASS: Valid Admin Authentication (Status: 200, Role: SYSTEM_ADMIN)
  ✓ PASS: Session Cookie Issued (cpt_session HttpOnly cookie received)
  ✓ PASS: Invalid Password Rejected with 401 (Remaining attempts: 4)
  ✓ PASS: Auditor Authentication (Role: AUDITOR)
  ✓ PASS: Logout Endpoint Succeeded (Session cookie cleared)

=== TEST SUITE 3: Server-Side RBAC & Route Access Boundaries ===
  ✓ PASS: Unauthenticated /dashboard Redirected (Location: /login?next=%2Fdashboard)
  ✓ PASS: Admin Permitted to /settings (Status: 200)
  ✓ PASS: Auditor Denied Access to /settings (Redirected to: /unauthorized?from=%2Fsettings)
  ✓ PASS: Auditor Permitted to /audit-logs (Status: 200)

=== TEST SUITE 4: Security & Compliance Audit Log Persistence ===
  ✓ PASS: Audit Logs Persisted to Database (5 recent log entries found)
  ✓ PASS: Authentication Audit Events Recorded (Latest action: AUTH_LOGIN)

===============================================================
TEST SUMMARY: 19 / 19 assertions passed (100%)
===============================================================

>>> ALL PHASE 1 ACCEPTANCE CRITERIA SATISFIED <<<
```

---

## 2. Server-Enforced RBAC Route Boundary Probe Evidence

Automated probing of live routes under each authenticated user session:

```text
| Role            | /dashboard | /employees | /nfc-cards | /phones   | /kiosk     | /custody/operations | /audit-logs | /users     | /settings  |
|-----------------|------------|------------|------------|-----------|------------|---------------------|-------------|------------|------------|
| SYSTEM_ADMIN    | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ✅ 200 OK  | ✅ 200 OK           | ✅ 200 OK   | ✅ 200 OK  | ✅ 200 OK  |
| PHONE_CUSTODIAN | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ✅ 200 OK  | ✅ 200 OK           | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| DEPT_SUPERVISOR | ✅ 200 OK  | ✅ 200 OK  | ⛔ 403/Redir| ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| IT_SUPPORT      | ✅ 200 OK  | ⛔ 403/Redir| ⛔ 403/Redir| ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ⛔ 403/Redir| ⛔ 403/Redir| ⛔ 403/Redir|
| AUDITOR         | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK  | ✅ 200 OK | ⛔ 403/Redir| ⛔ 403/Redir        | ✅ 200 OK   | ⛔ 403/Redir| ⛔ 403/Redir|
```

All non-permitted routes return HTTP 307 redirecting to `/unauthorized?from=<route>` or HTTP 403 for API endpoints.

---

## 3. Production Build & TypeScript Type-Check Evidence

Execution of `npx next build`:

```text
   ▲ Next.js 15.5.27
   - Environments: .env

   Creating an optimized production build ...
 ✓ Compiled successfully in 4.8s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (10/10)
   Finalizing page optimization ...
   Collecting build traces ...

Route (app)                                 Size  First Load JS
┌ ○ /_not-found                            992 B         104 kB
├ ƒ /api/auth/login                        161 B         103 kB
├ ƒ /api/auth/logout                       161 B         103 kB
├ ƒ /api/auth/me                           161 B         103 kB
├ ƒ /assignments                           161 B         103 kB
├ ƒ /audit-logs                            161 B         103 kB
├ ƒ /custody                               161 B         103 kB
├ ƒ /custody/active                        161 B         103 kB
├ ƒ /custody/operations                    161 B         103 kB
├ ƒ /dashboard                             165 B         106 kB
├ ƒ /employees                             161 B         103 kB
├ ƒ /incidents                             161 B         103 kB
├ ƒ /kiosk                               2.84 kB         106 kB
├ ○ /login                               3.51 kB         106 kB
├ ƒ /nfc-cards                             161 B         103 kB
├ ƒ /overdue                               161 B         103 kB
├ ƒ /phones                                161 B         103 kB
├ ƒ /reports                               161 B         103 kB
├ ƒ /settings                              161 B         103 kB
├ ƒ /unauthorized                          165 B         106 kB
└ ƒ /users                                 161 B         103 kB
+ First Load JS shared by all             103 kB
  ├ chunks/255-ce8c7c75002f810b.js       46.5 kB
  ├ chunks/4bd1b696-c023c6e3521b1417.js  54.2 kB
  └ other shared chunks (total)          1.99 kB

ƒ Middleware                             40.1 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Exit code: `0` (Zero compilation, lint, or type errors).

---

## 4. Administrator Provisioning Evidence

Execution of `node scripts/create-admin.mjs`:

```text
=================================================
   Company Phone Tracker - Administrator Provisioning
=================================================

Provisioning administrator account for: rootadmin@company.com...

SUCCESS: Administrator account 'rootadmin@company.com' created/updated successfully.
Role assigned: SYSTEM_ADMIN
Audit log recorded.
```
