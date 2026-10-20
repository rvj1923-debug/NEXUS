# Company Phone Time In / Time Out — Standard Operating Procedure (SOP)

**Document Version:** 1.0.0  
**Target Audience:** Field Operations Personnel, Custodians, Department Supervisors  
**System:** Company Phone Tracker (CPT) Kiosk Turnstile System

---

## 1. Overview of Daily Custody Workflow

The Time In / Time Out process governs the daily issuance and return of company-issued smartphones. 

```
                                  DAILY LIFECYCLE
                     
    [Morning: Shift Start]                             [Evening: Shift End]
       • TIME IN Action                                   • TIME OUT Action
       • Custodian Inspects Asset                         • Custodian Inspects Return Condition
       • Device Leaves Depot                              • Device Recharges in Depot
```

---

## 2. Standard Operating Procedure: TIME IN (Shift Start — 1st Scan)

### Step 1: Employee Arrival & Tag Scan (Zero-Touch)
1. Employee approaches the kiosk turnstile displaying **"TAP YOUR PHONE TO TIME IN / TIME OUT"**.
2. Employee holds the physical NFC tag affixed to the back of the assigned phone against the USB reader.
3. The reader beeps, and the kiosk resolves the phone asset and employee details within 300ms.

### Step 2: Automatic Custody Processing (No Screen Touch Required)
* The kiosk identifies that the phone is currently in depot (`AVAILABLE`) with an active employee assignment.
* **Zero Button Clicks Required:** The system immediately transitions to **"PROCESSING TIME IN..."** and automatically executes the custody check-out without requiring any touch screen button presses, PINs, or password prompts.
* Device custodyStatus transitions to `ISSUED` in the database.

### Step 3: Audio-Visual Confirmation & Turnstile Handover
* The kiosk plays a high-tone success chime and displays the emerald confirmation banner:
  > **"PHONE SUCCESSFULLY TIMED IN"**  
  > *Asset MOB-001 issued to Leo Valdez. Expected return: 5:00 PM Manila Time.*
* The screen displays the transaction reference number and auto-resets after 6 seconds for the next employee.

---

## 3. Standard Operating Procedure: TIME OUT (Shift End — 2nd Scan)

### Step 1: Employee Arrival & Tag Scan (Zero-Touch)
1. Employee approaches the kiosk turnstile at the end of their shift.
2. Employee taps the phone's NFC tag onto the USB reader.

### Step 2: Intelligent Time Differential & Automatic Processing
* The kiosk identifies that the phone holds an open custody transaction (`ISSUED`).
* **Time Differential Evaluation (Accidental Double-Tap Guard):**
  * If **< 30 seconds** have elapsed since Time In, the transaction is **blocked as an accidental double-tap** (see Section 4, Scenario A).
  * If **>= 30 seconds** have elapsed (or the device is Overdue), the system immediately transitions to **"PROCESSING TIME OUT..."** and automatically surrenders the device.
* **Zero Button Clicks Required:** No screen touches or button confirmations needed.
* Device custodyStatus resets to `AVAILABLE` in the database.

### Step 3: Audio-Visual Confirmation & Restow
* The kiosk plays a completion chime and displays the blue confirmation banner:
  > **"PHONE SUCCESSFULLY TIMED OUT"**  
  > *Asset MOB-001 safely returned to depot custody. Punctuality: ON TIME.*
* Employee rests the device in the designated charging cradle.
* Kiosk auto-resets after 6 seconds.

---

## 4. Accidental Double-Tap Differential Guard (30-Second Protection Window)

### What Happens When an Employee Accidentally Taps Twice?
Field employees frequently double-tap the scanner, leave the phone on the reader too long, or swipe twice in quick succession. Without differential protection, the second tap would immediately surrender the freshly issued phone.

### Protection Mechanism:
1. **Cooldown Differential Window:** 30 seconds from initial Time In timestamp.
2. **Kiosk Action on Rapid Second Tap (< 30s):**
   * **Visual Alert:** Amber shield banner displaying:
     > **"ACCIDENTAL DOUBLE-TAP PREVENTED"**  
     > *Phone MOB-001 was Timed In just 3 seconds ago.*  
     > *Cooldown remaining: 27s before Time Out is permitted.*  
     > *Device remains safely checked out in employee custody.*
   * **Audio Cue:** Distinctive warning chime alerting the user.
   * **Database Guard:** Zero database mutation. Device remains in `ISSUED` status.
   * **Auto-Reset:** Display auto-clears after 6 seconds returning to idle scan mode.

---

## 5. Exception Handling Procedures

### Scenario A: Overdue Surrender (Past Grace Period)
* **Visual Alert:** The kiosk displays an amber **"OVERDUE RETURN DETECTED"** banner, showing the minutes elapsed past deadline.
* **Policy:** Late surrenders are **never locked out**, and the 30-second double-tap cooldown is automatically bypassed so overdue devices can be checked in immediately.
* **Procedure:** System automatically executes Time Out. The backend custody engine records the overdue duration and resolves active `OverdueCase` instances.

### Scenario B: Device Returned with Physical Damage
* Custodians at attended desks can access `/custody/operations` to log detailed damage conditions, notes, and photos, triggering automated `IncidentReport` records and placing the asset into `UNDER_MAINTENANCE` status.

### Scenario C: Scanned Card Not Recognized (Case E)
* **Display:** *"Card not recognized. Please contact the assigned custodian."*
* **Security Rule:** Strict data non-disclosure. The screen does not reveal employee name, asset tag, or reason for rejection.
* **Procedure:** Custodian checks enrollment in `/nfc-cards` or `/phones` in the administrator console.

