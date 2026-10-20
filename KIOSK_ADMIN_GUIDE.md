# Company Phone Tracker — Kiosk Administrator Operations Guide
## Kiosk Terminal Governance, Hardware Pairing & Remote Security

**Document Version:** 1.0 (Phase 7 Enterprise Release)  
**Target Console:** Administrator Kiosks Management (`/admin/kiosks`)  
**Authorization Role:** `SYSTEM_ADMIN`  
**Timezone Standard:** `Asia/Manila` (PHT / UTC+8)  

---

## 1. Administrative Overview

The **Kiosk Administration Console** provides centralized governance over all physical kiosk terminals deployed across enterprise facilities, warehouses, logistics depots, and office lobbies. 

Administrators have authoritative control over:
- Registering new kiosk hardware terminals.
- Binding physical USB NFC card readers to specific turnstile stations.
- Monitoring live heartbeat signals and last successful scan timestamps.
- Adjusting screen inactivity timeouts (10s to 120s) and default display languages (`EN` / `FIL`).
- Executing emergency remote session revocation to disable compromised or unmaintained terminals.

---

## 2. Navigating to Kiosk Management

1. Log into Company Phone Tracker with an account holding the **`SYSTEM_ADMIN`** role (e.g., `admin@company.com`).
2. In the main navigation sidebar, select **Hardware & Operations** → **Kiosk Terminals** (`/admin/kiosks`).
3. The console displays:
   - **Fleet Summary KPI Cards:** Total Kiosks, Active Stations, Paired NFC Readers, Maintenance Flags.
   - **Terminal Inventory Table:** Code, Location, Bound Reader, Heartbeat, Status, and Controls.
   - **Quick Actions:** Register New Kiosk, Bulk Refresh Heartbeats, Export Station Inventory.

---

## 3. Registering & Deploying a New Kiosk Terminal

When setting up a new touchscreen terminal or PC kiosk station:

### Step 1: Physical Preparation
- Connect the Windows 10/11 touchscreen PC to the enterprise intranet.
- Connect the unbranded USB NFC card reader to a high-speed USB port.
- Verify the local hardware agent or keyboard wedge driver is active.

### Step 2: Register Terminal in Admin Console
1. Navigate to `/admin/kiosks` and click **"Register Kiosk Terminal"**.
2. Complete the registration modal:
   - **Kiosk Station Code:** Unique identifier (e.g., `KIOSK-LOBBY-02`, `KIOSK-GATE-B`).
   - **Physical Location:** Specific facility area (e.g., *Tower 2 Logistics Hub - Turnstile 3*).
   - **Bound NFC Reader:** Select from registered hardware readers (e.g., `KIOSK-GATE-A`).
   - **Inactivity Timeout:** Time in seconds before an abandoned session resets (Default: `30`, Range: `10`–`120`).
   - **Default Display Language:** Choose English (`EN`) or Filipino (`FIL`).
3. Click **"Register Station"**.
4. The system automatically creates the record in `kiosk_devices`, generates a cryptographically random `sessionSecret`, and marks the terminal status as `ACTIVE`.

### Step 3: Configure Kiosk Browser URL
Launch Microsoft Edge in Kiosk Mode pointing to:
```bash
http://localhost:5000/kiosk?station=KIOSK-LOBBY-02
```
The terminal automatically binds to this configuration on initial launch.

---

## 4. Live Station Monitoring & Telemetry

The administration console polls kiosk health status every 30 seconds:

```
+----------------------------------------------------------------------------------------------------+
| KIOSK CODE     LOCATION                    READER         LAST SEEN          STATUS    ACTIONS      |
+----------------------------------------------------------------------------------------------------+
| KIOSK-MAIN-01  Ground Floor Tower 1 Lobby  KIOSK-GATE-A   10 seconds ago     ACTIVE    [Edit] [Revoke]
| KIOSK-GATE-A   Logistics Hub Gate A        DESK-READER-1  2 minutes ago      ACTIVE    [Edit] [Revoke]
| KIOSK-DEPOT-03 Warehouse South Gate        (Unassigned)   Never              OFFLINE   [Edit] [Pair]
+----------------------------------------------------------------------------------------------------+
```

### Telemetry Health Flags:
- **`ACTIVE` (Green):** Scanner is actively reporting scans and heartbeats within expected operational thresholds.
- **`MAINTENANCE` (Amber):** Terminal is flagged for hardware inspection or software updates. Public card taps are paused.
- **`OFFLINE` (Gray):** No heartbeat detected for over 15 minutes. Verify network connectivity and power.
- **`REVOKED` (Red):** Terminal session secret was invalidated by an administrator.

---

## 5. Inactivity Timeout & Abandonment Tuning

Kiosk terminals are placed in public corridors where employees may tap their badge and then walk away without completing their transaction.

### Recommended Timeout Configuration:
- **High-Throughput Turnstiles (Depot Turnstiles, Gate Entrances):** `20 seconds`  
  *Prevents queue bottlenecks during shift changes.*
- **Lobby Standing Stations:** `30 seconds` (Default)  
  *Balances adequate employee reading time with swift reset.*
- **Attended Security Desks:** `60 seconds`  
  *Allows extra time for physical device inspection and custodian login.*

To update the timeout:
1. Click **"Edit"** next to the kiosk terminal at `/admin/kiosks`.
2. Adjust **Inactivity Timeout (Seconds)**.
3. Click **"Save Changes"**. The client automatically fetches the new timeout on its next heartbeat.

---

## 6. Emergency Remote Session Revocation

If a physical kiosk terminal is tampered with, unbolted, relocated without authorization, or suffers repeated security exceptions:

1. Locate the kiosk station in `/admin/kiosks`.
2. Click the **"Revoke Session"** button.
3. Confirm the warning prompt:
   > *"Are you sure you want to revoke session secret for KIOSK-MAIN-01? All pending verification requests from this terminal will be cancelled immediately."*
4. **Immediate System Effect:**
   - The server nullifies `KioskDevice.sessionSecret` and updates `status = "REVOKED"`.
   - All active `KioskVerificationRequest` records originating from this kiosk transition to `CANCELLED`.
   - The kiosk terminal screen transitions to a locked maintenance banner:  
     *"TERMINAL ACCESS SUSPENDED. Contact IT Administration."*

To restore the kiosk after security verification, click **"Re-authorize Station"** to generate a fresh cryptographic session secret.

---

## 7. Database Maintenance & Cleanup Routines

The kiosk subsystem generates short-lived records in `kiosk_verification_requests`. While records are lightweight, automated cleanup ensures long-term database performance.

### Automated Cleanup Script:
A scheduled database maintenance task is bundled at [`scripts/cleanup-kiosks.mjs`](file:///D:/AI%20Projects/company-phone-tracker/scripts/):

```javascript
// Removes expired uncommitted tokens older than 7 days
await db.kioskVerificationRequest.deleteMany({
  where: {
    requestStatus: { in: ["EXPIRED", "CANCELLED"] },
    createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  }
});
```

All `APPROVED` verification requests that resulted in actual custody transitions are **permanently retained** for audit compliance and linked directly to their parent `CustodyTransaction`.

---

## 8. REST API Reference for Administration

| Method | Endpoint | Authorization | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/kiosks` | `SYSTEM_ADMIN` | List all registered kiosk devices with telemetry. |
| `POST` | `/api/admin/kiosks` | `SYSTEM_ADMIN` | Register a new kiosk terminal station. |
| `GET` | `/api/admin/kiosks/[id]` | `SYSTEM_ADMIN` | Retrieve single kiosk configuration and recent requests. |
| `PATCH` | `/api/admin/kiosks/[id]` | `SYSTEM_ADMIN` | Update station location, timeout, or bound reader. |
| `POST` | `/api/admin/kiosks/[id]/revoke` | `SYSTEM_ADMIN` | Invalidate session secret and immediately suspend terminal. |
