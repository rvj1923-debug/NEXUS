"use client";

import React, { useState } from "react";
import {
  X,
  UploadCloud,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Mail,
  FileSpreadsheet,
  ScanSearch,
  RefreshCw,
} from "lucide-react";
import * as XLSX from "xlsx";

interface SupervisorBulkImportRow {
  department_code: string;
  department_name?: string;
  supervisor_1_name?: string;
  supervisor_1_email?: string;
  supervisor_2_name?: string;
  supervisor_2_email?: string;
}

interface SupervisorBulkValidationResult {
  rowNumber: number;
  data: SupervisorBulkImportRow;
  resolvedDepartmentName: string;
  combinedSupervisorName: string | null;
  combinedSupervisorEmail: string | null;
  previousSupervisorName: string | null;
  previousSupervisorEmail: string | null;
  isValid: boolean;
  action: "UPDATE" | "CREATE_DEPT" | "MERGED_INTO_FIRST" | "INVALID";
  errors: string[];
  warnings: string[];
}

interface BulkImportSupervisorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkImportSupervisorsModal({
  isOpen,
  onClose,
  onSuccess,
}: BulkImportSupervisorsModalProps) {
  const [csvContent, setCsvContent] = useState("");
  const [createMissingDepts, setCreateMissingDepts] = useState(true);
  const [mergeDuplicateCodeRows, setMergeDuplicateCodeRows] = useState(true);
  const [validating, setValidating] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    totalRows: number;
    validCount: number;
    mergedCount: number;
    invalidCount: number;
    results: SupervisorBulkValidationResult[];
  } | null>(null);

  if (!isOpen) return null;

  const runValidation = async (
    targetCsv: string,
    targetCreateMissing: boolean,
    targetMergeDuplicates: boolean
  ) => {
    if (!targetCsv.trim()) {
      setError("Please paste or upload supervisor CSV/Excel content first.");
      return;
    }

    setError(null);
    setValidating(true);

    try {
      const res = await fetch("/api/departments/bulk-import-supervisors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: targetCsv,
          commit: false,
          createMissingDepts: targetCreateMissing,
          mergeDuplicateCodeRows: targetMergeDuplicates,
        }),
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
        mergedCount: data.mergedCount || 0,
        invalidCount: data.invalidCount,
        results: data.results || [],
      });
      setValidating(false);
    } catch {
      setError("Network error validating supervisor bulk import records.");
      setValidating(false);
    }
  };

  const handleLoadCurrentDepartments = async () => {
    setError(null);
    setLoadingTemplate(true);
    try {
      const res = await fetch("/api/departments/supervisors-template");
      if (!res.ok) {
        throw new Error("Failed to load current departments template");
      }
      const text = await res.text();
      setCsvContent(text);
      await runValidation(text, createMissingDepts, mergeDuplicateCodeRows);
    } catch (err: any) {
      setError(err?.message || "Failed to load current department codes.");
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const convertedCsv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
          setCsvContent(convertedCsv);
          setError(null);
          runValidation(convertedCsv, createMissingDepts, mergeDuplicateCodeRows);
        } catch {
          setError("Failed to parse Excel file. Please upload a valid .xlsx, .xls, or .csv file.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCsvContent(content);
        setError(null);
        runValidation(content, createMissingDepts, mergeDuplicateCodeRows);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const handleCommit = async () => {
    if (!csvContent.trim()) return;

    setError(null);
    setCommitting(true);

    try {
      const res = await fetch("/api/departments/bulk-import-supervisors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: csvContent,
          commit: true,
          createMissingDepts,
          mergeDuplicateCodeRows,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Bulk supervisor import failed");
        setCommitting(false);
        return;
      }

      setCommitting(false);
      setCsvContent("");
      setPreview(null);
      onSuccess();
      onClose();
    } catch {
      setError("Network error committing supervisor bulk import.");
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-8 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/50 dark:bg-slate-850/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Bulk Import Supervisors by Department Code
              </h3>
              <p className="text-xs text-slate-500">
                Assign or update 1 or 2 supervisors per department using <code className="font-mono font-bold">department_code</code> (e.g. ITD, HRD, FIN)
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

          {/* Template & Format Guide */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-800/60">
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                Department Code Supervisor Template (Supports 1 or 2 Supervisors + Installer Auto-Update)
              </span>
              <span className="text-[11px] text-slate-600 dark:text-slate-400 block">
                Columns:{" "}
                <code className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  department_code
                </code>
                ,{" "}
                <code className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  supervisor_1_name
                </code>
                ,{" "}
                <code className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  supervisor_1_email
                </code>
                ,{" "}
                <code className="font-mono text-slate-500">
                  supervisor_2_name
                </code>
                ,{" "}
                <code className="font-mono text-slate-500">
                  supervisor_2_email
                </code>{" "}
                (also compatible with <code className="font-mono">supervisors.csv</code> during installer upgrades).
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleLoadCurrentDepartments}
                disabled={loadingTemplate}
                className="inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition disabled:opacity-50"
              >
                {loadingTemplate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Load Current Depts</span>
              </button>
              <a
                href="/api/departments/supervisors-template"
                download="supervisors.csv"
                className="inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download supervisors.csv</span>
              </a>
            </div>
          </div>

          {/* Upload & Options */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Upload CSV / Excel (.xlsx) or Paste Supervisor Rows by Department Code
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mergeDuplicateCodeRows}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setMergeDuplicateCodeRows(checked);
                      if (csvContent.trim()) {
                        runValidation(csvContent, createMissingDepts, checked);
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Merge duplicate dept codes as 2nd supervisor</span>
                </label>

                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createMissingDepts}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setCreateMissingDepts(checked);
                      if (csvContent.trim()) {
                        runValidation(csvContent, checked, mergeDuplicateCodeRows);
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Auto-create missing department codes</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 mb-2.5">
              <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition">
                <UploadCloud className="w-4 h-4" />
                <span>Choose File (.csv, .xlsx, .xls)</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  const sample =
                    "department_code,supervisor_1_name,supervisor_1_email,supervisor_2_name,supervisor_2_email\n" +
                    "ITD,Johnmark,johnmark@pbi.com.ph,Itsupport,itsupport.pbi@gmail.com\n" +
                    "HRD,Maria Santos,hr.supervisor@company.com,Ana Reyes,hr.assistant@company.com\n" +
                    "FIN,Carlos Lim,finance.head@company.com,,";
                  setCsvContent(sample);
                  runValidation(sample, createMissingDepts, mergeDuplicateCodeRows);
                }}
                className="inline-flex items-center space-x-1 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Load Sample CSV</span>
              </button>
            </div>

            <textarea
              rows={6}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setPreview(null);
              }}
              placeholder={
                "department_code,supervisor_1_name,supervisor_1_email,supervisor_2_name,supervisor_2_email\n" +
                "ITD,Johnmark,johnmark@pbi.com.ph,Itsupport,itsupport.pbi@gmail.com\n" +
                "HRD,Maria Santos,hr.supervisor@company.com,,"
              }
              className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Tip: You can also save this CSV as <code className="font-mono">supervisors.csv</code> next to <code className="font-mono">PhoneTrackerSetup.exe</code> (or select it inside the installer wizard) to automatically apply supervisor updates during an installer upgrade.
            </p>
          </div>

          {/* Validate Button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => runValidation(csvContent, createMissingDepts, mergeDuplicateCodeRows)}
              disabled={validating || !csvContent.trim()}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center space-x-1.5 transition"
            >
              {validating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanSearch className="w-3.5 h-3.5" />
              )}
              <span>Validate Supervisor Mapping</span>
            </button>
          </div>

          {/* Preview Results */}
          {preview && (
            <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Validation Summary: {preview.totalRows} Row{preview.totalRows === 1 ? "" : "s"} Scanned
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{preview.validCount} Ready to Apply</span>
                  </span>
                  {preview.mergedCount > 0 && (
                    <span className="flex items-center space-x-1 text-indigo-600 dark:text-indigo-400 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{preview.mergedCount} Merged as 2nd Supervisor</span>
                    </span>
                  )}
                  {preview.invalidCount > 0 && (
                    <span className="flex items-center space-x-1 text-red-600 dark:text-red-400 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{preview.invalidCount} Invalid</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-h-64">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                    <tr>
                      <th className="p-2.5">Row</th>
                      <th className="p-2.5">Dept Code</th>
                      <th className="p-2.5">Department</th>
                      <th className="p-2.5">Supervisor 1 &amp; 2 (New)</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.results.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={
                          r.action === "INVALID"
                            ? "bg-red-50/40 dark:bg-red-950/20"
                            : r.action === "MERGED_INTO_FIRST"
                            ? "bg-indigo-50/30 dark:bg-indigo-950/10"
                            : ""
                        }
                      >
                        <td className="p-2.5 font-mono text-slate-400">#{r.rowNumber}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                            {r.data.department_code || "—"}
                          </span>
                        </td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">
                          {r.resolvedDepartmentName}
                        </td>
                        <td className="p-2.5">
                          {r.combinedSupervisorEmail || r.combinedSupervisorName ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">
                                {r.combinedSupervisorName || "Supervisor"}
                              </div>
                              <div className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                                {r.combinedSupervisorEmail || "No email"}
                              </div>
                              {r.previousSupervisorEmail &&
                                r.previousSupervisorEmail !== r.combinedSupervisorEmail && (
                                  <div className="text-[10px] text-slate-400">
                                    Prev: {r.previousSupervisorEmail}
                                  </div>
                                )}
                            </div>
                          ) : (
                            <span className="italic text-slate-400">Cleared / None</span>
                          )}
                        </td>
                        <td className="p-2.5 space-y-1">
                          {r.isValid ? (
                            <div className="space-y-0.5">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  r.action === "CREATE_DEPT"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                                }`}
                              >
                                {r.action === "CREATE_DEPT"
                                  ? "Ready (New Dept + Supervisors)"
                                  : "Ready (Update Supervisors)"}
                              </span>
                              {r.warnings.map((w, i) => (
                                <div key={i} className="text-[10px] text-amber-600 dark:text-amber-400">
                                  • {w}
                                </div>
                              ))}
                            </div>
                          ) : r.action === "MERGED_INTO_FIRST" ? (
                            <div className="space-y-0.5">
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                                Merged into 1st Row
                              </span>
                              {r.warnings.map((w, i) => (
                                <div key={i} className="text-[10px] text-indigo-600 dark:text-indigo-400">
                                  • {w}
                                </div>
                              ))}
                            </div>
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
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
          >
            {committing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>Update {preview ? preview.validCount : 0} Department Supervisor(s)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
