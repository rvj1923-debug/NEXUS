"use client";

import React, { useState } from "react";
import { X, RefreshCw, Loader2, AlertCircle, ShieldCheck } from "lucide-react";

interface ReplaceCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  card: {
    id: string;
    cardUid: string;
    employee?: {
      firstName: string;
      lastName: string;
      employeeCode: string;
    } | null;
  };
}

export function ReplaceCardModal({
  isOpen,
  onClose,
  onSuccess,
  card,
}: ReplaceCardModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    newCardUid: "",
    newCardNumber: "",
    reason: "DAMAGED",
    remarks: "",
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/nfc-cards/${card.id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to replace card");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error executing replacement workflow.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Replace NFC Smart Card
              </h3>
              <p className="text-xs text-slate-500">
                Issue new credential while preserving 100% of historical custody logs
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Current Card Card */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider block">
              Current Card Being Replaced:
            </span>
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">
                {card.cardUid}
              </span>
              {card.employee && (
                <span className="text-slate-600 dark:text-slate-400">
                  {card.employee.firstName} {card.employee.lastName} ({card.employee.employeeCode})
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              New Replacement Card UID *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. 04:99:FF:A1:B2"
              value={formData.newCardUid}
              onChange={(e) => setFormData({ ...formData, newCardUid: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono uppercase"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Replacement Reason *
              </label>
              <select
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                <option value="DAMAGED">Physical Damage / Broken</option>
                <option value="LOST">Card Lost / Misplaced</option>
                <option value="MALFUNCTION">Chip / Antenna Malfunction</option>
                <option value="WEAR_AND_TEAR">General Wear and Tear</option>
                <option value="UPGRADE">Security Technology Upgrade</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                New Printed Card # (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. BADGE-2026-X"
                value={formData.newCardNumber}
                onChange={(e) => setFormData({ ...formData, newCardNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Custody Remarks
            </label>
            <input
              type="text"
              placeholder="e.g. Returned broken card to security desk; reissued replacement"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            />
          </div>

          <div className="p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-900 dark:text-indigo-300 flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <span>
              The previous card will be revoked with the recorded reason. All prior attendance and custody transactions will remain referenced to the original card UID without data corruption.
            </span>
          </div>

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
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>Execute Replacement</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
