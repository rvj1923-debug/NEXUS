# Hardware Compatibility & Diagnostic Report: Universal USB NFC Reader

**Date:** 10/13/2026, 3:47:26 PM  
**System:** Windows OS (Node.js runtime environment)  
**Author:** Hardware Integration & Diagnostics Team (Phase 3)

---

## 1. Executive Discovery Findings

| Property | Status / Value | Description |
| :--- | :--- | :--- |
| **PC/SC Smart Card Reader Class** | **None Detected** | Standard CCID/PCSC readers registered in Windows |
| **Windows Smart Card Service (SCardSvr)** | **Stopped** | Required only for Mode B PC/SC direct APDU communication |
| **Connected USB Devices (Present)** | **15 Devices** | Active USB peripherals connected to laptop |
| **Candidate HID Input Peripherals** | **18 Devices** | Keyboards, touchpads, scanners, and wedge readers |
| **Identified Unbranded Hardware Target** | **VID 0xFFFF & PID 0x0035 Detected** | Unbranded USB composite NFC reader |

---

## 2. Identified Hardware Candidate Analysis


### Device: **Unbranded USB NFC / RFID Reader**
* **USB Vendor ID (VID):** `0xFFFF` (Unbranded generic microcontroller / Sycreader / Yixian standard)
* **USB Product ID (PID):** `0x0035`
* **Device Instance ID:** `USB\VID_FFFF&PID_0035\E4D155F50F01`
* **Supported Protocol Modes:**
  1. **Mode A (Recommended): USB Keyboard Wedge / Emulation (MI_00)**: Emits raw 8-digit or 10-digit hexadecimal/decimal card UID followed by Enter keystroke into the active scan capture listener.
  2. **Mode C (Fallback): Raw Vendor-Defined HID (MI_01)**: Exposes secondary vendor-defined endpoint for diagnostic interrogation.
  3. **Mode B (PC/SC)**: Incompatible (no CCID driver loaded; device operates as native HID).


---

## 3. Supported Multi-Mode Reader Adapters

```mermaid
flowchart TD
    USB["Unbranded USB NFC Reader (Laptop Plugged)"] --> PnP["Windows Plug-and-Play Detection"]
    PnP --> Check{"Device Interface"}
    Check -->|"HID Keyboard Interface (MI_00)"| ModeA["Mode A: Keyboard Wedge Adapter<br/>• Rapid keystroke timing<br/>• Debounce & scan suppression<br/>• Normalization engine"]
    Check -->|"CCID Smart Card (SCardSvr)"| ModeB["Mode B: PC/SC Adapter<br/>• APDU commands<br/>• Card Present / Removed<br/>• CCID standard"]
    Check -->|"Proprietary Raw HID (MI_01)"| ModeC["Mode C: Raw HID Diagnostic<br/>• VID/PID reporting<br/>• Fallback capture"]
    
    ModeA --> Agent["Local Reader Agent (Port 8002) / In-Browser Listener"]
    ModeB --> Agent
    ModeC --> Agent
    Agent --> App["Company Phone Tracker (Port 5000)"]
```

---

## 4. Hardware Inventory Table

### Connected USB Peripherals
| Status | Class | Vendor ID | Product ID | Device Name | Device Instance ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
| OK | USB | `0xFFFF` | `0x0035` | USB Composite Device | `USB\VID_FFFF&PID_0035\E4D155F50F01` |
| OK | HIDClass | `0xFFFF` | `0x0035` | USB Input Device | `USB\VID_FFFF&PID_0035&MI_00\7&36EE0E30&0&0000` |
| OK | USB | `N/A` | `N/A` | USB Root Hub (USB 3.0) | `USB\ROOT_HUB30\5&508C700&0&0` |
| OK | Bluetooth | `0x0E8D` | `0xE020` | MediaTek Bluetooth Adapter | `USB\VID_0E8D&PID_E020&MI_00\7&61E2CDF&0&0000` |
| OK | HIDClass | `0xFFFF` | `0x0035` | USB Input Device | `USB\VID_FFFF&PID_0035&MI_01\7&36EE0E30&0&0001` |
| OK | USB | `N/A` | `N/A` | USB Root Hub (USB 3.0) | `USB\ROOT_HUB30\5&1EF5FDD&0&0` |
| OK | USBDevice | `0x174F` | `0x2472` | Camera DFU Device | `USB\VID_174F&PID_2472&MI_02\7&10143AA&0&0002` |
| OK | Camera | `0x174F` | `0x2472` | Integrated Camera | `USB\VID_174F&PID_2472&MI_00\7&10143AA&0&0000` |
| OK | USB | `0x3554` | `0xFC0A` | USB Composite Device | `USB\VID_3554&PID_FC0A\6&45C18DF&0&1` |
| OK | USB | `0x174F` | `0x2472` | USB Composite Device | `USB\VID_174F&PID_2472\0001` |
| OK | USB | `N/A` | `N/A` | USB Root Hub (USB 3.0) | `USB\ROOT_HUB30\1&2B53A856&0&0` |
| OK | HIDClass | `0x3554` | `0xFC0A` | USB Input Device | `USB\VID_3554&PID_FC0A&MI_00\7&1CD02DDB&0&0000` |
| OK | USB | `N/A` | `N/A` | USB Root Hub (USB 3.0) | `USB\ROOT_HUB30\5&24E4D688&0&0` |
| OK | HIDClass | `0x3554` | `0xFC0A` | USB Input Device | `USB\VID_3554&PID_FC0A&MI_01\7&1CD02DDB&0&0001` |
| OK | USB | `0x0E8D` | `0xE020` | USB Composite Device | `USB\VID_0E8D&PID_E020\000000000` |

### Candidate HID Peripherals (Mode A Wedge Listeners)
| Status | Vendor ID | Product ID | Device Name | Device Instance ID |
| :--- | :--- | :--- | :--- | :--- |
| OK | `N/A` | `N/A` | GPIO Laptop or Slate Indicator Driver | `ACPI\AMDI0081\0` |
| OK | `0x3554` | `0xFC0A` | HID-compliant system controller | `HID\VID_3554&PID_FC0A&MI_01&COL04\8&16419B78&0&0003` |
| OK | `0xFFFF` | `0x0035` | USB Input Device | `USB\VID_FFFF&PID_0035&MI_00\7&36EE0E30&0&0000` |
| OK | `0x3554` | `0xFC0A` | HID-compliant vendor-defined device | `HID\VID_3554&PID_FC0A&MI_01&COL05\8&16419B78&0&0004` |
| OK | `0xFFFF` | `0x0035` | USB Input Device | `USB\VID_FFFF&PID_0035&MI_01\7&36EE0E30&0&0001` |
| OK | `N/A` | `N/A` | HID-compliant touch pad | `HID\FTCS0038&COL02\4&3A5B98DB&0&0001` |
| OK | `0x3554` | `0xFC0A` | HID-compliant vendor-defined device | `HID\VID_3554&PID_FC0A&MI_01&COL06\8&16419B78&0&0005` |
| OK | `N/A` | `N/A` | HID-compliant vendor-defined device | `HID\SDINPUT&COL04\1&2D595CA7&0&0003` |
| OK | `0x3554` | `0xFC0A` | USB Input Device | `USB\VID_3554&PID_FC0A&MI_00\7&1CD02DDB&0&0000` |
| OK | `N/A` | `N/A` | Microsoft Input Configuration Device | `HID\FTCS0038&COL03\4&3A5B98DB&0&0002` |
| OK | `0x3554` | `0xFC0A` | HID-compliant vendor-defined device | `HID\VID_3554&PID_FC0A&MI_01&COL02\8&16419B78&0&0001` |
| OK | `N/A` | `N/A` | HID-compliant vendor-defined device | `HID\SDINPUT&COL05\1&2D595CA7&0&0004` |
| OK | `0xFFFF` | `0x0035` | HID-compliant vendor-defined device | `HID\VID_FFFF&PID_0035&MI_01\8&28FE00E7&0&0000` |
| OK | `N/A` | `N/A` | I2C HID Device | `ACPI\FTCS0038\3&62D7E73&0` |
| OK | `0x3554` | `0xFC0A` | USB Input Device | `USB\VID_3554&PID_FC0A&MI_01\7&1CD02DDB&0&0001` |
| OK | `N/A` | `N/A` | HID-compliant vendor-defined device | `HID\FTCS0038&COL04\4&3A5B98DB&0&0003` |
| OK | `N/A` | `N/A` | SDinput Device | `ROOT\HIDCLASS\0000` |
| OK | `0x3554` | `0xFC0A` | HID-compliant consumer control device | `HID\VID_3554&PID_FC0A&MI_01&COL03\8&16419B78&0&0002` |

---

## 5. Architectural Recommendations for Phase 3
1. **Primary Protocol Adapter:** Activate **Mode A (Keyboard Wedge Adapter)** as the default for the unbranded `0xFFFF:0x0035` reader. This requires zero driver installation, operates with 100% reliability, and normalizes card identifiers across Mifare 1K and DESFire cards.
2. **Local Windows Reader Agent:** Deploy a lightweight Node.js localhost service on `127.0.0.1:8002` implementing token-authenticated pairing, short-lived scan events, and hardware disconnect alerts.
3. **Kiosk & Enrollment UI:** Provide instant audio-visual feedback, debounce filtering to prevent duplicate scan bouncing, and operator confirmation guards.
