"use client";

import React, { useState } from "react";
import { X, Trash2, AlertTriangle, Loader2 } from "lucide-react";

interface DeleteEmployeeModalProps {
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

export function DeleteEmployeeModal({
  isOpen,
  onClose,
  onSuccess,
  employee,
}: DeleteEmployeeModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDelete = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to delete employee record.");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error communicating with the server.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Delete Employee Record
              </h3>
              <p className="text-xs text-slate-500">
                Permanent Personnel Deletion
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

        {/* Body */}
        <div className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete{" "}
              <strong className="text-slate-900 dark:text-white">
                {employee.firstName} {employee.lastName} ({employee.employeeCode})
              </strong>
              ?
            </p>

            <div className="p-3.5 rounded-xl bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 text-slate-600 dark:text-slate-300 space-y-1.5">
              <div className="font-semibold text-red-700 dark:text-red-400">
                Notice:
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                This action will delete the employee master record, unassign associated NFC credentials, release any active phones back to depot inventory, and clear child records. This cannot be undone.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Employee</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
