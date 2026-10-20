"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  UserPlus,
  Loader2,
  AlertCircle,
  CreditCard,
  Radio,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Building2,
} from "lucide-react";
import { parseSupervisors } from "@/lib/supervisors";

interface Department {
  id: string;
  name: string;
  code: string;
  supervisorName?: string | null;
  supervisorEmail?: string | null;
}

interface NfcVerificationResult {
  cardUid: string;
  cardNumber: string;
  identifierType: string;
  status: string;
  available: boolean;
  message: string;
  employee?: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department?: string;
  };
}

interface AddEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddEmployeeModal({ isOpen, onClose, onSuccess }: AddEmployeeModalProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simplified Form State: Department, First Name, Last Name, Supervisor Email
  const [departmentId, setDepartmentId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisor2Name, setSupervisor2Name] = useState("");
  const [supervisor2Email, setSupervisor2Email] = useState("");

  // NFC Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [scanInputUid, setScanInputUid] = useState("");
  const [verifyingNfc, setVerifyingNfc] = useState(false);
  const [nfcResult, setNfcResult] = useState<NfcVerificationResult | null>(null);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [webNfcSupported, setWebNfcSupported] = useState(false);

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Audio chime feedback
  const playChime = (success: boolean) => {
    try {
      if (typeof window === "undefined" || !window.AudioContext) return;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (success) {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // AudioContext policy
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setNfcError(null);
      setNfcResult(null);
      setScanInputUid("");
      setFirstName("");
      setLastName("");
      setSupervisorName("");
      setSupervisorEmail("");
      setSupervisor2Name("");
      setSupervisor2Email("");
      setIsScanning(false);

      fetch("/api/departments")
        .then((res) => res.json())
        .then((data) => {
          setDepartments(data.departments || []);
          if (data.departments?.length > 0) {
            const firstDept = data.departments[0];
            const parsed = parseSupervisors(firstDept.supervisorName, firstDept.supervisorEmail);
            setDepartmentId(firstDept.id);
            setSupervisorName(parsed.supervisor1Name);
            setSupervisorEmail(parsed.supervisor1Email);
            setSupervisor2Name(parsed.supervisor2Name);
            setSupervisor2Email(parsed.supervisor2Email);
          }
        })
        .catch(() => {});

      if (typeof window !== "undefined" && "NDEFReader" in window) {
        setWebNfcSupported(true);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Verify NFC Card with Server
  const handleVerifyCard = async (uidToVerify: string) => {
    const cleanUid = uidToVerify.trim();
    if (!cleanUid || cleanUid.length < 3) {
      setNfcError("Please enter or tap a valid NFC Card UID.");
      return;
    }

    setVerifyingNfc(true);
    setNfcError(null);

    try {
      const res = await fetch(`/api/nfc-cards/verify?cardUid=${encodeURIComponent(cleanUid)}`);
      const data = await res.json();

      if (!res.ok) {
        setNfcError(data.error || "Failed to verify NFC card.");
        setNfcResult(null);
        playChime(false);
        return;
      }

      setNfcResult(data);
      playChime(data.available);
      setIsScanning(false);
    } catch {
      setNfcError("Network error contacting NFC verification service.");
      playChime(false);
    } finally {
      setVerifyingNfc(false);
    }
  };

  // Web NFC Reader Activation
  const startWebNfcScan = async () => {
    if (!webNfcSupported) {
      setNfcError("Web NFC API is not supported in this browser. Use the USB Reader input or test tap simulator.");
      return;
    }

    try {
      setIsScanning(true);
      setNfcError(null);
      const ndef = new (window as any).NDEFReader();
      await ndef.scan();

      ndef.onreading = (event: any) => {
        const serialNumber = event.serialNumber;
        if (serialNumber) {
          setScanInputUid(serialNumber);
          handleVerifyCard(serialNumber);
        }
      };

      ndef.onreadingerror = () => {
        setNfcError("Cannot read NFC badge. Hold card closer to sensor.");
      };
    } catch (err: any) {
      setIsScanning(false);
      setNfcError(`NFC Scan error: ${err.message || "Failed to initialize NFC sensor."}`);
    }
  };

  // USB desktop reader keystroke enter listener
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleVerifyCard(scanInputUid);
    }
  };

  // Test Tap Simulator
  const handleSimulateTap = (type: "CLASSIC" | "DESFIRE") => {
    let mockUid = "";
    if (type === "CLASSIC") {
      mockUid = `04:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}`;
    } else {
      mockUid = `04:A2:8B:1F:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:90`;
    }
    setScanInputUid(mockUid);
    handleVerifyCard(mockUid);
  };

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!departmentId) {
      setError("Please select a department.");
      return;
    }
    if (!firstName.trim()) {
      setError("Please enter employee first name.");
      return;
    }
    if (!lastName.trim()) {
      setError("Please enter employee last name.");
      return;
    }

    if (nfcResult && !nfcResult.available) {
      setError(`Cannot register: Scanned NFC card '${nfcResult.cardUid}' has an active conflict. Clear or re-scan card.`);
      return;
    }

    setLoading(true);

    try {
      const payload: any = {
        departmentId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        supervisorName: supervisorName.trim() || undefined,
        supervisorEmail: supervisorEmail.trim().toLowerCase() || undefined,
        supervisor2Name: supervisor2Name.trim() || undefined,
        supervisor2Email: supervisor2Email.trim().toLowerCase() || undefined,
        status: "ACTIVE",
      };

      if (nfcResult && nfcResult.available) {
        payload.nfcCard = {
          cardUid: nfcResult.cardUid,
          cardNumber: nfcResult.cardNumber,
          identifierType: nfcResult.identifierType.includes("DESFIRE")
            ? "MIFARE_DESFIRE"
            : nfcResult.identifierType.includes("ICLASS")
            ? "HID_ICLASS"
            : "MIFARE_CLASSIC",
          readerSource: "DESK_READER",
        };
      }

      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to register employee");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error communicating with registration server.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Register Employee & NFC Badge
              </h3>
              <p className="text-xs text-slate-500">
                Select department, enter employee & supervisor details, and tap NFC badge
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unified Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Department Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Department <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                required
                value={departmentId}
                onChange={(e) => {
                  const newDeptId = e.target.value;
                  setDepartmentId(newDeptId);
                  const found = departments.find((d) => d.id === newDeptId);
                  if (found) {
                    const parsed = parseSupervisors(found.supervisorName, found.supervisorEmail);
                    setSupervisorName(parsed.supervisor1Name);
                    setSupervisorEmail(parsed.supervisor1Email);
                    setSupervisor2Name(parsed.supervisor2Name);
                    setSupervisor2Email(parsed.supervisor2Email);
                  }
                }}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* First Name & Last Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Alexander"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Wright"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Supervisor 1 & 2 Name & Email for 24h Overdue Alerts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Supervisor 1 Name <span className="text-slate-400 font-normal">(Primary)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Roberto Mendoza"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Supervisor 1 Email <span className="text-indigo-600 dark:text-indigo-400 font-normal">(24h Overdue Alert)</span>
              </label>
              <input
                type="email"
                placeholder="supervisor1@company.com"
                value={supervisorEmail}
                onChange={(e) => setSupervisorEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Supervisor 2 Name <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Maria Santos"
                value={supervisor2Name}
                onChange={(e) => setSupervisor2Name(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Supervisor 2 Email <span className="text-slate-400 font-normal">(Optional — Also Notified)</span>
              </label>
              <input
                type="email"
                placeholder="supervisor2@company.com"
                value={supervisor2Email}
                onChange={(e) => setSupervisor2Email(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Unified NFC Card Scan & Verification Section */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-1.5">
                <CreditCard className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>NFC Card Scan & Verification</span>
              </span>

              {/* Test Tap Simulator */}
              <div className="inline-flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 text-[10px]">
                <span className="text-slate-400 px-1 flex items-center space-x-0.5">
                  <Zap className="w-3 h-3 text-amber-500" />
                  <span>Test Tap:</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleSimulateTap("CLASSIC")}
                  className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-200"
                >
                  Mifare 1K
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulateTap("DESFIRE")}
                  className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-200"
                >
                  DESFire EV2
                </button>
              </div>
            </div>

            {/* Tap Listener / Input Bar */}
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  ref={scanInputRef}
                  type="text"
                  placeholder="Tap badge on USB reader or type UID (e.g. 04:A2:8B:1F)"
                  value={scanInputUid}
                  onChange={(e) => setScanInputUid(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono tracking-wider font-semibold"
                />
              </div>

              {webNfcSupported && (
                <button
                  type="button"
                  onClick={startWebNfcScan}
                  disabled={isScanning}
                  title="Activate Web NFC Reader"
                  className="px-3 py-2 text-xs font-semibold rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center space-x-1 shrink-0"
                >
                  <Radio className={`w-3.5 h-3.5 ${isScanning ? "animate-pulse" : ""}`} />
                  <span>{isScanning ? "Listening..." : "Sensor"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleVerifyCard(scanInputUid)}
                disabled={verifyingNfc || !scanInputUid.trim()}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white flex items-center space-x-1.5 disabled:opacity-50 transition-all shrink-0 shadow-sm"
              >
                {verifyingNfc ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                <span>Verify Card</span>
              </button>
            </div>

            {nfcError && (
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{nfcError}</span>
              </div>
            )}

            {/* Verified NFC Badge Card */}
            {nfcResult && (
              <div
                className={`p-3.5 rounded-xl border transition-all ${
                  nfcResult.available
                    ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                    : "bg-red-50/70 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    {nfcResult.available ? (
                      <div className="p-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="p-1 rounded-lg bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300">
                        <ShieldAlert className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div>
                      <span className="text-xs font-bold block">
                        {nfcResult.available ? "Card Verified & Ready to Bind" : "Card Conflict Detected"}
                      </span>
                      <span className="text-[11px] opacity-80 block">{nfcResult.message}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNfcResult(null);
                      setScanInputUid("");
                    }}
                    className="text-[10px] font-semibold underline opacity-75 hover:opacity-100"
                  >
                    Clear Card
                  </button>
                </div>

                {/* Specific Card Information Display */}
                <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/60">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider block">
                      Card UID
                    </span>
                    <span className="font-mono font-bold text-[11px] block mt-0.5 truncate">
                      {nfcResult.cardUid}
                    </span>
                  </div>

                  <div className="p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/60">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider block">
                      Specific Number
                    </span>
                    <span className="font-mono font-bold text-[11px] block mt-0.5 truncate">
                      {nfcResult.cardNumber}
                    </span>
                  </div>

                  <div className="p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/60">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider block">
                      Standard
                    </span>
                    <span className="font-medium text-[10px] block mt-0.5 truncate" title={nfcResult.identifierType}>
                      {nfcResult.identifierType}
                    </span>
                  </div>

                  <div className="p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/60">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider block">
                      Status
                    </span>
                    <span className="font-bold text-[10px] block mt-0.5">
                      {nfcResult.available ? "AVAILABLE" : "CONFLICT"}
                    </span>
                  </div>
                </div>

                {nfcResult.employee && (
                  <div className="mt-2 text-[10px] p-1.5 rounded-lg bg-red-100/60 dark:bg-red-900/40 text-red-800 dark:text-red-300">
                    <strong>Currently Assigned to:</strong> {nfcResult.employee.firstName} {nfcResult.employee.lastName} ({nfcResult.employee.employeeCode})
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form Actions Footer */}
          <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">
              {nfcResult && nfcResult.available ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center space-x-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Card {nfcResult.cardNumber} will be bound</span>
                </span>
              ) : (
                <span>NFC Card tap is optional</span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || (nfcResult !== null && !nfcResult.available)}
                className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                <span>
                  {nfcResult && nfcResult.available ? "Register & Bind NFC Card" : "Register Employee"}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
