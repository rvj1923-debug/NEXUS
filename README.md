# NEXUS — NFC-Enabled Exchange & Usage System
**Enterprise NFC Mobile Asset Custody & Attendance Platform**

NEXUS (NFC-Enabled Exchange & Usage System) is an enterprise web application designed for monitoring company-issued mobile phones using NFC smart cards and tags. It combines the streamlined simplicity of a modern attendance kiosk with an enterprise asset-custody operational dashboard.

---

## Key Features (Phase 1 Foundation)
- **14 Major Application Areas:**
  1. Dashboard (`/dashboard`)
  2. Employees (`/employees`)
  3. NFC Card Management (`/nfc-cards`)
  4. Company Phones (`/phones`)
  5. Phone Assignments (`/assignments`)
  6. NFC Kiosk (`/kiosk`)
  7. Issuance and Surrender (`/custody/operations`)
  8. Active Custody (`/custody/active`)
  9. Overdue Monitoring (`/overdue`)
  10. Incident Management (`/incidents`)
  11. Reports and Exports (`/reports`)
  12. Audit Logs (`/audit-logs`)
  13. User Management (`/users`)
  14. System Settings (`/settings`)
- **Server-Enforced Role-Based Access Control (RBAC):**
  - 5 System Roles: System Administrator, Phone Custodian, Department Supervisor, IT Support, Auditor.
  - Next.js Edge Middleware route guards denying unauthorized access with 403 Forbidden redirects.
- **Relational Integrity Guarantees:**
  - Decoupled primary keys (UUIDs) for permanent employee records.
  - NFC card replacement and phone reassignment preserve 100% of historical custody logs without data destruction.
- **Enterprise UI/UX:**
  - Dual theme support (Light and Dark modes).
  - Responsive layout for workstations, laptops, and tablets.
  - Live metric cards and operational panels driven directly from PostgreSQL without fabricated data.
- **Security & Compliance:**
  - `bcryptjs` password hashing with salt factor 10.
  - HMAC-SHA256 JWT server-side session cookies with 8-hour shift expiration.
  - Brute force sliding-window login rate limiting.
  - Tamper-evident immutable audit log persistence.
  - CLI administrator provisioning utility.

---

## Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL server (or point .env to existing instance)
node scripts/db-server.mjs

# 3. Synchronize database schema
npx prisma db push

# 4. Seed roles, permissions, and test accounts
node scripts/seed.mjs

# 5. Launch development server on port 5000
npm run dev
```

Application URL: **`http://localhost:5000`**

### Test Accounts (Password: as noted)
- **System Administrator:** `admin@company.com` / `AdminPassword123!`
- **Phone Custodian:** `custodian@company.com` / `Custodian123!`
- **Department Supervisor:** `supervisor@company.com` / `Supervisor123!`
- **IT Support:** `itsupport@company.com` / `ITSupport123!`
- **Auditor:** `auditor@company.com` / `Auditor123!`

To host the server on an Azure virtual machine (kiosk PCs keep the NFC readers), see [AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md).

For complete architectural specifications, see [ARCHITECTURE.md](file:///D:/AI%20Projects/company-phone-tracker/ARCHITECTURE.md) and [ROLE_PERMISSION_MATRIX.md](file:///D:/AI%20Projects/company-phone-tracker/ROLE_PERMISSION_MATRIX.md).
