"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ArrowUpRight,
  Smartphone,
  User,
  CreditCard,
  Clock,
  ShieldCheck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Radio,
} from "lucide-react";
import { formatManilaDateTime } from "@/lib/custody/timezone";

interface IssueModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSuccess: () => void;
}

export function IssueModal({
  isOpen,
  open,
  onClose,
  onOpenChange,
  onSuccess,
}: IssueModalProps) {
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);
  const handleClose = () => {
    if (onClose) onClose();
    if (onOpenChange) onOpenChange(false);
  };

  const [employees, setEmployees] = useState<any[]>([]);
  const [availablePhones, setAvailablePhones] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [conditionAtAction, setConditionAtAction] = useState("GOOD");
  const [accessoriesIssued, setAccessoriesIssued] = useState("Phone, Charger, Case");
  const [remarks, setRemarks] = useState("");
  const [physicallyVerified, setPhysicallyVerified] = useState(false);

  // Auto-resolved details
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const selectedPhone = availablePhones.find((p) => p.id === selectedPhoneId);

  useEffect(() => {
    if (!isModalOpen) return;

    setLoadingData(true);
    setError(null);
    setSelectedEmployeeId("");
    setSelectedPhoneId("");
    setPhysicallyVerified(false);

    Promise.all([
      fetch("/api/employees?limit=100").then((r) => r.json()),
      fetch("/api/phones?status=AVAILABLE&limit=100").then((r) => r.json()),
    ])
      .then(([empData, phoneData]) => {
        if (empData.employees) {
          setEmployees(empData.employees.filter((e: any) => e.status === "ACTIVE"));
        }
        if (phoneData.phones) {
          setAvailablePhones(phoneData.phones.filter((p: any) => p.custodyStatus === "AVAILABLE"));
        }
      })
      .catch((e) => setError("Failed to load active employees or available phones"))
      .finally(() => setLoadingData(false));
  }, [isOpen]);


  if (!isModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeId || !selectedPhoneId) {
      setError("Please select both an employee and a phone asset.");
      return;
    }
    if (!physicallyVerified) {
      setError("Physical verification is mandatory before issuing the device.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const idempotencyKey = `ISSUE-${selectedPhoneId}-${Date.now()}`;

    try {
      const res = await fetch("/api/custody/issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          employeeId: selectedEmployeeId,
          phoneAssetId: selectedPhoneId,
          conditionAtAction,
          accessoriesIssued,
          remarks: remarks || "Assisted desk issuance",
          verifiedViaNfc: false,
          isManualOverride: false,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to complete device issuance.");
        setSubmitting(false);
        return;
      }

      onSuccess();
      handleClose();
    } catch {
      setError("Network error while submitting issuance.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Issue Company Phone
              </h3>
              <p className="text-xs text-slate-500">
                Verify physical device condition and initiate active custody
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loadingData ? (
          <div className="py-8 flex flex-col items-center justify-center text-xs text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mb-2" />
            <span>Loading active personnel and available inventory...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Employee Selection */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Recipient Employee *
              </label>
              <select
                required
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                <option value="">-- Select Active Employee --</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeCode}) — {emp.department?.name || "General"}
                  </option>
                ))}
              </select>
            </div>

            {/* Phone Asset Selection */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Company Phone Asset *
              </label>
              <select
                required
                value={selectedPhoneId}
                onChange={(e) => setSelectedPhoneId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-[11px]"
              >
                <option value="">-- Select Available Device --</option>
                {availablePhones.map((phone) => (
                  <option key={phone.id} value={phone.id}>
                    [{phone.assetTag}] (IMEI: {phone.imei.slice(0, 8)}••••)
                  </option>
                ))}
              </select>
            </div>

            {selectedPhone && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-1 font-mono text-[11px]">
                <div className="text-slate-500 font-sans font-semibold">Physical Device Verification</div>
                <div className="flex justify-between text-slate-700 dark:text-slate-300">
                  <span>Tag: {selectedPhone.assetTag}</span>
                  <span className="text-slate-500">IMEI: {selectedPhone.imei}</span>
                </div>
              </div>
            )}

            {/* Condition & Accessories */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Condition at Issuance
                </label>
                <select
                  value={conditionAtAction}
                  onChange={(e) => setConditionAtAction(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                >
                  <option value="GOOD">GOOD (Standard Operational)</option>
                  <option value="MINOR_DAMAGE">MINOR_DAMAGE (Cosmetic wear)</option>
                  <option value="MAJOR_DAMAGE">MAJOR_DAMAGE (Requires attention)</option>
                  <option value="NOT_FUNCTIONAL">NOT_FUNCTIONAL (Defective)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Accessories Issued
                </label>
                <input
                  type="text"
                  value={accessoriesIssued}
                  onChange={(e) => setAccessoriesIssued(e.target.value)}
                  placeholder="e.g. Phone, Fast Charger, Case"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>

            {/* Remarks */}
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Custody Remarks (Optional)
              </label>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Dispatched for off-site facility audit"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>

            {/* Physical Verification Mandatory Guard */}
            <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={physicallyVerified}
                  onChange={(e) => setPhysicallyVerified(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300 leading-tight">
                  <strong>Mandatory Physical Inspection:</strong> I confirm that I have physically inspected the device asset tag, IMEI, screen condition, and battery level before releasing custody.
                </span>
              </label>
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
                disabled={submitting || !physicallyVerified || !selectedPhoneId}
                className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow flex items-center space-x-1.5 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>Confirm & Issue Phone</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
