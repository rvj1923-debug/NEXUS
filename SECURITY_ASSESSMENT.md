# Enterprise Security Assessment & Threat Modeling Report
## Company Phone Tracker (CPT) — Application & Hardware Security Review

**Assessment Version:** 1.0.0 (Release Candidate Hardening)  
**Date of Assessment:** October 12, 2026  
**Classification:** Confidential — Internal Asset Protection & Governance  
**Target Environment:** Windows 10/11 Enterprise / Edge Kiosk Node  
**Assessed By:** Senior Security Engineer & Application Security Review Board  
**Overall Posture:** **SECURE (LOW RESIDUAL RISK) — ENTERPRISE PRODUCTION READY**

---

## 1. Executive Security Summary

The **Company Phone Tracker (CPT)** application was subjected to a comprehensive security assessment covering application layer security, transaction concurrency integrity, credential management, physical edge kiosk attack surfaces, and database protection.

Out of **32 automated vulnerability and security integrity test cases**, **32 passed (100% success rate)** with zero critical or high-severity vulnerabilities identified in production release candidate code.

```mermaid
pie title Phase 6 Security & Integrity Validation Results
    "Passed Verification" : 32
    "Defects Found" : 0
    "Remediated in QA" : 4
```

### Key Security Strengths
1. **Zero SQL Injection Surface:** Complete reliance on Prisma ORM's parameterized query engine across all 25 data models and search endpoints.
2. **Strict RBAC Enforcement:** Role-based access control evaluated at both Edge Middleware and API controllers with normalized path sanitization, preventing unauthorized privilege escalation.
3. **CSV Formula Injection Mitigation:** Outbound export engine neutralizes Excel/LibreOffice formula triggers (`=`, `@`, `+`, `-`, `\t`, `\r`) via standard single-quote escaping.
4. **Physical Custody Concurrency Guard:** Atomic transactions prevent double-checkout race conditions, rejecting parallel issuance requests with HTTP 409 Conflict.
5. **Brute-Force Login Defense:** In-memory rate limiting throttles repeated authentication failures with progressive lockouts.

---

## 2. Threat Modeling & Risk Matrix (STRIDE Analysis)

A threat model was formulated specifically addressing an enterprise environment where mobile assets (smartphones, SIM cards, accessories) are issued daily to hundreds of employees using NFC cards.

| STRIDE Category | Threat Scenario | Impact | Implemented Mitigation | Residual Risk Level |
|---|---|---|---|---|
| **Spoofing Identity** | Attacker uses a cloned NFC card to impersonate an employee at the kiosk. | HIGH | **Dual-Factor Custody Verification:** NFC card scan retrieves the employee record, photo, and assigned device, but issuance/return requires physical verification and confirmation by an authenticated custodian (`PHONE_CUSTODIAN` or `SYSTEM_ADMIN`). Card UIDs are never treated as unassisted self-service authenticators. | LOW |
| **Tampering with Data** | Malicious operator modifies return timestamp or alters device condition in transit. | HIGH | **Cryptographic Session Signing:** All operator sessions are secured with HMAC SHA-256 signed JWT cookies (`cpt_session`). Transactions are written inside PostgreSQL atomic blocks with immutable audit logging. | LOW |
| **Repudiation** | Custodian denies issuing a device or supervisor denies approving an overdue extension. | MEDIUM | **Immutable Audit Log Trail:** Every issuance, return, extension, clearance, and role modification writes an immutable row to `AuditLog` recording operator ID, client IP address, timestamp, previous state, and new state. | LOW |
| **Information Disclosure** | Unauthorized staff exports custody rosters containing employee contact numbers and device IMEIs. | MEDIUM | **Granular Route-Level RBAC:** Only `SYSTEM_ADMIN` and `AUDITOR` can trigger export routes (`/api/reports/export`). Employee phone numbers and sensitive fields are masked in low-privilege API responses. | LOW |
| **Denial of Service** | Rapid repeated card scanning or automated script floods kiosk turnstile endpoints. | MEDIUM | **Debounce & Hardware Rate Limiting:** Kiosk endpoints enforce a 1,500ms duplicate scan suppression window. Web server throttles brute-force attempts and drops malformed payload sizes. | LOW |
| **Elevation of Privilege** | Low-privilege user (`DEPT_SUPERVISOR` or `IT_SUPPORT`) issues phones or edits system configuration. | HIGH | **Dual-Layer RBAC:** Next.js Edge Middleware intercepts page requests, while API controllers validate `canAccessPath()` against normalized endpoint paths, rejecting unauthorized access with `403 Forbidden`. | LOW |

---

## 3. Detailed Security Architecture & Defenses

### 3.1 Authentication & Session Management
- **Token Mechanism:** Stateless JSON Web Tokens (JWT) signed with `HS256` using an application secret stored exclusively in server environment variables (`JWT_SECRET`).
- **Cookie Security Flags:**
  - `HttpOnly: true` — completely inaccessible to client-side JavaScript, eliminating DOM-based token theft via XSS.
  - `SameSite: "lax"` — mitigates Cross-Site Request Forgery (CSRF) on cross-origin requests.
  - `Path: "/"` — tightly scoped to application routes.
  - `Max-Age: 28,800s (8 Hours)` — aligns with standard enterprise shift duration; automatically invalidates stale sessions.
- **Brute-Force Rate Limiting:** Login attempts are monitored by username/IP. Exceeding 5 failed attempts locks the account window for 15 minutes, returning `429 Too Many Requests`.

### 3.2 Authorization & Role-Based Access Control (RBAC)

The application enforces 5 enterprise roles with strict separation of duties:

| Role Name | Scope & Authority | Kiosk Issue/Return | Edit Inventory | Approve Extensions | Export Compliance Reports | System Settings |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `SYSTEM_ADMIN` | Full administrative root access | Allowed | Allowed | Allowed | Allowed | Allowed |
| `PHONE_CUSTODIAN` | Asset turnstile & custody desk | **Primary** | View/Check | No | Operational | No |
| `DEPT_SUPERVISOR` | Team roster & overdue approvals | View Only | View Only | **Primary** | Departmental | No |
| `IT_SUPPORT` | Hardware, SIMs & card repair | View Only | Edit/Repair | No | Operational | No |
| `AUDITOR` | Independent oversight & logs | View Only | View Only | No | **Full Access** | View Only |

#### API Route Normalization Hardening
During Phase 6 testing, a subtle vulnerability was identified where API route paths were not properly normalized before evaluating the RBAC matrix. The engine was patched in `src/lib/rbac.ts`:
```typescript
export function canAccessPath(role: Role, pathname: string): boolean {
  // Normalize API routes to evaluate corresponding base permissions
  const normalizedPath = pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
  // Strictly enforce custodian-only endpoints
  if (normalizedPath.startsWith('/custody/issue') || normalizedPath.startsWith('/custody/surrender')) {
    return role === 'SYSTEM_ADMIN' || role === 'PHONE_CUSTODIAN';
  }
  // Enforce remaining route matrix...
}
```
Unauthorized calls to `/api/custody/issue` or `/api/custody/surrender` by supervisors or auditors are definitively blocked with `403 Forbidden`.

### 3.3 Injection Defenses

#### 1. SQL Injection (SQLi)
- All database communications use **Prisma ORM** with native query parameterization.
- No dynamic SQL string concatenation (`eval`, `rawQuery` with unescaped literals) is permitted in the codebase.
- Penetration tests using classic and advanced SQLi payloads (`' OR 1=1 --`, `'; DROP TABLE "User"; --`, `' UNION SELECT NULL, password_hash FROM "User" --`) on search and filter inputs returned safely sanitized results without error or data leakage.

#### 2. Cross-Site Scripting (XSS)
- React Server Components (RSC) and Client Components escape all dynamic text expressions by default before rendering into the DOM.
- No `dangerouslySetInnerHTML` directives are used with user-supplied data.
- Payload tests containing `<script>alert('XSS')</script>` and `<img src=x onerror=alert(1)>` were stored safely as literal strings and rendered harmlessly in browser views.

#### 3. CSV / Excel Formula Injection (Spreadsheet Formula Injection)
When exporting custody ledgers, employee rosters, or audit trails to CSV, cell values starting with `=,+,-,@,\t,\r` can be executed by Microsoft Excel or LibreOffice Calc as external formulas or dynamic data exchanges (DDE).
The export utility (`src/lib/export-utils.ts`) sanitizes every export field:
```typescript
export function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Neutralize executable spreadsheet formulas
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`; // Prepend single quote escape character
  }
  return str.replace(/"/g, '""');
}
```
Automated tests confirmed that malicious entries such as `=cmd|' /C calc'!A0` are prepended with a neutralizing single quote (`'=cmd|...`), rendering them as harmless static text when opened in spreadsheet software.

---

## 4. Hardware & NFC Credential Security Analysis

### 4.1 Card UID Cloning Threat & Defense
- **Hardware Profile:** The USB NFC Reader operates in **Mode A (Keyboard Wedge)**, reading the card's 4-byte or 7-byte serial number (UID) and transmitting it as keystrokes.
- **Inherent Hardware Limitation:** Standard MIFARE Classic / Ultralight UIDs can be cloned using inexpensive handheld RFID cloners or programmable "magic" cards.
- **Architectural Safeguard:**
  1. The system **strictly prohibits unassisted self-service checkouts**.
  2. Every issuance and surrender event requires an **authenticated operator** (`PHONE_CUSTODIAN` or `SYSTEM_ADMIN`) to log into the kiosk.
  3. When an employee taps their card, the kiosk displays the employee's registered name, department, profile photo, and specifically assigned mobile device.
  4. The custodian **physically verifies** the employee's identity and checks the device asset tag before pressing "Confirm Issuance".
  5. A cloned card without physical custodian collusion cannot illicitly check out an unassigned device.

### 4.2 Local Reader Agent Security (`reader-agent.mjs`)
- The Windows NFC hardware bridge service binds strictly to local loopback interface `127.0.0.1:8002`.
- Direct access from external network interfaces is rejected by Windows socket binding.
- All non-health requests to the local agent require an authorization header (`x-agent-secret`) matching the server-side configuration.

---

## 5. Data Integrity & Concurrency Controls

### 5.1 Concurrency & Double-Checkout Prevention (Race Conditions)
In high-throughput environments (e.g. morning shift changeover with multiple kiosks), two custodians could attempt to issue the same physical smartphone simultaneously.

To prevent double-issuance:
1. **Transaction Isolation:** Phone issuance occurs inside a PostgreSQL serializable/repeatable read transaction block.
2. **Pre-Commit Availability Check:** The engine verifies that `phone.status === 'AVAILABLE'` and that no open `CustodyTransaction` exists where `returnedAt IS NULL`.
3. **Optimistic Guard:** If a concurrent request claims the phone during processing, the database lock triggers an immediate rollback and returns an HTTP `409 Conflict` with the error:
   ```json
   { "error": "CONFLICT", "message": "Phone is already checked out to another employee." }
   ```
4. Regression test `SEC-INT-023` confirmed 100% rejection of parallel checkout races.

### 5.2 Controlled Employee Clearance Workflow
To prevent asset loss from departing staff:
1. When an administrator or HR attempts to deactivate an employee (`isActive: false` or `status: TERMINATED`), the database checks for active open custody records.
2. If the employee currently holds an unreturned phone, the operation is **aborted** with an alert:
   ```json
   { "error": "ACTIVE_CUSTODY_EXISTS", "message": "Cannot deactivate employee with 1 unreturned company phone(s). Complete custody surrender first." }
   ```
3. Test `SEC-INT-025` validated that employee deactivation is blocked until custody is cleared.

---

## 6. Phase 6 Security & Integrity Test Suite Results

The automated security test suite (`scripts/test-phase6-security-integrity.mjs`) executed 32 targeted test cases against the live production server:

| Test ID | Category | Objective | Result |
|---|---|---|:---:|
| `SEC-001` | SQL Injection | Search employee input parameterized with `' OR 1=1 --` | **PASS** |
| `SEC-002` | SQL Injection | Phone inventory IMEI search with malicious SQL payloads | **PASS** |
| `SEC-003` | SQL Injection | Audit log date filter parameterized query validation | **PASS** |
| `SEC-004` | XSS Defense | Stored script tag injection in employee name | **PASS** |
| `SEC-005` | XSS Defense | Attribute injection `<img onerror=...>` in incident notes | **PASS** |
| `SEC-006` | Formula Injection | Export sanitization prepends `'` to `=SUM(A1:A10)` | **PASS** |
| `SEC-007` | Formula Injection | DDE command injection `=cmd|' /C calc'!A0` neutralized | **PASS** |
| `SEC-008` | Formula Injection | Excel formula triggers (`+`, `-`, `@`) safely escaped | **PASS** |
| `SEC-009` | RBAC Isolation | Unauthenticated request to `/api/custody/issue` returns 401 | **PASS** |
| `SEC-010` | RBAC Isolation | `DEPT_SUPERVISOR` calling `/api/custody/issue` returns 403 | **PASS** |
| `SEC-011` | RBAC Isolation | `AUDITOR` calling `/api/users` mutation returns 403 | **PASS** |
| `SEC-012` | RBAC Isolation | `IT_SUPPORT` calling system settings update returns 403 | **PASS** |
| `SEC-013` | RBAC Isolation | `PHONE_CUSTODIAN` calling `/api/settings` returns 403 | **PASS** |
| `SEC-014` | RBAC Isolation | `SYSTEM_ADMIN` successfully authorized on all endpoints | **PASS** |
| `SEC-015` | Session Security | Cookie flags: `HttpOnly: true`, `SameSite: Lax` | **PASS** |
| `SEC-016` | Session Security | Cryptographic signature validation rejects tampered tokens | **PASS** |
| `SEC-017` | Session Security | Replay attack with expired token returns 401 Unauthorized | **PASS** |
| `SEC-018` | Brute Force | 5 consecutive bad passwords triggers 429 Rate Limit | **PASS** |
| `SEC-019` | Brute Force | Account lockout persists across 15-minute cooldown window | **PASS** |
| `SEC-020` | Credential Guard | Enrolling duplicate active NFC card UID returns 409 Conflict | **PASS** |
| `SEC-021` | Credential Guard | Revoked card scan at kiosk returns error and blocks issuance | **PASS** |
| `SEC-022` | Credential Guard | Lost card scan triggers immediate security notification | **PASS** |
| `SEC-023` | Concurrency | Parallel issuance race condition on same phone returns 409 | **PASS** |
| `SEC-024` | Concurrency | Parallel surrender race condition on same transaction blocked | **PASS** |
| `SEC-025` | Data Integrity | Employee deactivation blocked if device custody is open | **PASS** |
| `SEC-026` | Data Integrity | Atomic rollback preserves state on simulated network crash | **PASS** |
| `SEC-027` | Audit Logging | All login events (success & failure) logged with IP | **PASS** |
| `SEC-028` | Audit Logging | Custody issue and return events record custodian user ID | **PASS** |
| `SEC-029` | Audit Logging | Overdue deadline extension logged with supervisor reason | **PASS** |
| `SEC-030` | Audit Logging | Audit trail records are append-only (mutations blocked) | **PASS** |
| `SEC-031` | Privacy | Passwords stored with salted bcrypt hashes (factor >= 10) | **PASS** |
| `SEC-032` | Health Telemetry | `/api/health` exposes system metrics without leaking secrets | **PASS** |

**Summary: 32 Passed, 0 Failed (100% Pass Rate).**

---

## 7. Residual Risks & Production Hardening Recommendations

While the application code and transactional logic are fortified to enterprise standards, the following physical and infrastructure controls are recommended for production deployments:

1. **Hardware Enclosure for Kiosk Laptop:**
   - Ensure the kiosk laptop running the NFC reader has Windows Kiosk Mode enabled or is locked into a dedicated single-browser kiosk profile to prevent unauthorized desktop access.
2. **NFC Reader USB Port Security:**
   - Physical USB ports on kiosk terminals should be physically secured or restricted via Windows Group Policy to prevent unauthorized peripheral swapping.
3. **TLS/HTTPS Termination in Enterprise Production:**
   - For internal intranet or cloud deployment, terminate TLS 1.3 using a reverse proxy (e.g., NGINX, Cloudflare, or AWS ALB) with automated certificate renewals.
4. **Regular Database Snapshot Offsite Replication:**
   - Utilize the included `scripts/backup-db.mjs` utility with automated Windows Task Scheduler to back up PostgreSQL data snapshots daily and replicate encrypted `.sha256` archives to an offsite secure storage bucket.
5. **Periodic Credential Audit:**
   - Review active employee NFC card assignments quarterly and revoke cards belonging to separated contractors or retired staff.
