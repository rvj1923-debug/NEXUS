# QA & Security Audit — PHONIX / Company Phone Tracker v1.0.5
**Date:** 2026-10-19 · **Scope:** full source review + live non-destructive probing of the running instance (`next start` on :5000, PGlite DB, Cloudflare quick tunnel active)

> **Sensitive:** this report describes exploitable weaknesses in an internet-exposed system. Keep it internal.

## Summary

| Severity | Count | Headline |
|---|---|---|
| Critical | 3 | Anyone on the internet can get a kiosk session and time phones in/out; the whole `/api/overdue/*` API is unauthenticated; the app is publicly exposed via tunnel |
| High | 4 | Missing role checks on write endpoints, stored-XSS path via proof upload, HTML injection into HR emails, proof photos public |
| Medium | 7 | Open redirect, Host-header redirect injection, login lockout DoS, pool-phone race, silent timestamp rewriting, re-submittable supervisor decisions, fragile middleware bypass |
| Low | 9 | Error handling, headers, metrics bug, dependencies, backups, mobile layout |

**What is solid:** `tsc --noEmit` is clean; README default passwords no longer work; CSV export has formula-injection protection; `/uploads` route is path-traversal safe; the kiosk role is correctly confined (403 on staff APIs); password change requires the current password; DB integrity checks are clean (no duplicate open transactions per phone/employee, phone custody status consistent with open transactions, no future-dated records).

**Evidence legend:** **LIVE** = reproduced against the running server with fake IDs only (no real record changed); **CODE** = confirmed by reading the code, not exercised live because it would modify real data or send email.

---

## Critical

### C1. Anonymous kiosk session + device secret disclosure — LIVE
`GET /api/kiosk/device-login` is in `PUBLIC_PATHS` and issues a 30-day KIOSK JWT to **any caller**. `isValidDeviceKey()` is defined but never called ([device-login/route.ts:16](src/app/api/kiosk/device-login/route.ts:16)). It also sets the `cpt_kiosk_device` cookie to the **real `KIOSK_DEVICE_SECRET`** ([device-login/route.ts:137](src/app/api/kiosk/device-login/route.ts:137)) — verified equal to the `.env` value.

With that session an attacker can:
- `POST /api/kiosk/resolve {cardUid}` → Time In / Time Out on behalf of any employee (verified the endpoint accepts the anonymous session).
- `GET /api/kiosk/recent-logs` → live turnstile feed with employee names, codes, departments, asset tags (verified).
- Use `/api/kiosk/attended-approve`, `/api/kiosk/request`, `/api/kiosk/cancel`, `/api/readers/detect`.

Card UIDs needed for `resolve` are leaked by C2.

**Fix:** require the device key (header or pre-installed cookie) and compare with `isValidDeviceKey`; never send the secret back to the client; consider binding kiosk sessions to an IP allowlist / LAN only.

### C2. Entire `/api/overdue/*` API is unauthenticated — LIVE
[middleware.ts:23](src/middleware.ts:23) lists `/api/overdue` in `PUBLIC_PATHS`, and the check `pathname.startsWith(p + "/")` makes every sub-route public except `hr-remove-incident` and `email-config`. Handlers fall back to `userId = "SYSTEM"` instead of rejecting.

| Endpoint | Impact without login |
|---|---|
| `GET /api/overdue`, `GET /api/overdue/[id]` | All overdue cases: employee + supervisor details, phone IMEI, **NFC card UIDs**, escalations, proof-photo URLs. The public supervisor form calls this itself and lists all 7 current cases with real names when given a bad case ID (screenshot-verified). Also triggers an overdue scan (which can send emails) on every call. |
| `POST /api/overdue/resolve` | Close any case; `REPORTED_LOST` marks the phone **LOST**. No audit log is written ([engine.ts:1173](src/lib/overdue/engine.ts:1173)). |
| `POST /api/overdue/acknowledge` | Overwrite acknowledgement notes. |
| `POST /api/overdue/supervisor-review` | Approve/deny any case, sends HR email, auto-closes on APPROVED. |
| `POST /api/overdue/scan` | Trigger scans/emails on demand. |

Live: `resolve`, `acknowledge`, `supervisor-review` and `GET [id]` all returned **404 "case not found"** for a fake ID without a cookie — i.e. they passed auth and reached the DB lookup.

**Fix:** make only the two pages public; give the email links a signed, single-use, expiring token (HMAC of caseId + expiry) and require it in `supervisor-review` / print-report data fetches; require `requireRole(...)` on resolve/acknowledge/scan and the list endpoint; strip `nfcCard.cardUid` and IMEI from any public payload.

### C3. App is internet-exposed via Cloudflare quick tunnel — LIVE
`data/tunnel-status.json` shows an active `*.trycloudflare.com` URL proxying port 5000 (cloudflared PID running). Every finding above is therefore reachable from the internet, not just the LAN. There are also no security headers (L3).

**Fix:** until C1/C2 are fixed, stop the tunnel or put it behind Cloudflare Access; afterwards expose only the supervisor-form/print-report paths.

---

## High

### H1. Write endpoints rely on path-only, method-blind middleware RBAC — CODE
`canAccessPath` matches only the path prefix, not the HTTP method, and **defaults to allow** when no rule matches ([rbac.ts:121](src/lib/rbac.ts:121)). Many handlers only check "is logged in":

| Endpoint | Who can call it but shouldn't |
|---|---|
| `/api/departments` POST/PUT/DELETE, `/api/departments/[id]`, `/bulk-import`, `/bulk-import-supervisors` | **Any** staff role (Auditor, IT Support, Dept Supervisor) — no rule exists for `/departments`. Overwriting supervisor emails redirects overdue approval links to an attacker. |
| `POST /api/overdue/email-config` | Auditor, Dept Supervisor, Custodian, HR — can replace SMTP host/user/password and HR recipient. |
| `POST /api/overdue/hr-remove-incident` | Auditor, Dept Supervisor, Custodian — and `hrOfficerName`/`hrEmail` come from the request body, so the audit identity is spoofable. |
| `/api/custody/exception`, `/deadlines/extend`, `/deadlines/exempt` | Auditor, IT Support, Dept Supervisor. `extensionMinutes` has no upper bound; `supervisorApproved` is a client-asserted boolean. |
| `POST /api/notifications/test` | Any logged-in user can send arbitrary HTML to any address through company SMTP. |

**Fix:** add `requireRole(...)` (or `hasPermission`) in every mutating handler; change the RBAC default to deny; cap extensions; derive HR identity from the session.

### H2. Stored XSS via served-proof upload — CODE
`saveServedProofImage` accepts any `data:image/<x>;base64` and uses `<x>` as the file extension ([engine.ts:91](src/lib/overdue/engine.ts:91)). `data:image/svg;base64,…` is saved as `.svg`, which `/uploads` serves as `image/svg+xml` from the app origin ([uploads route.ts:11](src/app/uploads/[...path]/route.ts:11)) — scripts run when the file is opened directly. No size limit either. Callers include Auditor/Supervisor (H1).
**Fix:** allowlist `jpeg|png|webp`, verify magic bytes, cap size, drop `.svg` from the MIME map or serve uploads with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`.

### H3. HTML injection into outgoing emails — CODE
Email templates interpolate `supervisorName`, `supervisorRemarks`, employee names, etc. without escaping (e.g. [email.ts:762](src/lib/notifications/email.ts:762)). Combined with C2, anyone can send HR a company-branded email containing attacker-controlled links/HTML.
**Fix:** HTML-escape every interpolated value.

### H4. Served-proof photos are public — LIVE
The middleware skips any path containing `.` ([middleware.ts:96](src/middleware.ts:96)), so `/uploads/incident-proofs/*.jpg` returned **200 without a cookie**. File names are `served-proof-<caseId>-<ts>`, and the URLs are returned by the public API (C2).
**Fix:** require a session (or signed URL) in the `/uploads` route handler.

---

## Medium

- **M1. Open redirect after login — CODE.** `next=//evil.com` passes `startsWith("/")` in [middleware.ts:172](src/middleware.ts:172) and [login/page.tsx:53](src/app/login/page.tsx:53). Require `startsWith("/") && !startsWith("//") && !startsWith("/\\")`.
- **M2. Host-header redirect injection — LIVE.** `GET /` with `X-Forwarded-Host: evil.example` → `Location: http://evil.example/login`. Build redirects from `request.nextUrl` or a configured `APP_URL`, and trust forwarded headers only behind a known proxy.
- **M3. Login lockout DoS — CODE.** 30 failed logins/min from anyone locks **all** users out for 60 s, repeatable indefinitely ([rate-limit.ts:100](src/lib/rate-limit.ts:100)); per-account lockout is keyed only on email, so anyone can lock out the admin. Client IP is always `"direct"` unless `TRUST_PROXY=true`. With the tunnel this is internet-triggerable.
- **M4. Pool-phone double allocation race — CODE.** Kiosk TIME_IN takes an advisory lock on `card.id` only ([resolve/route.ts:655](src/app/api/kiosk/resolve/route.ts:655)); two different employees tapping at once can both get the same free pool phone. No DB constraint prevents two open transactions per phone. (Current data is clean.) Lock on the phone ID too, or add a partial unique index on `phone_asset_id WHERE actual_return_at IS NULL`.
- **M5. Silent timestamp rewriting on every tap — CODE.** Every kiosk tap runs two table-wide `UPDATE`s that rewrite any future-dated `timestamp`/`actualReturnAt` to "now − 60 s" with no audit trail ([resolve/route.ts:238](src/app/api/kiosk/resolve/route.ts:238)). Move this to a one-off maintenance job and log it.
- **M6. Supervisor decisions can be flipped repeatedly — CODE.** `submitSupervisorOvertimeForm` doesn't check for an existing decision; each call re-emails HR. Case lookup also accepts the short `caseNumber` (format `OVD-YYYYMM-NNNNN`, only 100k values per month — brute-forceable, and listed publicly anyway via C2).
- **M7. Middleware bypass for any path with a dot — LIVE (currently harmless).** `/api/employees/x.y` skipped the middleware and was only stopped by the handler's own check. Any future route relying solely on middleware would be exposed. Match static assets by `/_next/` and known extensions instead.

## Low

- **L1.** Malformed JSON to `POST /api/auth/login` returns **500** instead of 400 — LIVE.
- **L2.** `/api/health` is public and exposes backup file names, counts and uptime. `metrics.totalPhones` actually reports the NFC-card count (116 vs 24 phones in DB) — [health/route.ts:219](src/app/api/health/route.ts:219) — LIVE.
- **L3.** No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or HSTS headers — LIVE. Add them via `headers()` in `next.config.mjs`.
- **L4.** Many 500 responses return `error.message` as `details`, which leaks internal errors.
- **L5.** `npm audit`: `xlsx` high (prototype pollution / ReDoS; no npm fix — use the SheetJS CDN build); used only to parse files client-side and write reports server-side, so exposure is low. `postcss` (moderate, via `next`).
- **L6.** Backups live on the same disk as the DB; `mirrorConfigured: false` in health.
- **L7.** Mobile (375 px) kiosk view clips the "Hold the NFC tag…" subtitle and the live activity panel sits off-screen. Low impact because the kiosk is a fixed display.
- **L8.** Seed account `admin@company.com` is still active (its password was changed, which is good). Disable it if it isn't used.
- **L9.** The JWT payload's role/permissions are trusted by the middleware for up to 8 h; DB re-validation only happens in handlers (60 s cache). Fine today, but it ties into M7.

---

## What was tested

| Area | Method | Result |
|---|---|---|
| TypeScript | `tsc --noEmit` | Pass, 0 errors |
| Dependencies | `npm audit --omit=dev` | xlsx (high), postcss/next (moderate) |
| Auth / RBAC | Code review of middleware, rbac, all 70 route handlers | C1, C2, H1, M1, M3, M7 |
| Unauthenticated API surface | 20 live HTTP probes, fake IDs only | C1, C2, H4, M2, L1, L2, L3 confirmed |
| Kiosk confinement | Live with anonymous kiosk session | Correct: 403 on `/api/employees`, `/api/monitoring` |
| Default credentials | Offline bcrypt compare of README passwords vs DB hashes | None valid ✔ |
| Data integrity | Read-only SQL | No duplicate open tx, no status drift, no future timestamps ✔ |
| UI (public pages) | Browser, desktop + 375 px | Renders; L7; console errors only from the offline NFC agent (`127.0.0.1:8002`) |

## Not covered
- **Authenticated dashboard flows** (employees, phones, assignments, custody desk, reports, users, settings). No staff test account was available and I didn't log into the live system as a real user.
- **Destructive / email-sending paths** (issue/surrender, bulk imports, HR close-with-photo, SMTP). Reviewed in code only, because the only database is the live one and SMTP is configured.
- **The repo's `scripts/test-phase*.mjs` suites**, which write to the database. To run them safely, point `DATABASE_URL` at a restored copy of a backup.
- NFC hardware/agent, Windows installer, watchdog scripts.

## Suggested fix order
1. Stop or gate the tunnel (C3).
2. Lock down `device-login` (C1) and `/api/overdue/*` (C2), with signed tokens for the email links.
3. Add role checks to every mutating handler and make RBAC default-deny (H1).
4. Upload allowlist + auth on `/uploads` (H2, H4); escape email HTML (H3).
5. Medium items, then the Low items.
