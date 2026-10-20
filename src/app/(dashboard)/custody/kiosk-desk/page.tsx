"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Tablet,
  Radio,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Maximize2,
  Volume2,
  VolumeX,
  Smartphone,
  User,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  RotateCcw,
  Wifi,
  Keyboard,
  Loader2,
  Sparkles,
  FileWarning,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ExceptionModal } from "@/components/custody/exception-modal";
import { formatManilaDateTime, formatManilaTime } from "@/lib/custody/timezone";

// Sound synthesizer using Web Audio API
function playSound(type: "success" | "warning" | "complete") {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === "success") {
      // Pleasant double chime
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain1.gain.setValueAtTime(0.15, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.18);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.35);
    } else if (type === "warning") {
      // Low dual warning buzzer
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === "complete") {
      // Ascending triumphant triple tone
      const notes = [440, 554.37, 659.25]; // A4, C#5, E5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.25);
      });
    }
  } catch {
    // Audio context may be restricted by browser autoplay policy until interaction
  }
}

type KioskState =
  | "IDLE"
  | "SCANNING"
  | "CARD_RECOGNIZED"
  | "UNKNOWN_CARD"
  | "REVOKED_CARD"
  | "INACTIVE_EMPLOYEE"
  | "TRANSACTION_SUCCESS";

type ConditionType = "GOOD" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "NOT_FUNCTIONAL" | "ACCESSORIES_MISSING";

export default function NfcKioskPage() {
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [activeReader, setActiveReader] = useState("KIOSK-GATE-A");
  const [readerOnline, setReaderOnline] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Kiosk flow states
  const [kioskState, setKioskState] = useState<KioskState>("IDLE");
  const [cardUidInput, setCardUidInput] = useState("");
  const [rawScannedUid, setRawScannedUid] = useState("");

  // Resolution response data
  const [resolvedData, setResolvedData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Custody confirmation inputs
  const [conditionAtAction, setConditionAtAction] = useState<ConditionType>("GOOD");
  const [remarks, setRemarks] = useState("");
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [completedTx, setCompletedTx] = useState<any>(null);

  // Exception modal state
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);

  // Keyboard wedge burst capture ref
  const keyBufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clock update
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setCurrentDate(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const resetToIdle = useCallback(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setKioskState("IDLE");
    setCardUidInput("");
    setRawScannedUid("");
    setResolvedData(null);
    setErrorMessage("");
    setConditionAtAction("GOOD");
    setRemarks("");
    setCustodyLoading(false);
    setCompletedTx(null);
  }, []);

  // Process Card Tap
  const processCardTap = useCallback(async (uid: string) => {
    if (!uid || uid.trim().length < 3) return;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    const cleanUid = uid.trim().toUpperCase();
    setRawScannedUid(cleanUid);
    setKioskState("SCANNING");

    try {
      const res = await fetch("/api/kiosk/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardUid: cleanUid,
          readerIdentifier: activeReader,
        }),
      });

      const data = await res.json();

      // If debounced duplicate
      if (data.debounced) {
        setKioskState("IDLE");
        return;
      }

      if (!res.ok || !data.success) {
        if (data.error === "UNKNOWN_CARD") {
          if (soundEnabled) playSound("warning");
          setKioskState("UNKNOWN_CARD");
          setErrorMessage(data.message || `NFC Card [${cleanUid}] is not registered in the system.`);
          resetTimerRef.current = setTimeout(resetToIdle, 6000);
          return;
        }

        if (data.error === "INACTIVE_CARD") {
          if (soundEnabled) playSound("warning");
          setKioskState("REVOKED_CARD");
          setErrorMessage(data.message || "This card has been revoked or expired.");
          resetTimerRef.current = setTimeout(resetToIdle, 6000);
          return;
        }

        if (data.error === "INACTIVE_EMPLOYEE") {
          if (soundEnabled) playSound("warning");
          setKioskState("INACTIVE_EMPLOYEE");
          setErrorMessage(data.message || "Employee record is inactive.");
          resetTimerRef.current = setTimeout(resetToIdle, 6000);
          return;
        }

        if (soundEnabled) playSound("warning");
        setKioskState("UNKNOWN_CARD");
        setErrorMessage(data.message || data.error || "Card resolution failed.");
        resetTimerRef.current = setTimeout(resetToIdle, 6000);
        return;
      }

      // Card recognized successfully
      if (soundEnabled) playSound("success");
      setResolvedData(data);
      setKioskState("CARD_RECOGNIZED");

      // Auto cancel after 45 seconds of idle inactivity
      resetTimerRef.current = setTimeout(resetToIdle, 45000);
    } catch (e: any) {
      if (soundEnabled) playSound("warning");
      setKioskState("UNKNOWN_CARD");
      setErrorMessage("Network error connecting to kiosk service.");
      resetTimerRef.current = setTimeout(resetToIdle, 5000);
    }
  }, [activeReader, soundEnabled, resetToIdle]);

  // Connect to local agent SSE stream on 127.0.0.1:8002
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("http://127.0.0.1:8002/api/agent/scan/stream");
      es.onopen = () => setReaderOnline(true);
      const handleSseTap = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.card && payload.card.normalizedUid) {
            processCardTap(payload.card.normalizedUid);
          } else if (payload && payload.cardUid) {
            processCardTap(payload.cardUid);
          }
        } catch (e) {
          console.error("SSE parse error:", e);
        }
      };
      es.addEventListener("card_tap", handleSseTap);
      es.onmessage = handleSseTap;
      es.onerror = () => setReaderOnline(false);
    } catch {
      setReaderOnline(false);
    }

    return () => {
      if (es) es.close();
    };
  }, [processCardTap]);

  // Mode A Keystroke Wedge Burst Listener (<65ms burst timing)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // If user is intentionally typing remarks in the input box, do not capture as wedge
      if (target && target.tagName === "INPUT" && target.getAttribute("name") === "remarks") {
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
          processCardTap(capturedUid);
        }
        return;
      }

      if (e.key.length === 1) {
        // Reset buffer if delay is greater than 100ms (manual typing vs fast barcode/NFC burst)
        if (interval > 100 && keyBufferRef.current.length > 0) {
          keyBufferRef.current = [];
        }
        keyBufferRef.current.push(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [processCardTap]);

  // Handle Custody Action Confirmation
  const handleConfirmCustody = async () => {
    if (!resolvedData || !resolvedData.assignedPhone) return;

    // Validate mandatory remarks for damage
    const isDamaged =
      conditionAtAction === "MAJOR_DAMAGE" ||
      conditionAtAction === "NOT_FUNCTIONAL" ||
      conditionAtAction === "ACCESSORIES_MISSING";

    if (isDamaged && (!remarks || remarks.trim().length < 5)) {
      alert("Mandatory Condition Notes: Please specify the nature of the damage or missing accessories before proceeding.");
      return;
    }

    setCustodyLoading(true);
    try {
      const res = await fetch("/api/kiosk/custody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: resolvedData.employee.id,
          phoneAssetId: resolvedData.assignedPhone.id,
          transactionType: resolvedData.proposedAction,
          cardUid: resolvedData.card.cardUid,
          readerIdentifier: activeReader,
          conditionAtAction,
          remarks: remarks || `NFC Kiosk turnstile transaction at ${activeReader}`,
          operatorConfirmed: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Custody transaction failed.");
        setCustodyLoading(false);
        return;
      }

      if (soundEnabled) playSound("complete");
      setCompletedTx(data);
      setKioskState("TRANSACTION_SUCCESS");

      // Auto reset to idle after 6 seconds
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(resetToIdle, 6000);
    } catch {
      alert("Network error executing custody transaction.");
    } finally {
      setCustodyLoading(false);
    }
  };

  const handleManualScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardUidInput.trim()) return;
    processCardTap(cardUidInput.trim());
  };

  const isDamageSelected =
    conditionAtAction === "MAJOR_DAMAGE" ||
    conditionAtAction === "NOT_FUNCTIONAL" ||
    conditionAtAction === "ACCESSORIES_MISSING";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Kiosk Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
            <Tablet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center space-x-2">
              <span>NFC Asset Custody & Attendance Kiosk</span>
              <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold">
                STATION READY
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Universal USB NFC Reader Kiosk • Auto Keystroke Burst Timing • Local Agent Bridge
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={() => setExceptionModalOpen(true)}
            className="inline-flex items-center px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 font-medium transition"
            title="Forgot badge / manual exception workflow"
          >
            <ShieldAlert className="w-3.5 h-3.5 mr-1" />
            Manual Override
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 transition-all"
            title={soundEnabled ? "Mute audio cues" : "Enable audio cues"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-indigo-600" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
            <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>{activeReader}</span>
          </span>
        </div>
      </div>

      {/* Main Kiosk Surface */}
      <Card className="border-2 border-indigo-500/20 dark:border-indigo-500/30 shadow-2xl overflow-hidden bg-gradient-to-b from-white via-slate-50/50 to-slate-100/50 dark:from-slate-900 dark:via-slate-925 dark:to-slate-950">
        <CardContent className="p-8 sm:p-12 text-center flex flex-col items-center">
          {/* Live Clock */}
          <div className="mb-6">
            <div className="text-5xl sm:text-7xl font-black tracking-tight text-slate-900 dark:text-slate-100 font-mono">
              {currentTime || "00:00:00"}
            </div>
            <div className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
              {currentDate}
            </div>
          </div>

          {/* ================= STATE 1: IDLE ================= */}
          {kioskState === "IDLE" && (
            <div className="flex flex-col items-center animate-fade-in w-full max-w-md">
              <div
                onClick={() => processCardTap("0114156366")}
                className="relative mb-8 group cursor-pointer"
                title="Tap Enrolled NFC Card (Click to simulate live card 0114156366)"
              >
                {/* Pulsing ring */}
                <div className="absolute -inset-3 rounded-full bg-indigo-500/20 animate-ping opacity-60 pointer-events-none" />
                <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-full border-4 border-dashed border-indigo-500/40 dark:border-indigo-500/30 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-indigo-50 to-white dark:from-indigo-950/30 dark:to-slate-900 transition-all group-hover:scale-105 group-hover:border-indigo-500 shadow-xl">
                  <CreditCard className="w-16 h-16 text-indigo-600 dark:text-indigo-400 mb-2 animate-bounce" />
                  <span className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                    Tap NFC Badge
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1 font-mono">
                    Hold card against USB reader
                  </span>
                </div>
              </div>

              {/* Wedge / Manual Scan Input */}
              <form onSubmit={handleManualScanSubmit} className="w-full space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cardUidInput}
                    onChange={(e) => setCardUidInput(e.target.value)}
                    placeholder="Scan / Type UID (e.g. 0114156366)"
                    className="flex-1 px-4 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200 font-mono shadow-sm"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all flex items-center space-x-1"
                  >
                    <span>Read</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-center space-x-2 text-[10px] text-slate-400">
                  <span className="flex items-center space-x-1">
                    <Keyboard className="w-3 h-3 text-slate-400" />
                    <span>Mode A Wedge Burst (&lt;65ms)</span>
                  </span>
                  <span>•</span>
                  <span>PC/SC SmartCard Ready</span>
                  <span>•</span>
                  <span>Anti-Replay Lock</span>
                </div>
              </form>
            </div>
          )}

          {/* ================= STATE 2: SCANNING ================= */}
          {kioskState === "SCANNING" && (
            <div className="py-12 flex flex-col items-center space-y-4 animate-fade-in">
              <div className="relative">
                <div className="w-24 h-24 rounded-full border-4 border-indigo-200 dark:border-indigo-900 border-t-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <CreditCard className="w-8 h-8 text-indigo-600 animate-pulse" />
                </div>
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Reading NFC Credential...
              </div>
              <div className="text-xs text-slate-500 font-mono">
                UID: {rawScannedUid}
              </div>
            </div>
          )}

          {/* ================= STATE 3: CARD RECOGNIZED ================= */}
          {kioskState === "CARD_RECOGNIZED" && resolvedData && (
            <div className="w-full max-w-xl text-left space-y-5 animate-scale-up">
              {/* Employee Summary Card */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 shadow-lg flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-lg border border-indigo-200 dark:border-indigo-800 shadow-inner">
                    {resolvedData.employee.firstName[0]}
                    {resolvedData.employee.lastName[0]}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {resolvedData.employee.fullName}
                      </h3>
                      <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                        {resolvedData.employee.employeeCode}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center space-x-2 mt-0.5">
                      <span>{resolvedData.employee.department}</span>
                      <span>•</span>
                      <span>{resolvedData.employee.position || "Staff"}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">
                      NFC: {resolvedData.card.cardUid} ({resolvedData.card.technologyStandard})
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                      resolvedData.proposedAction === "ISSUANCE"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    }`}
                  >
                    {resolvedData.proposedAction === "ISSUANCE" ? "DEVICE CHECKOUT" : "DEVICE SURRENDER"}
                  </span>
                </div>
              </div>

              {/* Assigned Phone Device Box */}
              {resolvedData.assignedPhone ? (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50/60 to-purple-50/40 dark:from-indigo-950/30 dark:to-slate-900 border border-indigo-200 dark:border-indigo-900/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Smartphone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        Assigned Company Device
                      </span>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      Tag: {resolvedData.assignedPhone.assetTag}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Asset Tag</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {resolvedData.assignedPhone.assetTag}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Primary IMEI</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">
                        {resolvedData.assignedPhone.imei}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Physical Custody Status</span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {resolvedData.custodyState === "IN_CUSTODY" ? "Checked Out (In Custody)" : "Checked In (Available)"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Assigned Shift Deadline</span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {resolvedData.shift ? `${resolvedData.shift.shiftName} (${resolvedData.shift.startTime} - ${resolvedData.shift.endTime})` : "Standard Day Shift"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>
                    No active company phone assigned to this employee. Contact Phone Custodian or IT Support.
                  </span>
                </div>
              )}

              {/* Operator Verification & Confirmation Guard */}
              {resolvedData.assignedPhone && (
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 shadow-md space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Device Physical Condition Assessment
                    </span>
                    <select
                      value={conditionAtAction}
                      onChange={(e: any) => setConditionAtAction(e.target.value)}
                      className="px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg font-semibold text-slate-800 dark:text-slate-200"
                    >
                      <option value="GOOD">GOOD (Clean, fully operational)</option>
                      <option value="MINOR_DAMAGE">MINOR_DAMAGE (Cosmetic wear/scratches)</option>
                      <option value="MAJOR_DAMAGE">MAJOR_DAMAGE (Cracked screen/casing)</option>
                      <option value="NOT_FUNCTIONAL">NOT_FUNCTIONAL (Display black/power defect)</option>
                      <option value="ACCESSORIES_MISSING">ACCESSORIES_MISSING (Charger/case omitted)</option>
                    </select>
                  </div>

                  {isDamageSelected && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 text-amber-800 dark:text-amber-300 text-xs flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">Automated Incident Trigger:</p>
                        <p className="text-[11px] mt-0.5">
                          Selecting {conditionAtAction} will automatically create an Incident Report. Please specify details below.
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <input
                      name="remarks"
                      type="text"
                      placeholder={isDamageSelected ? "Mandatory: Describe specific damage or missing accessories..." : "Optional condition notes or custodian remarks..."}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className={`w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl ${
                        isDamageSelected && !remarks.trim() ? "border-amber-500 ring-1 ring-amber-500" : "border-slate-300 dark:border-slate-700"
                      }`}
                    />
                  </div>

                  {/* Confirmation Buttons */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={resetToIdle}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                    >
                      Cancel / Reset
                    </button>

                    <button
                      type="button"
                      disabled={custodyLoading}
                      onClick={handleConfirmCustody}
                      className={`px-6 py-2.5 text-xs font-bold text-white rounded-xl shadow-lg transition-all flex items-center space-x-2 ${
                        resolvedData.proposedAction === "ISSUANCE"
                          ? "bg-blue-600 hover:bg-blue-700 shadow-blue-600/30"
                          : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30"
                      }`}
                    >
                      {custodyLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : resolvedData.proposedAction === "ISSUANCE" ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                      <span>
                        {resolvedData.proposedAction === "ISSUANCE"
                          ? "Confirm Phone Checkout (Issuance)"
                          : "Confirm Phone Return (Surrender)"}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= STATE 4: TRANSACTION SUCCESS ================= */}
          {kioskState === "TRANSACTION_SUCCESS" && completedTx && (
            <div className="py-6 w-full max-w-md flex flex-col items-center space-y-4 animate-scale-up">
              <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-lg border-2 border-emerald-500">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-black text-slate-900 dark:text-slate-100">
                  Custody Handshake Verified
                </h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  {completedTx.message}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800 w-full text-xs font-mono space-y-2 text-slate-700 dark:text-slate-300">
                <div className="flex justify-between">
                  <span>Tx Code:</span>
                  <span className="font-bold text-indigo-600">{completedTx.transactionCode}</span>
                </div>
                <div className="flex justify-between">
                  <span>Action:</span>
                  <span className="font-bold">{completedTx.transactionType}</span>
                </div>
                <div className="flex justify-between">
                  <span>Device Custody:</span>
                  <span className="font-bold text-emerald-600">{completedTx.phone?.custodyStatus}</span>
                </div>

                {/* Return Punctuality Badge */}
                {completedTx.transactionType === "SURRENDER" && (
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span>Punctuality:</span>
                    {completedTx.returnStatus === "ON_TIME" ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] inline-flex items-center">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        ON_TIME RETURN
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300 font-bold text-[11px] inline-flex items-center">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        LATE (+{completedTx.overdueMinutes || 0}m overdue)
                      </span>
                    )}
                  </div>
                )}

                {completedTx.custodyDurationMinutes !== undefined && (
                  <div className="flex justify-between">
                    <span>Total Custody:</span>
                    <span>
                      {Math.floor(completedTx.custodyDurationMinutes / 60)}h{" "}
                      {completedTx.custodyDurationMinutes % 60}m
                    </span>
                  </div>
                )}

                {completedTx.incident && (
                  <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-[11px] font-sans">
                    ⚠️ Incident report logged: {completedTx.incident.incidentNumber}
                  </div>
                )}
              </div>

              <button
                onClick={resetToIdle}
                className="px-6 py-2.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-900 text-white shadow transition"
              >
                Next Employee (Ready)
              </button>
            </div>
          )}

          {/* ================= STATE 5: UNKNOWN CARD ================= */}
          {kioskState === "UNKNOWN_CARD" && (
            <div className="py-6 w-full max-w-md flex flex-col items-center space-y-4 animate-shake">
              <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Unrecognized NFC Card
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  UID: {rawScannedUid}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm">
                  {errorMessage || "This badge is not registered to any employee in NEXUS."}
                </p>
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <button
                  onClick={resetToIdle}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Dismiss / Try Again
                </button>
                <Link
                  href="/nfc-cards"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow"
                >
                  Enroll Card
                </Link>
              </div>
            </div>
          )}

          {/* ================= STATE 6: REVOKED / INACTIVE ================= */}
          {kioskState === "REVOKED_CARD" && (
            <div className="py-6 w-full max-w-md flex flex-col items-center space-y-4 animate-shake">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shadow">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-red-700 dark:text-red-400">
                  Card Revoked / Inactive — Access Blocked
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  UID: {rawScannedUid}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm">
                  {errorMessage || "This card has been revoked, lost, or deactivated. Custody transactions are strictly blocked."}
                </p>
              </div>
              <button
                onClick={resetToIdle}
                className="px-5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl shadow-sm transition-colors"
              >
                Return to Ready
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Embedded Exception Modal */}
      <ExceptionModal
        open={exceptionModalOpen}
        onOpenChange={setExceptionModalOpen}
        onSuccess={() => {
          resetToIdle();
        }}
      />
    </div>
  );
}
