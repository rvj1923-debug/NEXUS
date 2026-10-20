"use client";

import React, { useState } from "react";
import { X, AlertTriangle, ShieldAlert, CheckCircle2, Loader2, Smartphone } from "lucide-react";

interface DeactivateEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
  };
}

export function DeactivateEmployeeModal({
  isOpen,
  onClose,
  onSuccess,
  employee,
}: DeactivateEmployeeModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearanceRequired, setClearanceRequired] = useState(false);
  const [outstandingPhone, setOutstandingPhone] = useState<{
    assetTag: string;
    model: string;
    imei: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  if (!isOpen) return null;

  const handleDeactivate = async (force = false) => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/employees/${employee.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceClearance: force,
          overrideReason: force ? overrideReason : undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 409 && data.clearanceRequired) {
        // Clearance warning triggered!
        setClearanceRequired(true);
        setOutstandingPhone(data.outstandingPhone);
        setError(data.error);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Deactivation failed.");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error communicating with clearance server.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className={`p-2 rounded-xl ${clearanceRequired ? "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400" : "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"}`}>
              {clearanceRequired ? <ShieldAlert className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {clearanceRequired ? "Controlled Clearance Warning" : "Deactivate Employee"}
              </h3>
              <p className="text-xs text-slate-500">
                Personnel Separation & Asset Custody Clearance
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-start space-x-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {!clearanceRequired ? (
            <div className="space-y-3">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Are you sure you want to deactivate{" "}
                <strong className="text-slate-900 dark:text-white">
                  {employee.firstName} {employee.lastName} ({employee.employeeCode})
                </strong>
                ?
              </p>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5 text-slate-500">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Automated Clearance Actions:
                </div>
                <div>• All active NFC credentials will be immediately revoked.</div>
                <div>• Standing phone designations will be returned to pool.</div>
                <div>• Historical custody audit records will remain permanently intact.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-red-50/60 dark:bg-red-950/30 border border-red-200 dark:border-red-800/80 space-y-2">
                <div className="flex items-center space-x-2 text-red-900 dark:text-red-200 font-bold">
                  <Smartphone className="w-4 h-4" />
                  <span>Outstanding Company Property Detected</span>
                </div>
                {outstandingPhone && (
                  <div className="font-mono text-[11px] text-red-800 dark:text-red-300 space-y-0.5">
                    <div>Asset Tag: <strong>{outstandingPhone.assetTag}</strong></div>
                    <div>IMEI: {outstandingPhone.imei}</div>
                  </div>
                )}
                <p className="text-[11px] text-red-700 dark:text-red-400">
                  Standard procedure requires employee to surrender this device at the Custody Desk or Kiosk before HR separation.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisor Override Justification (Required to Force Separation) *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Device reported stolen (Police report #1092) OR Employee separated off-site; recovery ticket assigned to IT."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl"
          >
            Cancel
          </button>

          {!clearanceRequired ? (
            <button
              type="button"
              onClick={() => handleDeactivate(false)}
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Verify & Deactivate</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleDeactivate(true)}
              disabled={loading || !overrideReason.trim()}
              className="px-5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Confirm Authorized Clearance Override</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
