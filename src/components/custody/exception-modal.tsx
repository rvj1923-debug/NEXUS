"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Lock,
} from "lucide-react";

interface ExceptionModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSuccess: () => void;
}

export function ExceptionModal({
  isOpen,
  open,
  onClose,
  onOpenChange,
  onSuccess,
}: ExceptionModalProps) {
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);
  const handleClose = () => {
    if (onClose) onClose();
    if (onOpenChange) onOpenChange(false);
  };

  const [employees, setEmployees] = useState<any[]>([]);
  const [phones, setPhones] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exceptionType, setExceptionType] = useState<
    | "FORGOT_NFC_CARD"
    | "DAMAGED_NFC_CARD"
    | "READER_DISCONNECTED"
    | "REPRESENTATIVE_SURRENDER"
    | "WRONG_ASSET_PRESENTED"
    | "PHONE_REPORTED_LOST"
    | "EMPLOYEE_LEFT_WITHOUT_RETURN"
  >("FORGOT_NFC_CARD");

  const [employeeId, setEmployeeId] = useState("");
  const [phoneAssetId, setPhoneAssetId] = useState("");
  const [reason, setReason] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [supervisorApproved, setSupervisorApproved] = useState(false);
  const [supervisorNotes, setSupervisorNotes] = useState("");

  useEffect(() => {
    if (!isModalOpen) return;

    setError(null);
    setReason("");
    setRepresentativeName("");
    setSupervisorApproved(false);
    setSupervisorNotes("");

    Promise.all([
      fetch("/api/employees?limit=100").then((r) => r.json()),
      fetch("/api/phones?limit=100").then((r) => r.json()),
    ])
      .then(([empData, phoneData]) => {
        if (empData.employees) setEmployees(empData.employees);
        if (phoneData.phones) setPhones(phoneData.phones);
      })
      .catch(() => {});
  }, [isModalOpen]);

  if (!isModalOpen) return null;

  const isSensitive =
    exceptionType === "PHONE_REPORTED_LOST" ||
    exceptionType === "WRONG_ASSET_PRESENTED" ||
    exceptionType === "EMPLOYEE_LEFT_WITHOUT_RETURN";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !reason.trim()) {
      setError("Employee selection and mandatory reason are required.");
      return;
    }
    if (isSensitive && !supervisorApproved) {
      setError("This exception type requires supervisor authorization.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/custody/exception", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exceptionType,
          employeeId,
          phoneAssetId: phoneAssetId || null,
          reason: reason.trim(),
          representativeName: representativeName.trim() || null,
          supervisorApproved,
          supervisorNotes: supervisorNotes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to log exception override.");
        setSubmitting(false);
        return;
      }

      onSuccess();
      handleClose();
    } catch {
      setError("Network error submitting exception.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Custody Exception Override
              </h3>
              <p className="text-xs text-slate-500">
                Log authorized procedural exceptions, card failures, and lost devices
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

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Exception Classification *
            </label>
            <select
              value={exceptionType}
              onChange={(e: any) => setExceptionType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-medium"
            >
              <option value="FORGOT_NFC_CARD">Employee Forgot NFC Badge (Visual ID Verified)</option>
              <option value="DAMAGED_NFC_CARD">Damaged / Non-Functional NFC Badge</option>
              <option value="READER_DISCONNECTED">Hardware Reader Disconnected (Manual Bypass)</option>
              <option value="REPRESENTATIVE_SURRENDER">Phone Surrendered by Representative / Colleague</option>
              <option value="WRONG_ASSET_PRESENTED">Wrong Asset Presented at Desk</option>
              <option value="PHONE_REPORTED_LOST">Phone Asset Reported Missing / Stolen</option>
              <option value="EMPLOYEE_LEFT_WITHOUT_RETURN">Employee Left Shift Without Returning Phone</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Employee Involved *
            </label>
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            >
              <option value="">-- Select Employee --</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Company Phone Asset (Optional / If Known)
            </label>
            <select
              value={phoneAssetId}
              onChange={(e) => setPhoneAssetId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-[11px]"
            >
              <option value="">-- None / General Exception --</option>
              {phones.map((phone) => (
                <option key={phone.id} value={phone.id}>
                  [{phone.assetTag}]
                </option>
              ))}
            </select>
          </div>

          {exceptionType === "REPRESENTATIVE_SURRENDER" && (
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Representative Full Name *
              </label>
              <input
                type="text"
                required
                value={representativeName}
                onChange={(e) => setRepresentativeName(e.target.value)}
                placeholder="e.g. Michael Scott (Team Lead)"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Mandatory Justification Reason *
            </label>
            <textarea
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State the detailed operational justification for this exception override..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            />
          </div>

          {isSensitive && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={supervisorApproved}
                  onChange={(e) => setSupervisorApproved(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                />
                <span className="text-[11px] text-amber-900 dark:text-amber-200 leading-tight">
                  <strong>Supervisor Authorization:</strong> I certify that this sensitive exception has been verified and formally approved by the authorized department supervisor.
                </span>
              </label>

              {supervisorApproved && (
                <input
                  type="text"
                  placeholder="Supervisor name or authorization reference..."
                  value={supervisorNotes}
                  onChange={(e) => setSupervisorNotes(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-lg"
                />
              )}
            </div>
          )}

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
              disabled={submitting || !employeeId || !reason.trim()}
              className="px-5 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow flex items-center space-x-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              <span>Commit Exception Override</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
