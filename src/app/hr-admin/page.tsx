"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Smartphone,
  User,
  Mail,
  FileCheck2,
  AlertCircle,
  Clock,
  Loader2,
  ChevronRight,
  ArrowLeft,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

interface OverdueCaseItem {
  id: string;
  caseNumber: string;
  status: string;
  minutesOverdue: number;
  detectedAt: string;
  resolvedAt?: string | null;
  supervisorEmail?: string | null;
  overtimeApprovalStatus: "PENDING" | "APPROVED" | "NOT_APPROVED";
  supervisorReviewedBy?: string | null;
  supervisorReviewedAt?: string | null;
  supervisorRemarks?: string | null;
  hrEmail?: string | null;
  hrEmailSentAt?: string | null;
  incidentReportIssued?: boolean;
  incidentRemovedByHr?: boolean;
  incidentStatusLabel?: string;
  hrClearedBy?: string | null;
  hrClearedAt?: string | null;
  hrClearanceRemarks?: string | null;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department?: {
      name: string;
      code?: string;
      supervisorName?: string | null;
      supervisorEmail?: string | null;
    } | null;
  } | null;
  phoneAsset?: {
    id: string;
    assetTag: string;
    brand: string;
    model: string;
    imei?: string | null;
  } | null;
  custodyTransaction?: {
    id: string;
    transactionCode: string;
    timestamp: string;
    returnDeadlineAt?: string | null;
    nfcCard?: {
      cardUid: string;
      cardNumber?: string | null;
    } | null;
  } | null;
}

function formatDateTime(dt?: string | null): string {
  if (!dt) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: COMPANY_TIMEZONE,
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(dt));
  } catch {
    return dt;
  }
}

function HrAdminContent() {
  const searchParams = useSearchParams();
  const caseIdParam = searchParams.get("caseId") || searchParams.get("hrClearCaseId");

  const [cases, setCases] = useState<OverdueCaseItem[]>([]);
  const [selectedCase, setSelectedCase] = useState<OverdueCaseItem | null>(null);
  const [defaultHrEmail, setDefaultHrEmail] = useState("hr@company.com");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // HR Clearance Form Fields
  const [hrOfficerName, setHrOfficerName] = useState("HR Department Admin");
  const [hrEmail, setHrEmail] = useState("hr@company.com");
  const [remarks, setRemarks] = useState(
    "Reviewed by HR Department — INCIDENT REPORT ISSUED removed from employee record."
  );

  const selectCaseItem = (c: OverdueCaseItem, fallbackHr = "hr@company.com") => {
    setSelectedCase(c);
    setError(null);
    setHrEmail(c.hrEmail || fallbackHr || "hr@company.com");
    if (c.hrClearedBy) {
      setHrOfficerName(c.hrClearedBy.replace(/\s*\(.*\)$/, "") || "HR Department Admin");
    }
    if (c.hrClearanceRemarks) {
      setRemarks(c.hrClearanceRemarks);
    } else {
      setRemarks(
        "Reviewed by HR Department — INCIDENT REPORT ISSUED removed from employee record."
      );
    }
  };

  const loadCases = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overdue?status=ALL");
      if (!res.ok) {
        throw new Error("Could not load overdue cases.");
      }
      const data = await res.json();
      const loadedCases: OverdueCaseItem[] = data.cases || [];
      const hr = data.defaultHrEmail || "hr@company.com";
      setCases(loadedCases);
      setDefaultHrEmail(hr);

      if (caseIdParam) {
        const found = loadedCases.find(
          (item) => item.id === caseIdParam || item.caseNumber === caseIdParam
        );
        if (found) {
          selectCaseItem(found, hr);
        } else {
          const singleRes = await fetch(`/api/overdue/${caseIdParam}`);
          if (singleRes.ok) {
            const singleData = await singleRes.json();
            selectCaseItem(singleData, hr);
          } else {
            setError(`Overdue case '${caseIdParam}' was not found. Please select a case below.`);
          }
        }
      } else if (selectedCase) {
        const refreshed = loadedCases.find((item) => item.id === selectedCase.id);
        if (refreshed) {
          setSelectedCase(refreshed);
        }
      } else if (loadedCases.length === 1) {
        selectCaseItem(loadedCases[0], hr);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load overdue case details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [caseIdParam]);

  const handleRemoveIncidentReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;

    setError(null);
    setSuccessMessage(null);

    if (!hrOfficerName.trim() || hrOfficerName.trim().length < 2) {
      setError("Please enter your HR Officer / Admin name.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/overdue/hr-remove-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          hrOfficerName: hrOfficerName.trim(),
          hrEmail: hrEmail.trim() || defaultHrEmail,
          remarks:
            remarks.trim() ||
            "Reviewed by HR Department — INCIDENT REPORT ISSUED removed from employee record.",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove INCIDENT REPORT ISSUED.");
        setSubmitting(false);
        return;
      }

      const empName = selectedCase.employee
        ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
        : "Employee";

      setSuccessMessage(
        `"INCIDENT REPORT ISSUED" has been removed from ${empName} (${
          selectedCase.employee?.employeeCode || "N/A"
        }) by HR (${hrOfficerName.trim()}).`
      );
      setSubmitting(false);
      await loadCases();
    } catch (err: any) {
      setError(err.message || "Network error while removing incident report.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 py-6 px-4 sm:px-6 flex flex-col items-center">
      <div className="w-full max-w-2xl space-y-4">
        {/* Top HR Admin Brand Banner */}
        <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-indigo-950 text-white rounded-2xl p-5 shadow-lg border border-rose-800/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-rose-600/30 border border-rose-400/40 text-rose-300">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-rose-300 font-semibold">
                  NEXUS • HR Department Admin Portal
                </div>
                <h1 className="text-base sm:text-lg font-bold leading-snug">
                  Overdue Phone Incident Report Clearance
                </h1>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Link
                href="/overdue"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition"
              >
                <span>Admin Overdue Dashboard</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/employees"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition"
              >
                <span>Employees</span>
              </Link>
            </div>
          </div>
          <p className="text-xs text-slate-300 mt-2.5 leading-relaxed">
            Human Resources (HR) Department Admin: Review 24-hour overdue phone reports forwarded to HR and remove the{" "}
            <strong className="text-rose-300">INCIDENT REPORT ISSUED</strong> status on the employee.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs flex items-start space-x-2.5 shadow-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 space-y-2 shadow-sm">
            <div className="flex items-center space-x-2 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Incident Report Issued Removed Successfully!</span>
            </div>
            <p className="text-xs leading-relaxed">{successMessage}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3 shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
            <span className="text-xs text-slate-500">
              Loading HR overdue phone &amp; incident reports...
            </span>
          </div>
        ) : !selectedCase ? (
          /* Case Selector List */
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Employees with Overdue Phone Reports (HR Queue)
                </h2>
                <p className="text-xs text-slate-500">
                  Select an employee below to review and remove their{" "}
                  <strong>INCIDENT REPORT ISSUED</strong> status
                </p>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                {cases.filter((c) => c.incidentReportIssued).length} Active Incident
                {cases.filter((c) => c.incidentReportIssued).length === 1 ? "" : "s"}
              </span>
            </div>

            {cases.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No Overdue Phone Incident Reports Found
                </div>
                <p className="text-xs text-slate-500">
                  There are currently no employees with an active overdue phone incident report.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {cases.map((c) => {
                  const empName = c.employee
                    ? `${c.employee.firstName} ${c.employee.lastName}`
                    : "Assigned Employee";
                  const deptName = c.employee?.department?.name || "General Department";
                  const assetTag =
                    c.phoneAsset?.assetTag ||
                    c.custodyTransaction?.nfcCard?.cardNumber ||
                    c.custodyTransaction?.nfcCard?.cardUid ||
                    "Company Phone";

                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSuccessMessage(null);
                        selectCaseItem(c, defaultHrEmail);
                      }}
                      className="w-full py-3.5 px-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                            {c.caseNumber}
                          </span>
                          {c.incidentReportIssued ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-600 text-white uppercase tracking-wide">
                              🚨 INCIDENT REPORT ISSUED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                              ✓ INCIDENT REPORT REMOVED BY HR
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              c.overtimeApprovalStatus === "APPROVED"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : c.overtimeApprovalStatus === "NOT_APPROVED"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            Supervisor: {c.overtimeApprovalStatus}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {empName} ({c.employee?.employeeCode || "N/A"}) •{" "}
                          <span className="font-mono text-indigo-600 dark:text-indigo-400">
                            {assetTag}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {deptName} • Timed In: {formatDateTime(c.custodyTransaction?.timestamp)}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Selected Employee Incident Clearance Card */
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Case Summary Header */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 rounded-lg font-mono text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                    Case: {selectedCase.caseNumber}
                  </span>
                  {selectedCase.incidentReportIssued ? (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-rose-600 text-white shadow-sm">
                      🚨 INCIDENT REPORT ISSUED
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white shadow-sm">
                      ✓ INCIDENT REPORT REMOVED BY HR
                    </span>
                  )}
                </div>

                {cases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCase(null);
                      setSuccessMessage(null);
                    }}
                    className="inline-flex items-center space-x-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>All Cases ({cases.length})</span>
                  </button>
                )}
              </div>

              {/* Employee & Phone Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1">
                    <User className="w-3 h-3" />
                    <span>Employee with Overdue Phone</span>
                  </div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white mt-1">
                    {selectedCase.employee
                      ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
                      : "Assigned Employee"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {selectedCase.employee?.employeeCode} •{" "}
                    {selectedCase.employee?.department?.name || "Operations"}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center space-x-1">
                    <Smartphone className="w-3 h-3" />
                    <span>Overdue Company Phone</span>
                  </div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white mt-1 font-mono">
                    {selectedCase.phoneAsset?.assetTag ||
                      selectedCase.custodyTransaction?.nfcCard?.cardNumber ||
                      selectedCase.custodyTransaction?.nfcCard?.cardUid ||
                      "Company Phone"}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Timed In: {formatDateTime(selectedCase.custodyTransaction?.timestamp)} (+
                    {selectedCase.minutesOverdue}m past 24h)
                  </div>
                </div>
              </div>

              {/* Supervisor Overtime Report Box */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    Supervisor Overtime Decision (Emailed to HR):
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                      selectedCase.overtimeApprovalStatus === "APPROVED"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : selectedCase.overtimeApprovalStatus === "NOT_APPROVED"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                    }`}
                  >
                    {selectedCase.overtimeApprovalStatus}
                  </span>
                </div>
                {selectedCase.supervisorReviewedBy && (
                  <div className="text-[11px] text-slate-500">
                    Reviewed by: <strong>{selectedCase.supervisorReviewedBy}</strong> (
                    {selectedCase.supervisorEmail}) on{" "}
                    {formatDateTime(selectedCase.supervisorReviewedAt)}
                  </div>
                )}
                {selectedCase.supervisorRemarks && (
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 italic text-[11px]">
                    &ldquo;{selectedCase.supervisorRemarks}&rdquo;
                  </div>
                )}
              </div>
            </div>

            {/* HR Action Body */}
            <div className="p-5 space-y-4">
              {selectedCase.incidentReportIssued ? (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-500/80 text-rose-900 dark:text-rose-200 text-xs space-y-1">
                  <div className="font-extrabold text-sm flex items-center space-x-2 text-rose-700 dark:text-rose-300">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>ACTIVE EMPLOYEE FLAG: INCIDENT REPORT ISSUED</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    This employee currently has an active <strong>INCIDENT REPORT ISSUED</strong>{" "}
                    record for an overdue company phone. Complete the HR clearance below to remove{" "}
                    <strong>INCIDENT REPORT ISSUED</strong> from this employee.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs space-y-1">
                  <div className="font-bold text-sm flex items-center space-x-2 text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>INCIDENT REPORT ISSUED HAS BEEN REMOVED BY HR</span>
                  </div>
                  {selectedCase.hrClearedBy && (
                    <p className="text-[11px]">
                      Removed by: <strong>{selectedCase.hrClearedBy}</strong>{" "}
                      {selectedCase.hrClearedAt ? `on ${selectedCase.hrClearedAt}` : ""}
                    </p>
                  )}
                  {selectedCase.hrClearanceRemarks && (
                    <p className="text-[11px] italic">
                      HR Remarks: &ldquo;{selectedCase.hrClearanceRemarks}&rdquo;
                    </p>
                  )}
                </div>
              )}

              <form onSubmit={handleRemoveIncidentReport} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      HR Officer / Admin Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={hrOfficerName}
                      onChange={(e) => setHrOfficerName(e.target.value)}
                      placeholder="e.g. HR Department Admin"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      HR Department Email <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={hrEmail}
                      onChange={(e) => setHrEmail(e.target.value)}
                      placeholder="hr@company.com"
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    HR Clearance / Removal Notes
                  </label>
                  <textarea
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Enter HR clearance remarks..."
                    className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs shadow-md transition flex items-center justify-center space-x-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Removing INCIDENT REPORT ISSUED...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>
                        Remove &ldquo;INCIDENT REPORT ISSUED&rdquo; on{" "}
                        {selectedCase.employee
                          ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
                          : "Employee"}
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HrAdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
          <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
        </div>
      }
    >
      <HrAdminContent />
    </Suspense>
  );
}
