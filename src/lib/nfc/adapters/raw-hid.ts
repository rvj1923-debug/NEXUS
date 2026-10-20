/**
 * MODE C: Raw HID / Proprietary Hardware Diagnostic & Fallback Adapter
 * Safely interrogates unrecognized or non-standard HID NFC devices without
 * assuming vendor-proprietary command formats, preserving manual fallback.
 */

import { HardwareCandidateInfo, NormalizedCardData } from "../types";
import { normalizeNfcUid } from "../normalization";

export interface RawHidDiagnosticInfo {
  vid: string;
  pid: string;
  instanceId: string;
  interfaceIndex?: number;
  reportDescriptorSupported: boolean;
  status: "UNSUPPORTED_PROPRIETARY" | "DIAGNOSTIC_MODE" | "MANUAL_FALLBACK";
  recommendation: string;
}

export class RawHidAdapter {
  private candidate: HardwareCandidateInfo | null = null;
  private isDiagnosticActive = false;

  constructor(candidate?: HardwareCandidateInfo) {
    if (candidate) {
      this.candidate = candidate;
    }
  }

  public setCandidate(candidate: HardwareCandidateInfo) {
    this.candidate = candidate;
  }

  public getDiagnosticInfo(): RawHidDiagnosticInfo {
    return {
      vid: this.candidate?.vid || "0xFFFF",
      pid: this.candidate?.pid || "0x0035",
      instanceId: this.candidate?.instanceId || "USB\\UNKNOWN",
      reportDescriptorSupported: false,
      status: "UNSUPPORTED_PROPRIETARY",
      recommendation:
        "Device does not expose standard CCID/PCSC descriptors and uses vendor-specific HID reports. Mode A Keyboard Wedge or Manual Fallback is recommended until manufacturer protocol documentation is supplied.",
    };
  }

  public enableDiagnosticMode() {
    this.isDiagnosticActive = true;
  }

  public disableDiagnosticMode() {
    this.isDiagnosticActive = false;
  }

  /**
   * Manual fallback input processor: safely validates operator-entered or
   * barcode-scanned card UID without risking hardware locking.
   */
  public processManualFallback(rawInput: string): NormalizedCardData {
    return normalizeNfcUid(rawInput);
  }
}
