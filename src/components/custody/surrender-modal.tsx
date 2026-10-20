"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ArrowDownLeft,
  Smartphone,
  User,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Camera,
  FileWarning,
} from "lucide-react";
import { formatManilaDateTime } from "@/lib/custody/timezone";

interface SurrenderModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSuccess: () => void;
  initialTransactionId?: string;
  preselectedTransactionId?: string;
}

export function SurrenderModal({
  isOpen,
  open,
  onClose,
  onOpenChange,
  onSuccess,
  initialTransactionId,
  preselectedTransactionId,
}: SurrenderModalProps) {
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);
  const handleClose = () => {
    if (onClose) onClose();
    if (onOpenChange) onOpenChange(false);
  };
  const effectiveInitialTxId = preselectedTransactionId || initialTransactionId || "";

  const [activeCheckouts, setActiveCheckouts] = useState<any[]>([]);
  const [loadingCheckouts, setLoadingCheckouts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTxId, setSelectedTxId] = useState(effectiveInitialTxId);
  const [conditionAtAction, setConditionAtAction] = useState<
    "GOOD" | "MINOR_DAMAGE" | "MAJOR_DAMAGE" | "NOT_FUNCTIONAL" | "ACCESSORIES_MISSING"
  >("GOOD");
  const [accessoriesReturned, setAccessoriesReturned] = useState("All returned");
  const [conditionNotes, setConditionNotes] = useState("");
  const [remarks, setRemarks] = useState("");
  const [isRepresentative, setIsRepresentative] = useState(false);
  const [representativeName, setRepresentativeName] = useState("");

  const selectedTx = activeCheckouts.find((tx) => tx.id === selectedTxId);

  useEffect(() => {
    if (!isModalOpen) return;

    setLoadingCheckouts(true);
    setError(null);
    setSelectedTxId(effectiveInitialTxId);
    setConditionAtAction("GOOD");
    setConditionNotes("");
    setRemarks("");
    setIsRepresentative(false);
    setRepresentativeName("");

    fetch("/api/custody/active")
      .then((r) => r.json())
      .then((data) => {
        if (data.activeCustody) {
          setActiveCheckouts(data.activeCustody);
          if (!selectedTxId && data.activeCustody.length > 0) {
            setSelectedTxId(data.activeCustody[0].id);
          }
        }
      })
      .catch(() => setError("Failed to load active custody records."))
      .finally(() => setLoadingCheckouts(false));
  }, [isModalOpen, effectiveInitialTxId]);

  if (!isModalOpen) return null;

  const isDamagedOrMissing =
    conditionAtAction === "MINOR_DAMAGE" ||
    conditionAtAction === "MAJOR_DAMAGE" ||
    conditionAtAction === "NOT_FUNCTIONAL" ||
    conditionAtAction === "ACCESSORIES_MISSING";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTxId) {
      setError("Please select an active custody record to return.");
      return;
    }
    if (isDamagedOrMissing && !conditionNotes.trim() && !remarks.trim()) {
      setError("Detailed remarks/condition notes are mandatory when damage or missing accessories are reported.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const idempotencyKey = `SURRENDER-${selectedTxId}-${Date.now()}`;

    try {
      const res = await fetch("/api/custody/surrender", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          transactionId: selectedTxId,
          conditionAtAction,
          accessoriesReturned,
          conditionNotes: conditionNotes.trim() || remarks.trim(),
          remarks: remarks || "Assisted desk return",
          surrenderedByRepresentative: isRepresentative,
          representativeName: isRepresentative ? representativeName.trim() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to surrender device.");
        setSubmitting(false);
        return;
      }

      onSuccess();
      handleClose();
    } catch {
      setError("Network error while submitting surrender.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Surrender Company Phone
              </h3>
              <p className="text-xs text-slate-500">
                Receive physical phone, assess condition, and close active custody
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loadingCheckouts ? (
          <div className="py-8 flex flex-col items-center justify-center text-xs text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600 mb-2" />
            <span>Loading active checkouts...</span>
          </div>
        ) : activeCheckouts.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              All Company Phones are Accounted For
            </p>
            <p className="text-[11px] text-slate-400">
              There are currently no outstanding devices in employee custody.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Active Checkout Selection */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Active Custody Record *
              </label>
              <select
                required
                value={selectedTxId}
                onChange={(e) => setSelectedTxId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-[11px]"
              >
                {activeCheckouts.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    [{tx.phoneAsset.assetTag}] {tx.employee.name} ({tx.employee.employeeCode}) — {tx.isOverdue ? `⚠️ LATE (${tx.overdueMinutes}m)` : "On-Time"}
                  </option>
                ))}
              </select>
            </div>

            {selectedTx && (
              <div
                className={`p-3.5 rounded-xl border space-y-2 text-[11px] ${
                  selectedTx.isOverdue
                    ? "bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900/60"
                    : "bg-teal-50/50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900/60"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-800 dark:text-slate-200 font-mono font-bold">
                    {selectedTx.phoneAsset.assetTag}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedTx.isOverdue
                        ? "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300"
                    }`}
                  >
                    {selectedTx.isOverdue ? `OVERDUE (+${selectedTx.overdueMinutes} mins)` : "ON SCHEDULE"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
                  <div>Holder: {selectedTx.employee.name}</div>
                  <div>Department: {selectedTx.employee.department}</div>
                  <div>Issued: {new Date(selectedTx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  <div>Deadline: {selectedTx.returnDeadlineAt ? new Date(selectedTx.returnDeadlineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Shift End"}</div>
                </div>
              </div>
            )}

            {/* Condition at Surrender */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Condition at Surrender *
              </label>
              <select
                value={conditionAtAction}
                onChange={(e: any) => setConditionAtAction(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                <option value="GOOD">GOOD (Normal wear, fully functional)</option>
                <option value="MINOR_DAMAGE">MINOR_DAMAGE (Screen scratch, scuffing)</option>
                <option value="MAJOR_DAMAGE">MAJOR_DAMAGE (Cracked glass, chassis bent)</option>
                <option value="NOT_FUNCTIONAL">NOT_FUNCTIONAL (Defective display, no boot)</option>
                <option value="ACCESSORIES_MISSING">ACCESSORIES_MISSING (Charger/case missing)</option>
              </select>
            </div>

            {/* Condition Warning for Incidents */}
            {(conditionAtAction === "MAJOR_DAMAGE" || conditionAtAction === "NOT_FUNCTIONAL" || conditionAtAction === "ACCESSORIES_MISSING") && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] flex items-start space-x-2">
                <FileWarning className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  <strong>Automatic Incident Flag:</strong> Submitting this condition will automatically generate a formal Incident Record and mark the device for IT maintenance.
                </span>
              </div>
            )}

            {/* Mandatory Remarks when damaged */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {isDamagedOrMissing ? "Condition Inspection Remarks (Mandatory) *" : "Inspection Remarks (Optional)"}
              </label>
              <textarea
                rows={2}
                required={isDamagedOrMissing}
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                placeholder={isDamagedOrMissing ? "Detail exact damage, location of cracks, or missing items..." : "Any observations upon surrender..."}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>

            {/* Accessories Returned */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Returned Accessories Checklist
              </label>
              <input
                type="text"
                value={accessoriesReturned}
                onChange={(e) => setAccessoriesReturned(e.target.value)}
                placeholder="e.g. Phone, Fast Charger, Case"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>

            {/* Representative Surrender Toggle */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRepresentative}
                  onChange={(e) => setIsRepresentative(e.target.checked)}
                  className="rounded text-teal-600 focus:ring-teal-500"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                  Phone Surrendered by Authorized Representative (Colleague / Lead)
                </span>
              </label>
              {isRepresentative && (
                <div>
                  <input
                    type="text"
                    required
                    placeholder="Enter Representative's Full Name & Reason..."
                    value={representativeName}
                    onChange={(e) => setRepresentativeName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-sans"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !selectedTxId}
                className="px-5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-xl shadow flex items-center space-x-1.5 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownLeft className="w-4 h-4" />}
                <span>Confirm Phone Return</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
