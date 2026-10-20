/**
 * MODE B: Windows PC/SC & CCID Contactless Smart Card Adapter
 * Encapsulates PC/SC reader monitoring, card presence detection, and APDU command exchange
 * with reconnect resilience and error handling.
 */

import { NormalizedCardData, ReaderConnectionState } from "../types";
import { normalizeNfcUid, isScanSuppressed } from "../normalization";

export interface PcscConfig {
  readerNameFilter?: string;
  pollingIntervalMs: number;
  autoReconnect: boolean;
  debounceMs: number;
}

const DEFAULT_PCSC_CONFIG: PcscConfig = {
  pollingIntervalMs: 500,
  autoReconnect: true,
  debounceMs: 1500,
};

export class PcscAdapter {
  private config: PcscConfig;
  private state: ReaderConnectionState = "DISCONNECTED";
  private activeReaderName: string | null = null;
  private isCardPresent = false;
  private onScanCallback?: (card: NormalizedCardData) => void;
  private onStateChangeCallback?: (state: ReaderConnectionState, readerName?: string) => void;
  private onErrorCallback?: (err: Error) => void;

  constructor(config?: Partial<PcscConfig>) {
    this.config = { ...DEFAULT_PCSC_CONFIG, ...config };
  }

  public setOnScan(cb: (card: NormalizedCardData) => void) {
    this.onScanCallback = cb;
  }

  public setOnStateChange(cb: (state: ReaderConnectionState, readerName?: string) => void) {
    this.onStateChangeCallback = cb;
  }

  public setOnError(cb: (err: Error) => void) {
    this.onErrorCallback = cb;
  }

  public getState(): ReaderConnectionState {
    return this.state;
  }

  public getActiveReader(): string | null {
    return this.activeReaderName;
  }

  /**
   * Updates reader connection state upon PnP / local agent notification
   */
  public handleConnectionUpdate(connected: boolean, readerName?: string) {
    const prev = this.state;
    this.state = connected ? "CONNECTED" : "DISCONNECTED";
    this.activeReaderName = connected ? (readerName || "PC/SC Contactless Reader") : null;

    if (prev !== this.state && this.onStateChangeCallback) {
      this.onStateChangeCallback(this.state, this.activeReaderName || undefined);
    }
  }

  /**
   * Handles raw APDU response for standard contactless GET UID (FF CA 00 00 00)
   * Status words 90 00 indicate success; 6A 81 indicates function not supported.
   */
  public handleApduResponse(responseHex: string): NormalizedCardData | null {
    try {
      const clean = responseHex.replace(/\s+/g, "").toUpperCase();

      // Check standard ISO 7816 status words at end of response (SW1 SW2)
      if (clean.endsWith("9000")) {
        const uidHex = clean.slice(0, -4);
        if (uidHex.length >= 8) {
          const normalized = normalizeNfcUid(uidHex);

          if (isScanSuppressed(normalized.normalizedUid, this.config.debounceMs)) {
            return null;
          }

          if (this.onScanCallback) {
            this.onScanCallback(normalized);
          }

          return normalized;
        }
      } else if (clean.endsWith("6A81")) {
        throw new Error("Card function not supported: Card does not allow reading raw UID.");
      } else if (clean.endsWith("6982")) {
        throw new Error("Security status not satisfied: Access restricted by card keys.");
      } else {
        throw new Error(`PC/SC Error: Unexpected status word response ${clean.slice(-4)}`);
      }
    } catch (err: any) {
      if (this.onErrorCallback) {
        this.onErrorCallback(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    }

    return null;
  }

  /**
   * Card Presence lifecycle events
   */
  public handleCardInserted(atrHex?: string) {
    this.isCardPresent = true;
  }

  public handleCardRemoved() {
    this.isCardPresent = false;
  }
}
