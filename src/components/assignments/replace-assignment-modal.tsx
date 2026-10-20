"use client";

import React, { useState, useEffect } from "react";
import { X, RefreshCw, AlertCircle, Loader2, Smartphone, ShieldCheck } from "lucide-react";

interface PhoneOption {
  id: string;
  assetTag: string;
  brand: string;
  model: string;
  custodyStatus: string;
  assignmentStatus: string;
}

interface ReplaceAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assignment: {
    id: string;
    employee: {
      firstName: string;
      lastName: string;
      employeeCode: string;
    };
    phoneAsset: {
      id: string;
      assetTag: string;
      brand: string;
      model: string;
    };
  } | null;
}

export function ReplaceAssignmentModal({
  isOpen,
  onClose,
  onSuccess,
  assignment,
}: ReplaceAssignmentModalProps) {
  const [phones, setPhones] = useState<PhoneOption[]>([]);
  const [loadingPhones, setLoadingPhones] = useState(false);
  const [newPhoneAssetId, setNewPhoneAssetId] = useState("");
  const [reason, setReason] = useState("Hardware Fault / Defect");
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && assignment) {
      setError(null);
      setLoadingPhones(true);
      setNewPhoneAssetId("");
      setCustomReason("");
      setNotes("");

      fetch("/api/phones?limit=200")
        .then((res) => res.json())
        .then((data) => {
          if (data.phones) {
            // Filter to unassigned & not currently issued & not the current phone
            setPhones(
              data.phones.filter(
                (p: PhoneOption) =>
                  p.id !== assignment.phoneAsset.id &&
                  p.assignmentStatus !== "ASSIGNED" &&
                  p.custodyStatus !== "ISSUED"
              )
            );
          }
        })
        .catch(() => setError("Failed to load available replacement phones"))
        .finally(() => setLoadingPhones(false));
    }
  }, [isOpen, assignment]);

  if (!isOpen || !assignment) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhoneAssetId) {
      setError("Please choose a replacement device.");
      return;
    }

    const finalReason = reason === "Other" ? customReason.trim() : reason;
    if (!finalReason) {
      setError("Please provide a valid replacement reason.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/assignments/${assignment.id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPhoneAssetId,
          reason: finalReason,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to replace assignment");
        setSubmitting(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error executing phone replacement");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Execute Phone Replacement Workflow
              </h3>
              <p className="text-xs text-slate-500">
                Retains full custody audit chain and archives previous device allocation
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Current Assignment Details */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Assignee:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {assignment.employee.firstName} {assignment.employee.lastName} (
                {assignment.employee.employeeCode})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Current Device:</span>
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {assignment.phoneAsset.assetTag}
              </span>
            </div>
          </div>

          {/* New Replacement Device */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Select Replacement Device <span className="text-red-500">*</span>
            </label>
            {loadingPhones ? (
              <div className="py-2 flex items-center space-x-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                <span>Loading available devices...</span>
              </div>
            ) : phones.length === 0 ? (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs">
                No available replacement phones in inventory. Register or unassign an asset first.
              </div>
            ) : (
              <select
                value={newPhoneAssetId}
                onChange={(e) => setNewPhoneAssetId(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">Select Replacement Phone...</option>
                {phones.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.assetTag}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Replacement Reason */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Replacement Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 mb-2"
            >
              <option value="Hardware Fault / Defect">Hardware Fault / Defect</option>
              <option value="Battery Degradation">Battery Degradation / Power Issues</option>
              <option value="Screen / Cosmetic Damage">Screen / Physical Damage</option>
              <option value="Scheduled Technology Refresh">Scheduled Model Upgrade</option>
              <option value="Lost or Stolen Device">Lost or Stolen Investigation</option>
              <option value="Other">Other (Specify Below)</option>
            </select>

            {reason === "Other" && (
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter specific replacement reason"
                required
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            )}
          </div>

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Custodian / Authorization Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Approved replacement by IT Support desk ticket #4819"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Audit Chain Assurance Banner */}
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300 text-xs flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              The prior assignment will transition to REPLACED status with full historical linkage preserved in the audit log.
            </span>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !newPhoneAssetId || loadingPhones}
              className="px-5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>Execute Replacement</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
