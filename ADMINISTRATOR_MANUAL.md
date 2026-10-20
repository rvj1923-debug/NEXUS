# Enterprise Administrator & Security Operations Manual
## Company Phone Tracker (CPT) — System Configuration, Governance & Compliance

**Document Version:** 1.0.0 (Release Candidate Hardening)  
**Date:** October 12, 2026  
**Audience:** System Administrators, IT Security Officers, Compliance Auditors  
**System URL:** `http://localhost:5000`  
**Database Backend:** PostgreSQL (Prisma ORM)  

---

## 1. System Administration Overview

The **Company Phone Tracker (CPT)** application provides granular governance tools for managing physical mobile assets, employee credentials, return schedules, multi-tier escalation policies, and regulatory audit trails.

As a **System Administrator** (`SYSTEM_ADMIN`), you possess elevated rights across all 14 core functional modules:
- User Administration & RBAC Management
- Global Settings & Business Rule Policies
- Hardware Bridge Configuration
- Inventory Lifecycle Governance
- Overdue Escalation Engine
- Audit Log Inspection & Forensics
- Disaster Recovery & Database Snapshots

---

## 2. User Management & Role-Based Access Control (RBAC)

Navigate to **User Management** (`/users`) to administer operator accounts.

### 2.1 Role Definitions & Permission Matrix

| Permission Capability | `SYSTEM_ADMIN` | `PHONE_CUSTODIAN` | `DEPT_SUPERVISOR` | `IT_SUPPORT` | `AUDITOR` |
|---|:---:|:---:|:---:|:---:|:---:|
| **Kiosk Phone Issuance & Surrender** | Yes | **Primary** | No | No | No |
| **Manage Phone Inventory (Add/Edit)** | Yes | View Only | View Only | **Primary** | View Only |
| **Manage Employees & Assign Cards** | Yes | View Only | Departmental | View Only | View Only |
| **Grant Overdue Extensions** | Yes | No | **Primary** | No | No |
| **Resolve Incident Tickets** | Yes | No | Review Only | **Primary** | View Only |
| **Export Reports (XLSX, CSV, PDF)** | **Full** | Operational | Departmental | Operational | **Full** |
| **Configure System Settings & SMTP** | **Full** | No | No | No | View Only |
| **Inspect System Audit Logs** | **Full** | No | No | No | **Full** |
| **User Account Administration** | **Full** | No | No | No | No |

### 2.2 Creating a New User Account
1. Go to **User Management** > **Add User**.
2. Enter the user's Full Name, Corporate Email Address, and Department.
3. Assign an appropriate Role from the dropdown menu.
4. Set a strong initial temporary password (minimum 8 characters with alphanumeric and special characters).
5. Ensure **Account Active** is checked.
6. Click **Save User**. The user will be required to change their password upon initial login.

### 2.3 Unlocking Accounts After Brute-Force Lockout
If an operator enters 5 incorrect passwords consecutively, the system locks the account for 15 minutes. To immediately unlock an operator:
1. Locate the locked user in the **User Management** table (indicated by a red *"Locked"* badge).
2. Click **Edit User**.
3. Click the **Reset Failed Attempts** button.
4. Click **Save User**. The operator can now log in immediately.

---

## 3. Mobile Asset & Inventory Governance

Navigate to **Company Phones** (`/phones`) to monitor and configure the physical smartphone pool.

### 3.1 Device Lifecycle States
Every device in the inventory resides in one of six definitive lifecycle states:
- `AVAILABLE`: Stored in the charging dock, verified healthy, ready for issuance at the kiosk.
- `IN_CUSTODY`: Checked out to an employee in the field.
- `ASSIGNED`: Permanently or semi-permanently reserved for a specific employee.
- `UNDER_MAINTENANCE`: Withdrawn from service for repairs, battery replacement, or screen fix.
- `REPORTED_LOST`: Under active security investigation; blocked from issuance.
- `RETIRED`: Decommissioned from the corporate fleet.

### 3.2 Adding a New Phone to Fleet
1. Go to **Company Phones** > **Add Device**.
2. Complete the device specifications:
   - **Asset Tag ID:** e.g., `MOB-042` (Must be unique).
   - **Brand & Model:** e.g., `Samsung Galaxy A54 5G`.
   - **IMEI 1 / Serial Number:** 15-digit TAC hardware identifier.
   - **Storage Capacity:** e.g., `128 GB`.
   - **SIM Card Number / Telco:** e.g., `Smart Communications / 0917-XXX-XXXX`.
3. Set Initial Condition: `Brand New` or `Good`.
4. Click **Save Device**. The device is now listed and available for assignment.

---

## 4. NFC Credential Lifecycle & Security Administration

Navigate to **NFC Card Management** (`/nfc-cards`) to oversee RFID/NFC cards independently of employees.

### 4.1 Card Status Lifecycle
Cards operate under strict state governance:
- `ACTIVE`: Assigned to an employee; authorized for turnstile checkouts.
- `UNASSIGNED`: In storage; ready to be linked to an employee.
- `REVOKED`: Permanently invalidated due to security risk or employee departure.
- `LOST`: Reported missing; triggers a security alert if tapped at any kiosk.
- `DAMAGED`: Degraded antenna coil or broken plastic; decommissioned.
- `EXPIRED`: Reached the end of credential lifecycle.

### 4.2 Card Replacement & Lineage Tracking
When an employee loses a card or reports antenna failure:
1. Locate the employee record or the old card in **NFC Cards**.
2. Click **Replace Card**.
3. Select the Replacement Reason: `Lost`, `Damaged Antenna`, or `Routine Refresh`.
4. The system automatically marks the previous card as `REVOKED` or `LOST` and logs the revocation date.
5. Tap the new replacement card on the USB reader to capture the new UID.
6. Click **Confirm Replacement**. The system preserves the historical link between the retired card and the new card for audit continuity.

---

## 5. System Settings & Return Deadline Policies

Navigate to **System Settings** (`/settings`) to configure company-wide operational parameters.

```
Standard Business Timezone: Asia/Manila (UTC+08:00)
Grace Period Threshold:     15 Minutes
Overdue Evaluation Sweep:   Every 60 Seconds
```

### 5.1 Shift Schedule Engine & Midnight Crossing
The deadline engine accurately calculates return deadlines across complex shift rotations:
- **Standard Day Shift:** `08:00 to 17:00` (Due at 17:15 with 15-minute grace period).
- **Overnight Graveyard Shift:** `22:00 to 06:00 (+1 Day)`. The system advances the calendar day automatically. If issued at 21:45 on Monday, the deadline is set to Tuesday 06:15.
- **Holidays & Company Shutdowns:** Deadlines falling on configured corporate holidays automatically roll forward to the next authorized operational business day.

---

## 6. Escalation Tiers & Notification Policies

The background daemon (`scripts/overdue-worker.mjs`) continuously monitors open custody transactions and triggers escalating actions based on overdue duration:

```mermaid
flowchart LR
    Due["Deadline Passed + 15m Grace"] --> T0["Tier 0: Grace Period<br/>• Kiosk Yellow Alert<br/>• No emails dispatched"]
    T0 -->|"+60 Minutes"| T1["Tier 1: Initial Warning<br/>• Push notification to Employee<br/>• Overdue record opened"]
    T1 -->|"+120 Minutes"| T2["Tier 2: Supervisor Escalation<br/>• Email to Dept Supervisor<br/>• Operations dashboard alert"]
    T2 -->|"+240 Minutes"| T3["Tier 3: Security Critical<br/>• Email to Head of Security & Admin<br/>• Incident ticket auto-flagged"]
```

### 6.1 Configuring Escalation Cooldowns
To prevent email notification flooding, administrators can adjust the cooldown intervals in **System Settings**:
- **Tier 1 Cooldown:** 60 minutes (re-evaluates every hour).
- **Tier 2 Cooldown:** 120 minutes (re-evaluates every 2 hours).
- **Tier 3 Cooldown:** 240 minutes (re-evaluates every 4 hours).

---

## 7. Audit Log Review & Compliance Auditing

Navigate to **Audit Logs** (`/audit-logs`) to conduct forensic security reviews.

### 7.1 Immutable Log Characteristics
- Every issuance, return, card enrollment, override, and login attempt generates an immutable row.
- Audit records cannot be edited or deleted through the web application.
- Each log entry records:
  - **Timestamp (UTC & Manila Time)**
  - **Acting User ID & Username**
  - **Target Entity (Employee, Phone, Card, Policy)**
  - **Action Type (`CREATE`, `UPDATE`, `ISSUE`, `SURRENDER`, `REVOKE`)**
  - **Client IP Address & User Agent**
  - **Before State & After State (JSON Diff)**

---

## 8. Executive Reporting & Compliance Exports

Navigate to **Reports & Exports** (`/reports`) to extract verified custody ledgers.

### 8.1 Export Formats & Anti-Injection Protection
1. **Multi-Sheet Microsoft Excel (`.xlsx`):** Contains executive summary charts, active custody roster, overdue historical analysis, and asset turnover metrics.
2. **Standard CSV (`.csv`):** Formatted for automated ingestion into corporate HRIS and ERP systems.
   - *Security Defense:* All cell values starting with `=,+,-,@,\t,\r` are escaped with a prepended single quote (`'`), preventing spreadsheet formula injection vulnerabilities.
3. **Executive PDF Report (`.pdf`):** Formal landscape document complete with digital verification watermark, corporate header, summary statistics, and signature lines for internal audit sign-off.

---

## 9. Disaster Recovery & Database Maintenance

### 9.1 Performing a Database Backup
Execute the automated backup tool:
```powershell
node scripts/backup-db.mjs
```
The utility generates:
- `backups/cpt_backup_<TIMESTAMP>.json`: Complete database snapshot containing all 25 normalized tables.
- `backups/cpt_backup_<TIMESTAMP>.json.sha256`: Cryptographic hash for tamper detection.

### 9.2 Performing a Controlled Restoration
1. Verify snapshot integrity with a dry run:
   ```powershell
   node scripts/restore-db.mjs backups/cpt_backup_<TIMESTAMP>.json --dry-run
   ```
2. If the dry run confirms integrity and valid foreign key order, execute the live restore:
   ```powershell
   node scripts/restore-db.mjs backups/cpt_backup_<TIMESTAMP>.json
   ```

---

## 10. Administrator Security Checklist

- [x] Change default administrative passwords immediately after initial deployment.
- [x] Verify that the production `.env` file has file permissions restricted to the Windows Administrator group.
- [x] Configure Windows Task Scheduler to execute `scripts/backup-db.mjs` daily at 02:00 AM Manila Time.
- [x] Periodically review the `/api/health` telemetry endpoint to verify database and reader bridge latency.
- [x] Perform quarterly reconciliations between physical charging bay inventory and the `/phones` available count.
