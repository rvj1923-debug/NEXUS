/**
 * Universal USB NFC Reader Architecture Types
 */

export type ReaderMode = "MODE_A_KEYBOARD_WEDGE" | "MODE_B_PCSC" | "MODE_C_RAW_HID";

export type ReaderConnectionState = "CONNECTED" | "DISCONNECTED" | "BUSY" | "ERROR";

export interface NormalizedCardData {
  isValid: boolean;
  rawInput: string;
  normalizedUid: string;
  specificCardNumber: string;
  detectedStandard: string;
  technologyStandard?: string;
  byteLength: number;
  format: "HEX_COLON" | "HEX_PLAIN" | "DECIMAL" | "RAW";
  timestamp: string;
}

export interface DebounceConfig {
  windowMs: number;
  lastScannedUid: string | null;
  lastScannedTimestamp: number;
}

export interface NfcScanEvent {
  id: string;
  card: NormalizedCardData;
  readerIdentifier: string;
  connectionMode: ReaderMode;
  readerLocation?: string;
  operatorConfirmed?: boolean;
}

export interface HardwareCandidateInfo {
  detected: boolean;
  name: string;
  vid: string;
  pid: string;
  instanceId: string;
  recommendedMode: ReaderMode;
  secondaryMode?: ReaderMode;
  notes: string;
}

export interface AgentStatusInfo {
  version: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  paired: boolean;
  port: number;
  originAllowlist: string[];
  connectedReaders: Array<{
    name: string;
    mode: ReaderMode;
    vid: string;
    pid: string;
    status: ReaderConnectionState;
  }>;
}
