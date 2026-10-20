"use client";

import React, { useState, useEffect } from "react";
import { X, Smartphone, UserCheck, AlertCircle, Loader2, Link as LinkIcon } from "lucide-react";

interface EmployeeOption {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  department?: { name: string; code: string } | null;
}

interface PhoneOption {
  id: string;
  assetTag: string;
  brand: string;
  model: string;
  custodyStatus: string;
  assignmentStatus: string;
}

interface NewAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedEmployeeId?: string;
  preselectedPhoneId?: string;
}

export function NewAssignmentModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedEmployeeId,
  preselectedPhoneId,
}: NewAssignmentModalProps) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [phones, setPhones] = useState<PhoneOption[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [employeeId, setEmployeeId] = useState(preselectedEmployeeId || "");
  const [phoneAssetId, setPhoneAssetId] = useState(preselectedPhoneId || "");
  const [assignmentType, setAssignmentType] = useState<"DEDICATED" | "POOL" | "ROTATIONAL">("DEDICATED");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setLoadingData(true);
      if (preselectedEmployeeId) setEmployeeId(preselectedEmployeeId);
      if (preselectedPhoneId) setPhoneAssetId(preselectedPhoneId);

      Promise.all([
        fetch("/api/employees?limit=200&status=ACTIVE").then((res) => res.json()),
        fetch("/api/phones?limit=200").then((res) => res.json()),
      ])
        .then(([empData, phoneData]) => {
          if (empData.employees) setEmployees(empData.employees);
          if (phoneData.phones) setPhones(phoneData.phones);
        })
        .catch(() => setError("Failed to load employees and phones"))
        .finally(() => setLoadingData(false));
    }
  }, [isOpen, preselectedEmployeeId, preselectedPhoneId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      setError("Please select an employee.");
      return;
    }
    if (!phoneAssetId) {
      setError("Please select a phone asset.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          phoneAssetId,
          assignmentType,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create assignment");
        setSubmitting(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error creating assignment");
      setSubmitting(false);
    }
  };

  const selectedPhone = phones.find((p) => p.id === phoneAssetId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
              <LinkIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Designate Phone Assignment
              </h3>
              <p className="text-xs text-slate-500">
                Establish standing primary allocation between employee and device
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

          {loadingData ? (
            <div className="py-8 flex flex-col items-center justify-center text-slate-400 text-xs space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
              <span>Loading current inventory and roster...</span>
            </div>
          ) : (
            <>
              {/* Employee Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Assignee Employee <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select Employee...</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.employeeCode} — {emp.firstName} {emp.lastName}{" "}
                        {emp.department ? `(${emp.department.name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Phone Asset Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target Phone Asset <span className="text-red-500">*</span>
                </label>
                <select
                  value={phoneAssetId}
                  onChange={(e) => setPhoneAssetId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Select Device...</option>
                  {phones.map((p) => {
                    const isIssued = p.custodyStatus === "ISSUED";
                    const isAssigned = p.assignmentStatus === "ASSIGNED";
                    return (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={isIssued}
                        className={isIssued ? "text-slate-400" : ""}
                      >
                        {p.assetTag}{" "}
                        {isIssued ? "[PHYSICALLY OUTSTANDING]" : isAssigned ? "[Currently Assigned]" : "[Available]"}
                      </option>
                    );
                  })}
                </select>

                {selectedPhone && selectedPhone.custodyStatus === "ISSUED" && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 flex items-center space-x-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Warning: Phone is currently checked out in active custody and cannot be assigned.</span>
                  </p>
                )}
              </div>

              {/* Assignment Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Assignment Policy Type
                </label>
                <select
                  value={assignmentType}
                  onChange={(e) =>
                    setAssignmentType(e.target.value as "DEDICATED" | "POOL" | "ROTATIONAL")
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="DEDICATED">Dedicated Standing Device (1-to-1)</option>
                  <option value="POOL">Shared Departmental Pool Device</option>
                  <option value="ROTATIONAL">Shift Rotational Device</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Dedicated devices restrict duplicate standing assignments across employees.
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Allocation Remarks / Justification
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Field operations manager deployment, authorized by HR"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </>
          )}

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
              disabled={submitting || loadingData || (selectedPhone?.custodyStatus === "ISSUED")}
              className="px-5 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              <span>Confirm Assignment</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
