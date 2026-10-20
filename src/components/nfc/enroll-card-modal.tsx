"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  CreditCard,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Radio,
  Wifi,
  Keyboard,
  ShieldCheck,
} from "lucide-react";

interface EmployeeOption {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
}

interface EnrollCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialEmployeeId?: string;
  isSystemAdmin?: boolean;
}

export function EnrollCardModal({
  isOpen,
  onClose,
  onSuccess,
  initialEmployeeId = "",
  isSystemAdmin = false,
}: EnrollCardModalProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusMessage, setScanStatusMessage] = useState("Tap card on USB reader or enter UID");
  const [agentConnected, setAgentConnected] = useState(false);
  const [verifiedInfo, setVerifiedInfo] = useState<{
    cardUid: string;
    cardNumber: string;
    technologyStandard: string;
    isAvailable: boolean;
    activeConflict: string | null;
  } | null>(null);

  const [formData, setFormData] = useState({
    cardUid: "",
    cardNumber: "",
    identifierType: "MIFARE_CLASSIC",
    readerSource: "DESK_READER",
    employeeId: initialEmployeeId,
    status: "ACTIVE",
    isMaintenanceCard: false,
    notes: "",
  });

  // Keyboard wedge burst capture ref
  const keyBufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);

  // Fetch employees
  useEffect(() => {
    if (isOpen) {
      fetch("/api/employees")
        .then((res) => res.json())
        .then((data) => setEmployees(data.employees || []))
        .catch(() => {});

      if (initialEmployeeId) {
        setFormData((prev) => ({ ...prev, employeeId: initialEmployeeId }));
      }
    }
  }, [isOpen, initialEmployeeId]);

  // Handle Card UID verification
  const verifyUid = async (rawUid: string) => {
    if (!rawUid || rawUid.trim().length < 4) return;
    setIsScanning(true);
    setScanStatusMessage("Verifying NFC Card...");

    try {
      const res = await fetch(`/api/nfc-cards/verify?cardUid=${encodeURIComponent(rawUid)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Card verification failed");
        setIsScanning(false);
        return;
      }

      setVerifiedInfo(data);
      setFormData((prev) => ({
        ...prev,
        cardUid: data.cardUid,
        cardNumber: prev.cardNumber || data.cardNumber,
        identifierType: data.technologyStandard || prev.identifierType,
      }));

      if (!data.isAvailable && data.activeConflict) {
        setError(`Conflict: ${data.activeConflict}`);
      } else {
        setError(null);
      }
      setScanStatusMessage(`Card Recognized: ${data.cardUid}`);
    } catch {
      setError("Failed to verify card UID with backend");
    } finally {
      setIsScanning(false);
    }
  };

  // Connect to local agent SSE stream when modal is open
  useEffect(() => {
    if (!isOpen) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource("http://127.0.0.1:8002/api/agent/scan/stream");
      es.onopen = () => setAgentConnected(true);
      const handleSseTap = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.card && payload.card.normalizedUid) {
            verifyUid(payload.card.normalizedUid);
          } else if (payload && payload.cardUid) {
            verifyUid(payload.cardUid);
          }
        } catch (e) {
          console.error("SSE parse error:", e);
        }
      };
      es.addEventListener("card_tap", handleSseTap);
      es.onmessage = handleSseTap;
      es.onerror = () => setAgentConnected(false);
    } catch {
      setAgentConnected(false);
    }

    return () => {
      if (es) es.close();
    };
  }, [isOpen]);

  // Global keydown capture for Keyboard Wedge (<65ms burst timing)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is explicitly typing into notes or other inputs
      const target = e.target as HTMLElement;
      if (target && target.tagName === "INPUT" && target.getAttribute("name") === "notes") {
        return;
      }

      const now = Date.now();
      const interval = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter" || e.key === "Tab") {
        if (keyBufferRef.current.length >= 4) {
          e.preventDefault();
          const capturedUid = keyBufferRef.current.join("");
          keyBufferRef.current = [];
          verifyUid(capturedUid);
        }
        return;
      }

      if (e.key.length === 1) {
        if (interval > 120 && keyBufferRef.current.length > 0) {
          keyBufferRef.current = [];
        }
        keyBufferRef.current.push(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/nfc-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to enroll NFC card");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error enrolling NFC card.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
                <span>Enroll NFC Smart Card</span>
                {agentConnected ? (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono">
                    <Wifi className="w-3 h-3 text-emerald-600 animate-pulse" />
                    <span>Reader Agent Live</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono">
                    <Keyboard className="w-3 h-3" />
                    <span>Mode A Emulation</span>
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">
                Register RFID/NFC smart credential and bind to personnel
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Tap Detection Banner */}
        <div className="px-6 py-3 bg-gradient-to-r from-indigo-50/70 to-blue-50/70 dark:from-indigo-950/30 dark:to-blue-950/30 border-b border-indigo-100 dark:border-indigo-900/50 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-indigo-600 animate-pulse" />
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {isScanning ? "Scanning card..." : scanStatusMessage}
            </span>
          </div>
          {formData.cardUid && (
            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
              {formData.cardUid}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {verifiedInfo && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 space-y-1">
              <div className="flex items-center space-x-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Card Verified & Available</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mt-1 text-slate-600 dark:text-slate-300">
                <div>UID: {verifiedInfo.cardUid}</div>
                <div>Standard: {verifiedInfo.technologyStandard}</div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                NFC Card UID (Hex format) *
              </label>
              <button
                type="button"
                onClick={() => verifyUid(formData.cardUid)}
                className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                Verify UID
              </button>
            </div>
            <input
              type="text"
              required
              placeholder="e.g. 04:A1:B2:C3:D4"
              value={formData.cardUid}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                setFormData({ ...formData, cardUid: val });
              }}
              onBlur={() => verifyUid(formData.cardUid)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono uppercase"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Physical credential identifier read by USB desktop reader or entrance kiosk
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Printed Card Number
              </label>
              <input
                type="text"
                placeholder="e.g. BADGE-9081"
                value={formData.cardNumber}
                onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Technology Type
              </label>
              <select
                value={formData.identifierType}
                onChange={(e) => setFormData({ ...formData, identifierType: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                <option value="MIFARE_CLASSIC">MIFARE Classic 1K/4K</option>
                <option value="MIFARE_DESFIRE">MIFARE DESFire EV1/EV2</option>
                <option value="HID_ICLASS">HID iCLASS / Seos</option>
                <option value="FELICA">Sony FeliCa</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Assign to Employee (Optional)
            </label>
            <select
              value={formData.employeeId}
              onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            >
              <option value="">-- Leave Unassigned in Storage Pool --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.employeeCode})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Personnel may only hold one active card unless authorized for multi-card issuance
            </p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Enrollment Notes
            </label>
            <input
              name="notes"
              type="text"
              placeholder="e.g. Issued at security desk for new hire"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            />
          </div>

          {isSystemAdmin && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 flex items-start space-x-2.5">
              <input
                id="enroll-is-maintenance-card"
                type="checkbox"
                checked={formData.isMaintenanceCard}
                onChange={(e) =>
                  setFormData({ ...formData, isMaintenanceCard: e.target.checked })
                }
                className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
              />
              <label
                htmlFor="enroll-is-maintenance-card"
                className="text-xs text-amber-900 dark:text-amber-200 cursor-pointer"
              >
                <span className="font-bold block">Kiosk Maintenance Card (System Admin Only)</span>
                <span className="text-[11px] opacity-80">
                  Tapping this card on a kiosk opens the 30s diagnostics screen without creating a custody transaction. A second tap within 30s reloads the kiosk.
                </span>
              </label>
            </div>
          )}

          <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.cardUid}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              <span>Confirm & Enroll Card</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
