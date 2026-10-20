"use client";

import React, { useState } from "react";
import { X, UploadCloud, Download, CheckCircle2, AlertCircle, Loader2, Smartphone } from "lucide-react";

interface PhoneValidationResult {
  rowNumber: number;
  data: Record<string, string>;
  isValid: boolean;
  errors: string[];
}

interface BulkImportPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkImportPhoneModal({ isOpen, onClose, onSuccess }: BulkImportPhoneModalProps) {
  const [csvContent, setCsvContent] = useState("");
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    totalRows: number;
    validCount: number;
    invalidCount: number;
    results: PhoneValidationResult[];
  } | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
      setPreview(null);
      setError(null);
    };
    reader.readAsText(file);
  };

  const handleValidate = async () => {
    if (!csvContent.trim()) {
      setError("Please paste or upload CSV content first.");
      return;
    }

    setError(null);
    setValidating(true);

    try {
      const res = await fetch("/api/phones/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvContent, commit: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Validation failed");
        setValidating(false);
        return;
      }

      setPreview({
        totalRows: data.totalRows,
        validCount: data.validCount,
        invalidCount: data.invalidCount,
        results: data.results,
      });
      setValidating(false);
    } catch {
      setError("Network error validating file.");
      setValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!csvContent.trim()) return;

    setError(null);
    setCommitting(true);

    try {
      const res = await fetch("/api/phones/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvContent, commit: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        setCommitting(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error committing import.");
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Bulk Phone Asset Import Wizard
              </h3>
              <p className="text-xs text-slate-500">
                Validate and batch-enroll mobile inventory with IMEI duplicate detection
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

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Header: Download Template & File Input */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                Standard Phone Import Template
              </span>
              <span className="text-[11px] text-slate-500">
                Download the official CSV format containing required IMEI, brand, model headers
              </span>
            </div>
            <a
              href="/api/phones/template"
              download="phones_import_template.csv"
              className="inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV Template</span>
            </a>
          </div>

          {/* File Upload Zone */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Upload CSV File or Paste Raw Content
            </label>
            <div className="flex items-center gap-3 mb-2">
              <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100">
                <UploadCloud className="w-4 h-4" />
                <span>Choose File (.csv)</span>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            <textarea
              rows={5}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setPreview(null);
              }}
              placeholder="asset_tag,brand,model,imei,imei2,serial_number,department_code,condition,accessories,mobile_number&#10;MOB-101,OUKITEL,OUKITEL G1,354892019283741,,SN99283741,OPS,EXCELLENT,Charger + Case,+1-555-0101"
              className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Validation Trigger */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleValidate}
              disabled={validating || !csvContent.trim()}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 flex items-center space-x-1.5"
            >
              {validating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Validate Records</span>
            </button>
          </div>

          {/* Validation Results Preview */}
          {preview && (
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Validation Results: {preview.totalRows} Devices Processed
                </span>
                <div className="flex items-center space-x-3">
                  <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{preview.validCount} Valid</span>
                  </span>
                  {preview.invalidCount > 0 && (
                    <span className="flex items-center space-x-1 text-red-600 dark:text-red-400 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{preview.invalidCount} Invalid</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-h-60">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                    <tr>
                      <th className="p-2.5">Row</th>
                      <th className="p-2.5">Tag</th>
                      <th className="p-2.5">Model</th>
                      <th className="p-2.5">IMEI</th>
                      <th className="p-2.5">Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.results.map((r) => (
                      <tr key={r.rowNumber} className={r.isValid ? "" : "bg-red-50/40 dark:bg-red-950/20"}>
                        <td className="p-2.5 font-mono text-slate-400">#{r.rowNumber}</td>
                        <td className="p-2.5 font-mono font-medium">{r.data.asset_tag || "—"}</td>
                        <td className="p-2.5">
                          {r.data.brand} {r.data.model}
                        </td>
                        <td className="p-2.5 font-mono">{r.data.imei || "—"}</td>
                        <td className="p-2.5">
                          {r.isValid ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Ready
                            </span>
                          ) : (
                            <div className="space-y-0.5 text-red-600 dark:text-red-400 font-medium">
                              {r.errors.map((err, i) => (
                                <div key={i}>• {err}</div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={!preview || preview.validCount === 0 || committing}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>Commit {preview ? preview.validCount : 0} Valid Devices</span>
          </button>
        </div>
      </div>
    </div>
  );
}
