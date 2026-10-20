/**
 * Universal NFC Card Identifier Normalization & Debounce Engine
 */

import { NormalizedCardData } from "./types";

// In-memory debounce cache to prevent duplicate scan bouncing
const scanHistory = new Map<string, number>();

/**
 * Normalizes an arbitrary raw NFC card input into an authoritative, clean identifier.
 * Supports:
 * - Colon-separated hex (e.g. 04:A2:8B:71:68)
 * - Hyphen-separated hex (e.g. 04-A2-8B-71-68)
 * - Continuous hex string (e.g. 04A28B7168 or E0040150)
 * - Decimal representation (e.g. 0004829104 emitted by standard USB wedge readers)
 */
export function DeduplicateRawScan(input: string): string {
  let s = input.trim();
  if (!s) return s;

  // Strip optional SN- prefix (e.g. "SN-0114156366" or "SN-01:14:15:63:66")
  if (/^sn-/i.test(s)) {
    s = s.slice(3).trim();
  }

  // Check if string is an exact repetition of a full UID (at least 8 chars per UID, e.g. 2x10 = 20 chars)
  for (let reps = 2; reps <= 6; reps++) {
    if (s.length >= reps * 8 && s.length % reps === 0) {
      const chunkLen = s.length / reps;
      const chunk = s.slice(0, chunkLen);
      if (chunk.repeat(reps) === s) {
        s = chunk;
        break;
      }
    }
  }

  // If pure decimal digits longer than 10 digits (e.g. two 10-digit USB wedge scans overlapped), take the first 10 digits
  if (/^\d{13,}$/.test(s)) {
    s = s.slice(0, 10);
  }

  return s;
}

export function normalizeNfcUid(rawInput: string): NormalizedCardData {
  if (!rawInput || typeof rawInput !== "string") {
    throw new Error("Invalid raw NFC identifier input.");
  }

  const cleaned = DeduplicateRawScan(rawInput);
  const hexClean = cleaned.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  const separatorStripped = cleaned.replace(/[:-\s]/g, "");

  let format: NormalizedCardData["format"] = "RAW";
  let normalizedUid = "";
  let byteLength = 0;
  let detectedStandard = "GENERIC_ISO14443A";

  // Check if decimal (all digits, length 8-12, or 5 colon/hyphen pairs of decimal digits from agent)
  const isPureDigits =
    /^\d{8,12}$/.test(cleaned) ||
    (/^\d{10}$/.test(separatorStripped) && /^(\d{2}[:-]){4}\d{2}$/.test(cleaned));

  if (isPureDigits && !cleaned.toLowerCase().includes("a") && !cleaned.toLowerCase().includes("f")) {
    format = "DECIMAL";
    const decNum = BigInt(separatorStripped);
    const hex = decNum.toString(16).toUpperCase();
    const paddedHex = hex.length % 2 !== 0 ? "0" + hex : hex;
    byteLength = Math.ceil(paddedHex.length / 2);

    // Format with colons
    const chunks: string[] = [];
    for (let i = 0; i < paddedHex.length; i += 2) {
      chunks.push(paddedHex.slice(i, i + 2));
    }
    normalizedUid = chunks.join(":");
  } else if (hexClean.length >= 8 && hexClean.length % 2 === 0) {
    byteLength = hexClean.length / 2;
    const chunks: string[] = [];
    for (let i = 0; i < hexClean.length; i += 2) {
      chunks.push(hexClean.slice(i, i + 2));
    }
    normalizedUid = chunks.join(":");
    format = cleaned.includes(":") ? "HEX_COLON" : "HEX_PLAIN";
  } else {
    normalizedUid = cleaned.toUpperCase();
    byteLength = Math.ceil(hexClean.length / 2) || 4;
  }

  // Detect RFID standard based on UID byte length
  if (byteLength === 4) {
    detectedStandard = "MIFARE_CLASSIC (4-Byte / 1K)";
  } else if (byteLength === 7) {
    detectedStandard = "MIFARE_DESFIRE / NTAG (7-Byte)";
  } else if (byteLength === 8) {
    detectedStandard = "HID_ICLASS (8-Byte)";
  } else if (byteLength === 10) {
    detectedStandard = "FELICA (10-Byte)";
  } else {
    detectedStandard = "ISO14443A / Contactless Smart Card";
  }

  // Generate authoritative Specific Card Number
  const specificCardNumber = `SN-${normalizedUid}`;
  const isValid = normalizedUid.length >= 4 && !normalizedUid.includes(" ");

  return {
    isValid,
    rawInput: cleaned,
    normalizedUid,
    specificCardNumber,
    detectedStandard,
    technologyStandard: detectedStandard,
    byteLength,
    format,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks whether a card scan is a bounce duplicate within the configured debounce window.
 * Returns true if the scan should be SUPPRESSED (duplicate).
 * Returns false if the scan is legitimate.
 */
export function isScanSuppressed(normalizedUid: string, debounceMs = 1500): boolean {
  const now = Date.now();
  const lastTime = scanHistory.get(normalizedUid);

  if (lastTime && now - lastTime < debounceMs) {
    // Suppress duplicate bounce and slide window forward for continuous reader emissions
    scanHistory.set(normalizedUid, now);
    return true;
  }

  // Update last seen timestamp
  scanHistory.set(normalizedUid, now);

  // Periodic purge of stale history (older than 10 seconds)
  if (scanHistory.size > 100) {
    for (const [uid, timestamp] of scanHistory.entries()) {
      if (now - timestamp > 10000) {
        scanHistory.delete(uid);
      }
    }
  }

  return false;
}

export function clearScanDebounce(normalizedUid: string): void {
  scanHistory.delete(normalizedUid);
}

// Alias for universal debounce checking
export const isDebouncedScan = isScanSuppressed;
