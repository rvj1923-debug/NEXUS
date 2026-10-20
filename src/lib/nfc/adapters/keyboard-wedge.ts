/**
 * MODE A: USB Keyboard Wedge / Keyboard Emulation Adapter
 * Listens for rapid serial keystrokes from USB RFID/NFC readers with suffix detection,
 * debounce suppression, and identifier normalization.
 */

import { NormalizedCardData, ReaderConnectionState } from "../types";
import { normalizeNfcUid, isScanSuppressed } from "../normalization";

export interface KeyboardWedgeConfig {
  suffix: "ENTER" | "TAB" | "NONE";
  debounceMs: number;
  maxKeystrokeIntervalMs: number; // Max ms between keystrokes to differentiate scanner from human typing
  minUidLength: number;
}

const DEFAULT_CONFIG: KeyboardWedgeConfig = {
  suffix: "ENTER",
  debounceMs: 1500,
  maxKeystrokeIntervalMs: 65, // Typical barcode/NFC USB readers emit chars in 5-40ms bursts
  minUidLength: 4,
};

export class KeyboardWedgeAdapter {
  private config: KeyboardWedgeConfig;
  private buffer: string[] = [];
  private lastKeyTimestamp = 0;
  private state: ReaderConnectionState = "CONNECTED";
  private onScanCallback?: (card: NormalizedCardData) => void;
  private onErrorCallback?: (err: Error) => void;

  constructor(config?: Partial<KeyboardWedgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public setOnScan(cb: (card: NormalizedCardData) => void) {
    this.onScanCallback = cb;
  }

  public setOnError(cb: (err: Error) => void) {
    this.onErrorCallback = cb;
  }

  public getState(): ReaderConnectionState {
    return this.state;
  }

  public setState(state: ReaderConnectionState) {
    this.state = state;
  }

  /**
   * Process a single keydown event from a dedicated capture input or global listener
   */
  public handleKeyEvent(key: string, timestamp = Date.now()): boolean {
    const isEnter = key === "Enter" || key === "\n" || key === "\r";
    const isTab = key === "Tab" || key === "\t";

    const isTerminator =
      (this.config.suffix === "ENTER" && isEnter) ||
      (this.config.suffix === "TAB" && isTab) ||
      (this.config.suffix === "NONE" && isEnter);

    if (isTerminator) {
      if (this.buffer.length >= this.config.minUidLength) {
        const rawString = this.buffer.join("");
        this.processCompletedScan(rawString);
        this.buffer = [];
        return true;
      }
      this.buffer = [];
      return false;
    }

    // Check keystroke interval if buffer already has keys
    if (this.buffer.length > 0) {
      const interval = timestamp - this.lastKeyTimestamp;
      if (interval > 300) {
        // Reset buffer if human paused or timed out
        this.buffer = [];
      }
    }

    // Append printable character
    if (key.length === 1 && !isEnter && !isTab) {
      this.buffer.push(key);
      this.lastKeyTimestamp = timestamp;
    }

    return false;
  }

  /**
   * Direct injection of a full raw scan string (from an input box or USB reader buffer)
   */
  public processCompletedScan(rawString: string): NormalizedCardData | null {
    try {
      const normalized = normalizeNfcUid(rawString);

      // Check debounce duplicate suppression
      if (isScanSuppressed(normalized.normalizedUid, this.config.debounceMs)) {
        return null;
      }

      if (this.onScanCallback) {
        this.onScanCallback(normalized);
      }

      return normalized;
    } catch (err: any) {
      if (this.onErrorCallback) {
        this.onErrorCallback(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    }
  }

  public clearBuffer() {
    this.buffer = [];
  }
}
