# Company Phone Tracker — Self-Service Kiosk User Manual
## Operational Guide for Employees & Custodians

**Document Version:** 1.0 (Phase 7 Release)  
**System Target:** Public Kiosk Terminal (`/kiosk`) & Custody Operations Desk (`/custody/operations`)  
**Timezone Standard:** `Asia/Manila` (PHT / UTC+8)  
**Applicability:** All Company Personnel, Phone Custodians, Department Supervisors & IT Support  

---

## 1. Quick Reference: Touchscreen Kiosk Overview

The **Company Phone Tracker Kiosk** is an unauthenticated, touchscreen-friendly self-service station located at depot entrances, facility lobbies, and security gates. It replaces paper logbooks with fast, contactless NFC card taps while ensuring strict accountability.

```
+-----------------------------------------------------------------------------------+
|  [CPT Logo] COMPANY PHONE TRACKER      KIOSK-MAIN-01        [FIL] [Theme] [Reader]|
+-----------------------------------------------------------------------------------+
|                                                                                   |
|                               TAP YOUR NFC CARD                                  |
|                 Hold your employee badge steady over the reader                   |
|                                                                                   |
|                                     (( o ))                                       |
|                                  [ NFC SCANNER ]                                  |
|                                                                                   |
|                [ Keyboard / Diagnostic Scan Input: _________________ ]            |
|                                                                                   |
+-----------------------------------------------------------------------------------+
|  Auto-Reset: 30s | Audio Feedback Enabled | Manila Standard Time (PHT, UTC+8)     |
+-----------------------------------------------------------------------------------+
```

### Top Bar Controls:
- **Language Switcher (`[FIL]` / `[EN]`):** Tap to switch interface text between English and Filipino (Tagalog).
- **Theme Toggle (`[Sun / Moon]`):** Tap to switch between high-contrast Dark Mode and crisp Light Mode.
- **Hardware Status Pill:**
  - `READER READY` (Green): USB NFC scanner is active and listening for taps.
  - `KEYBOARD / SIMULATOR MODE` (Amber): Manual input or keyboard wedge mode.
  - `HARDWARE AGENT OFFLINE` (Red): Reader disconnected; notify custodian.

---

## 2. Employee User Guide (Self-Service)

### 2.1 Scenario 1: Picking Up Your Phone (Phone Issuance)

Follow these steps at the start of your shift:

1. **Approach the Kiosk:** Ensure the screen displays *"Tap Your NFC Card"*.
2. **Tap Your Badge:** Hold your registered employee card firmly against the USB reader target.
   - The scanner emits a quick audio beep.
3. **Verify Your Details on Screen:**
   - Your name, department, and photo appear.
   - The assigned phone model and asset tag (e.g., `Samsung Galaxy A54 [MOB-001]`) are displayed.
   - The scheduled return deadline (e.g., *End of Shift: 5:00 PM Manila Time*) is displayed.
4. **Initiate Request:**
   - Tap the large green button: **"REQUEST PHONE ISSUANCE"**.
   - The kiosk displays: *"WAITING FOR CUSTODIAN VERIFICATION"*.
   - A 6-digit Request Code (e.g., `KREQ-847291`) and a 60-second countdown appear.
5. **Physical Device Handover:**
   - Present your Request Code to the on-site custodian or counter officer.
   - The custodian physically hands you the device and accessories.
6. **Transaction Confirmation:**
   - Once approved by the custodian, the screen rings a cheerful harmonic chime and displays:
     ```
     ==========================================
             PHONE SUCCESSFULLY ISSUED
     ==========================================
     Employee:     Jane Doe (ENG-009)
     Asset Tag:    MOB-JANE-001
     Issued At:    08:05 AM (Manila Time)
     Return Due:   Today, 05:00 PM (Manila Time)
     ==========================================
     ```
   - The screen auto-resets after 10 seconds for the next employee.

---

### 2.2 Scenario 2: Returning Your Phone (Phone Surrender)

Follow these steps at the conclusion of your shift:

1. **Tap Your Badge:** Tap your registered NFC card on the scanner.
2. **Automatic Custody Detection:**
   - The system recognizes that you currently hold a device.
   - The screen displays a blue turnstile card: **"PHONE SURRENDER (RETURN)"**.
   - Details of the device currently in your custody are shown.
3. **Initiate Surrender:**
   - Tap the blue button: **"INITIATE PHONE RETURN"**.
   - The screen displays your 6-digit Request Code and begins the 60-second confirmation timer.
4. **Hand In Your Device:**
   - Place your company phone and accessories on the custody counter for inspection.
5. **Surrender Confirmation:**
   - The custodian verifies the phone condition and confirms receipt.
   - The kiosk sounds a success chime and displays:
     ```
     ==========================================
            PHONE SUCCESSFULLY RETURNED
     ==========================================
     Employee:       Jane Doe (ENG-009)
     Asset Tag:      MOB-JANE-001
     Return Status:  ON TIME
     Custody Closed: 04:55 PM (Manila Time)
     ==========================================
     ```
   - Your custody obligation is officially cleared in the enterprise ledger.

---

### 2.3 Scenario 3: Returning an Overdue Device (Late Return)

If you return your phone after your scheduled shift deadline + grace period:

1. **Tap Your Badge:** Tap your NFC card as normal.
2. **Overdue Alert Display:**
   - The kiosk displays a high-visibility amber/red banner:
     ```
     [!] YOUR COMPANY PHONE IS OVERDUE FOR SURRENDER
     This device was due for return 45 minute(s) ago.
     Please initiate surrender immediately.
     ```
3. **Unconditional Late Return:**
   - The system **does not lock you out**. Late returns are permitted and encouraged to resolve the overdue incident.
   - Tap: **"SURRENDER OVERDUE PHONE NOW"**.
4. **Custodian Sign-Off:**
   - Hand the phone to the custodian.
   - The custodian logs the physical return. The system automatically reconciles and resolves your active `OverdueCase`.

---

### 2.4 Error Handling & Guidance

| Screen Display | Meaning | Action Required |
| :--- | :--- | :--- |
| **"Card not recognized. Please contact the assigned custodian."** | Card is not enrolled, damaged, or has been revoked. | Do not tap repeatedly. Step to the custodian desk for identity verification and badge re-issuance. |
| **"No company phone assigned. Please contact IT."** | You have an active employee badge, but no company phone is registered to your profile. | Contact your department supervisor or IT Support to set up a standing device assignment. |
| **"Request Expired"** | Custodian did not confirm the transaction within 60 seconds. | Re-tap your badge to generate a fresh verification token. |
| **"Session Cancelled"** | The 30-second inactivity timer elapsed or you tapped Cancel. | Re-tap your badge when ready. |

> [!IMPORTANT]
> **Privacy Non-Disclosure Rule:**  
> For data protection and security reasons, the kiosk terminal will never disclose whether an unrecognized card belongs to a terminated employee, an inactive cardholder, or a lost badge.

---

## 3. Custodian & Security Officer Guide (Two-Step Verification)

To prevent asset shrinkage, employees cannot finalize a checkout or return without custodian verification. Custodians have two operating methods:

```
+------------------------------------------------------------------------------------+
|                         TWO-STEP VERIFICATION METHODS                              |
+------------------------------------------------------------------------------------+
|                                                                                    |
|   METHOD A: ATTENDED KIOSK MODE              METHOD B: ASSISTED VERIFICATION       |
|   (Custodian at Terminal)                    (Custodian at Desk / Operations)      |
|                                                                                    |
|   1. Employee initiates at Kiosk.            1. Employee initiates at Kiosk.       |
|   2. Custodian taps "Attendant Approval".    2. Request appears in live Queue      |
|   3. Custodian enters PIN / Password.           at /custody/operations.            |
|   4. Custodian inspects device condition.    3. Custodian clicks "Inspect &        |
|   5. Custodian taps "Confirm Custody".          Approve".                          |
|                                              4. Custodian confirms condition       |
|                                                 and clicks "Approve".              |
+------------------------------------------------------------------------------------+
```

---

### 3.1 Method A: Attended Kiosk Mode (On-Terminal Verification)

Use this method when you are physically stationed next to the kiosk terminal:

1. When the employee reaches the *"WAITING FOR CUSTODIAN VERIFICATION"* screen, tap the gold button:
   **"Attendant Approval (Enter PIN / Password)"**.
2. An overlay modal opens over the kiosk:
   - Enter your **Custodian Email** (e.g., `custodian@company.com`).
   - Enter your **Password / PIN**.
3. **Physical Inspection:**
   - Verify that the physical device matches the displayed Asset Tag and IMEI.
   - Inspect physical condition:
     - `GOOD` (Normal operational condition).
     - `MINOR_DAMAGE` (Light scratches/scuffs).
     - `MAJOR_DAMAGE` (Cracked glass, cracked body — *requires notes*).
     - `NOT_FUNCTIONAL` (Boot fail, broken screen — *requires notes*).
   - Check accessory status (Charger, Cable, Protective Case).
4. Tap **"Authorize Transaction"**:
   - The transaction commits immediately in PostgreSQL.
   - The modal closes, and the kiosk transitions to the Employee Confirmation screen.

---

### 3.2 Method B: Assisted Verification Mode (Desk Operations Queue)

Use this method when managing a depot counter, custody booth, or multiple kiosks:

1. Open your laptop, PC, or tablet to:  
   `http://localhost:5000/custody/operations`
2. Scroll to the **"Self-Service Kiosk Verification Queue"** panel.
   - New requests from all paired kiosks appear automatically via live polling.
   - Each card displays: Request Code (`KREQ-xxxxxx`), Kiosk Station (`KIOSK-MAIN-01`), Employee Name, Asset Tag, Action (`ISSUANCE` or `SURRENDER`), and Time Remaining.
3. When the employee presents their phone at the counter:
   - Match the employee's verbal Request Code or name.
   - Click **"Inspect & Approve"**.
4. In the verification popup:
   - Verify phone asset condition (`GOOD`, `MINOR_DAMAGE`, etc.).
   - Verify accessories.
   - Click **"Confirm & Approve Transaction"**.
5. The kiosk terminal at the entrance immediately updates to the success screen with audio chime.
6. If the device presented is incorrect or unauthorized, click **"Reject Request"** and specify the reason.

---

## 4. Visual & Audio Indicators Reference

| Indicator | Sensory Cue | Operational Meaning |
| :--- | :--- | :--- |
| **Radial Pulse Rings** | Visual (Cyan wave) | Scanner is in standby, ready to accept card taps. |
| **Pulsating Green Ring** | Visual (Emerald wave) | Phone issuance turnstile active. |
| **Pulsating Blue Ring** | Visual (Sky blue wave) | Phone surrender turnstile active. |
| **Flashing Amber/Red Banner** | Visual (Red/Yellow pulse) | Overdue alert. Device return is overdue. |
| **Double Major Chime** | Audio (`523.25 Hz` + `659.25 Hz`) | Transaction verified and successfully committed. |
| **Low Sawtooth Buzz** | Audio (`180 Hz`, 250ms) | Tap error, unassigned badge, or rejected verification. |
| **Yellow Circular Timer** | Visual (Countdown 30s) | Inactivity countdown. Terminal resets to standby when zero. |

---

## 5. Contact & Support Escalation

- **Depot Phone Custodian:** Jane Rivera (Lead Custodian), Ext: 4011
- **IT Support Desk:** Ext: 4020 / `support@company.com`
- **Security & Access Control:** Gate A Central Monitoring, Ext: 5000
