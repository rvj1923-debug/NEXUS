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
  Building2,
  FileSpreadsheet,
  CopyX,
  ScanSearch,
} from "lucide-react";
import * as XLSX from "xlsx";

interface RepeatingGroupSummary {
  key: string;
  code: string;
  name: string;
  repeatType: "EXACT_REPEAT" | "CODE_CONFLICT" | "NAME_CONFLICT";
  occurrences: number;
  firstRow: number;
  repeatRows: number[];
  details: string;
}

interface DepartmentValidationResult {
  rowNumber: number;
  data: {
    department_code: string;
    department_name: string;
    description?: string;
    supervisor_name?: string;
    supervisor_email?: string;
  };
  isValid: boolean;
  isRepeatingInFile: boolean;
  firstSeenRowNumber?: number;
  repeatedOnRows?: number[];
  action:
    | "CREATE"
    | "UPDATE"
    | "REACTIVATE"
    | "REPEAT_SKIPPED"
    | "REPEAT_ERROR"
    | "INVALID";
  errors: string[];
  warnings: string[];
}

interface BulkImportDepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkImportDepartmentModal({
  isOpen,
  onClose,
  onSuccess,
}: BulkImportDepartmentModalProps) {
  const [csvContent, setCsvContent] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [skipRepeating, setSkipRepeating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    totalRows: number;
    validCount: number;
    repeatingCount: number;
    repeatingGroups: RepeatingGroupSummary[];
    invalidCount: number;
    results: DepartmentValidationResult[];
  } | null>(null);

  if (!isOpen) return null;

  const runValidation = async (
    targetCsv: string,
    targetUpdateExisting: boolean,
    targetSkipRepeating: boolean
  ) => {
    if (!targetCsv.trim()) {
      setError("Please paste or upload department CSV/Excel content first.");
      return;
    }

    setError(null);
    setValidating(true);

    try {
      const res = await fetch("/api/departments/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: targetCsv,
          commit: false,
          updateExisting: targetUpdateExisting,
          skipRepeating: targetSkipRepeating,
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
        repeatingCount: data.repeatingCount || 0,
        repeatingGroups: data.repeatingGroups || [],
        invalidCount: data.invalidCount,
        results: data.results,
      });
      setValidating(false);
    } catch {
      setError("Network error scanning and validating department records.");
      setValidating(false);
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
          runValidation(convertedCsv, updateExisting, skipRepeating);
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
        runValidation(content, updateExisting, skipRepeating);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  // Deduplicate repeating rows directly from the current CSV/list
  const handleRemoveRepeatingRows = () => {
    if (!preview || preview.results.length === 0) return;

    const uniqueRows = preview.results.filter((r) => !r.isRepeatingInFile);
    const header = "department_code,department_name,description,supervisor_name,supervisor_email";
    const lines = uniqueRows.map((r) => {
      const escapeCsv = (val?: string) => {
        const v = (val || "").trim();
        if (v.includes(",") || v.includes('"') || v.includes("\n")) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      };
      return [
        escapeCsv(r.data.department_code),
        escapeCsv(r.data.department_name),
        escapeCsv(r.data.description),
        escapeCsv(r.data.supervisor_name),
        escapeCsv(r.data.supervisor_email),
      ].join(",");
    });

    const deduplicatedCsv = [header, ...lines].join("\n");
    setCsvContent(deduplicatedCsv);
    runValidation(deduplicatedCsv, updateExisting, skipRepeating);
  };

  const handleCommit = async () => {
    if (!csvContent.trim()) return;

    setError(null);
    setCommitting(true);

    try {
      const res = await fetch("/api/departments/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: csvContent,
          commit: true,
          updateExisting,
          skipRepeating,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Department bulk import failed");
        setCommitting(false);
        return;
      }

      setCommitting(false);
      setCsvContent("");
      setPreview(null);
      onSuccess();
      onClose();
    } catch {
      setError("Network error committing department import.");
      setCommitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-8 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/50 dark:bg-slate-850/50">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Bulk Department Import & Duplicate Scanner
              </h3>
              <p className="text-xs text-slate-500">
                Scan, validate repeating departments in file, and import Department Code / Initial (e.g. ITD) &amp; Name
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

          {/* Action Header: Download Template & Format Guide */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                Standard Department Import Template
              </span>
              <span className="text-[11px] text-slate-500 block">
                Required columns:{" "}
                <code className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  department_code
                </code>{" "}
                (or initial, e.g. <code className="font-mono">ITD</code>) and{" "}
                <code className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  department_name
                </code>{" "}
                (e.g. <code className="font-mono">Information Technology Department</code>)
              </span>
            </div>
            <a
              href="/api/departments/template"
              download="departments_import_template.csv"
              className="inline-flex items-center justify-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV Template</span>
            </a>
          </div>

          {/* File Upload Zone & Raw Text Paste */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Upload CSV / Excel (.xlsx) File or Paste Department List
              </label>
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipRepeating}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSkipRepeating(checked);
                      if (csvContent.trim()) {
                        runValidation(csvContent, updateExisting, checked);
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Auto-skip repeating rows in file</span>
                </label>

                <label className="inline-flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setUpdateExisting(checked);
                      if (csvContent.trim()) {
                        runValidation(csvContent, checked, skipRepeating);
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Update existing in DB</span>
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
                    "department_code,department_name,description,supervisor_name,supervisor_email\n" +
                    "ITD,Information Technology Department,IT Infrastructure and Systems Support,Roberto Mendoza,it.supervisor@company.com\n" +
                    "HRD,Human Resources Department,Personnel Administration and Relations,Maria Santos,hr.supervisor@company.com\n" +
                    "FIN,Finance and Accounting Department,Corporate Finance and Treasury,,\n" +
                    "ITD,Information Technology Department,Duplicate entry in file to test scanner,Roberto Mendoza,it.supervisor@company.com\n" +
                    "OPS,Operations and Logistics Department,Warehouse and Field Operations,,\n" +
                    "HRD,Human Resources Department,Repeated HR row in file,Maria Santos,hr.supervisor@company.com";
                  setCsvContent(sample);
                  runValidation(sample, updateExisting, skipRepeating);
                }}
                className="inline-flex items-center space-x-1 px-2.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Load Sample (with Repeating Rows)</span>
              </button>
            </div>

            <textarea
              rows={5}
              value={csvContent}
              onChange={(e) => {
                setCsvContent(e.target.value);
                setPreview(null);
              }}
              placeholder={
                "department_code,department_name,description,supervisor_name,supervisor_email\n" +
                "ITD,Information Technology Department,IT Infrastructure and Systems Support,Roberto Mendoza,it.supervisor@company.com\n" +
                "HRD,Human Resources Department,Personnel Administration,Maria Santos,hr.supervisor@company.com"
              }
              className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Tip: Uploading a file automatically scans all rows for repeating department codes and names.
            </p>
          </div>

          {/* Scan & Validation Trigger */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => runValidation(csvContent, updateExisting, skipRepeating)}
              disabled={validating || !csvContent.trim()}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center space-x-1.5 transition"
            >
              {validating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanSearch className="w-3.5 h-3.5" />
              )}
              <span>Scan &amp; Validate File</span>
            </button>
          </div>

          {/* Validation Results Preview */}
          {preview && (
            <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
              {/* Repeating Departments in File Alert Banner */}
              {preview.repeatingCount > 0 && (
                <div className="p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 space-y-3 animate-in fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start space-x-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                          Repeating Departments Detected in File ({preview.repeatingCount} Duplicate Row{preview.repeatingCount === 1 ? "" : "s"})
                        </h4>
                        <p className="text-[11px] text-amber-700 dark:text-amber-300/90">
                          The scanner found departments appearing multiple times within the uploaded file:
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemoveRepeatingRows}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition shrink-0 self-start sm:self-center"
                    >
                      <CopyX className="w-3.5 h-3.5" />
                      <span>Remove {preview.repeatingCount} Repeating Row{preview.repeatingCount === 1 ? "" : "s"}</span>
                    </button>
                  </div>

                  {preview.repeatingGroups.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5 pt-1">
                      {preview.repeatingGroups.map((g) => (
                        <div
                          key={g.key}
                          className="px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-amber-200/70 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                              {g.code}
                            </span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {g.name}
                            </span>
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              ({g.occurrences}x in file)
                            </span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 font-mono text-[10px]">
                            1st at Row #{g.firstRow} • Repeated at Row{" "}
                            {g.repeatRows.map((r) => `#${r}`).join(", ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Summary Counters */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Scan Results: {preview.totalRows} Total Rows Scanned
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{preview.validCount} Unique Valid</span>
                  </span>
                  {preview.repeatingCount > 0 && (
                    <span className="flex items-center space-x-1 text-amber-600 dark:text-amber-400 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{preview.repeatingCount} Repeating in File</span>
                    </span>
                  )}
                  {preview.invalidCount > 0 && (
                    <span className="flex items-center space-x-1 text-red-600 dark:text-red-400 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{preview.invalidCount} Blocked / Invalid</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Row-by-Row Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-h-64">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-500">
                    <tr>
                      <th className="p-2.5">Row</th>
                      <th className="p-2.5">Code / Initial</th>
                      <th className="p-2.5">Department Name</th>
                      <th className="p-2.5">Supervisor</th>
                      <th className="p-2.5">Scan &amp; Validation Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.results.map((r) => {
                      const rowBg = r.isRepeatingInFile
                        ? "bg-amber-50/50 dark:bg-amber-950/20"
                        : !r.isValid
                        ? "bg-red-50/40 dark:bg-red-950/20"
                        : "";

                      return (
                        <tr key={r.rowNumber} className={rowBg}>
                          <td className="p-2.5 font-mono text-slate-400">#{r.rowNumber}</td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] border ${
                                r.isRepeatingInFile
                                  ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                                  : "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                              }`}
                            >
                              {r.data.department_code || "—"}
                            </span>
                          </td>
                          <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            <div>{r.data.department_name || "—"}</div>
                            {r.data.description && (
                              <div className="text-[10px] font-normal text-slate-400">
                                {r.data.description}
                              </div>
                            )}
                          </td>
                          <td className="p-2.5 text-slate-500">
                            {r.data.supervisor_email ? (
                              <div>
                                <div className="font-medium text-slate-700 dark:text-slate-300">
                                  {r.data.supervisor_name || "Supervisor"}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400">
                                  {r.data.supervisor_email}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Optional</span>
                            )}
                          </td>
                          <td className="p-2.5 space-y-1">
                            {r.isValid ? (
                              <div className="space-y-1">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    r.action === "CREATE"
                                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                      : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                                  }`}
                                >
                                  {r.action === "CREATE"
                                    ? "Ready (New)"
                                    : r.action === "REACTIVATE"
                                    ? "Ready (Reactivate)"
                                    : "Ready (Update)"}
                                </span>
                                {r.warnings &&
                                  r.warnings.map((w, i) => (
                                    <div
                                      key={i}
                                      className="text-[10px] text-amber-600 dark:text-amber-400 font-medium"
                                    >
                                      • {w}
                                    </div>
                                  ))}
                              </div>
                            ) : r.action === "REPEAT_SKIPPED" ? (
                              <div className="space-y-0.5">
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                  Repeating in File (Skipped — Dup of Row #{r.firstSeenRowNumber})
                                </span>
                                {r.warnings.map((w, i) => (
                                  <div
                                    key={i}
                                    className="text-[10px] text-amber-700 dark:text-amber-400"
                                  >
                                    • {w}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {r.isRepeatingInFile && (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 mb-0.5">
                                    Repeating in File (Dup of Row #{r.firstSeenRowNumber})
                                  </span>
                                )}
                                <div className="space-y-0.5 text-red-600 dark:text-red-400 font-medium">
                                  {r.errors.map((err, i) => (
                                    <div key={i}>• {err}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
            <span>Commit {preview ? preview.validCount : 0} Unique Valid Departments</span>
          </button>
        </div>
      </div>
    </div>
  );
}
