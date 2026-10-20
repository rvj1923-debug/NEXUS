"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  Smartphone,
  User,
  Mail,
  FileCheck2,
  Send,
  AlertCircle,
  Building2,
  Clock,
  Loader2,
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";
import { parseSupervisors } from "@/lib/supervisors";

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
    supervisor?: {
      firstName: string;
      lastName: string;
      email?: string | null;
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

function SupervisorFormContent() {
  const searchParams = useSearchParams();
  const caseIdParam =
    searchParams.get("caseId") ||
    searchParams.get("reviewCaseId") ||
    searchParams.get("ref");
  const decisionParam = searchParams.get("decision");

  const [cases, setCases] = useState<OverdueCaseItem[]>([]);
  const [selectedCase, setSelectedCase] = useState<OverdueCaseItem | null>(null);
  const [defaultHrEmail, setDefaultHrEmail] = useState("hr@company.com");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [decision, setDecision] = useState<"APPROVED" | "NOT_APPROVED">("APPROVED");
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisorRemarks, setSupervisorRemarks] = useState("");
  const [hrEmail, setHrEmail] = useState("hr@company.com");

  const populateFormFromCase = (c: OverdueCaseItem, fallbackHr = "hr@company.com") => {
    setSelectedCase(c);
    setSubmittedSuccess(null);
    setError(null);

    const normalizedDecisionParam = (decisionParam || "").toUpperCase();
    if (
      normalizedDecisionParam === "NOT_APPROVED" ||
      normalizedDecisionParam === "UNEXCUSED" ||
      normalizedDecisionParam === "DISAPPROVED"
    ) {
      setDecision("NOT_APPROVED");
    } else if (normalizedDecisionParam === "APPROVED" || normalizedDecisionParam === "EXCUSED") {
      setDecision("APPROVED");
    } else {
      setDecision(c.overtimeApprovalStatus === "NOT_APPROVED" ? "NOT_APPROVED" : "APPROVED");
    }

    const urlSupName = searchParams.get("sup") || "";
    const urlSupEmail = searchParams.get("supEmail") || "";

    const resolvedName =
      c.supervisorReviewedBy ||
      c.employee?.department?.supervisorName ||
      (c.employee?.supervisor
        ? `${c.employee.supervisor.firstName} ${c.employee.supervisor.lastName}`.trim()
        : "") ||
      urlSupName ||
      `${c.employee?.department?.name || "Department"} Supervisor`;

    const resolvedEmail =
      c.supervisorEmail ||
      c.employee?.department?.supervisorEmail ||
      c.employee?.supervisor?.email ||
      urlSupEmail ||
      "";

    setSupervisorName(resolvedName);
    setSupervisorEmail(resolvedEmail);
    setSupervisorRemarks(c.supervisorRemarks || "");
    const effectiveHr =
      c.hrEmail && c.hrEmail !== "hr@company.com"
        ? c.hrEmail
        : fallbackHr || "hr@company.com";
    setHrEmail(effectiveHr);
  };

  const buildFallbackCaseFromParams = (): OverdueCaseItem | null => {
    const empParam = searchParams.get("emp");
    const assetParam = searchParams.get("asset");
    if (!caseIdParam || (!empParam && !assetParam)) return null;

    const nameParts = (empParam || "Assigned Employee").trim().split(/\s+/);
    const firstName = nameParts[0] || "Assigned";
    const lastName = nameParts.slice(1).join(" ") || "";
    const hoursParam = parseInt(searchParams.get("hours") || "24", 10) || 24;
    const refParam = searchParams.get("ref") || caseIdParam;

    return {
      id: caseIdParam,
      caseNumber: refParam.replace(/^INC-/i, ""),
      status: "OPEN",
      minutesOverdue: Math.max(60, (hoursParam - 24) * 60),
      detectedAt: new Date().toISOString(),
      supervisorEmail: searchParams.get("supEmail") || null,
      overtimeApprovalStatus: "PENDING",
      employee: {
        id: "emp-url",
        firstName,
        lastName,
        employeeCode: searchParams.get("code") || "N/A",
        department: {
          name: searchParams.get("dept") || "Operations",
          supervisorName: searchParams.get("sup") || null,
          supervisorEmail: searchParams.get("supEmail") || null,
        },
      },
      phoneAsset: {
        id: "phone-url",
        assetTag: assetParam || "Company Phone",
        brand: searchParams.get("model") || "",
        model: "",
      },
      custodyTransaction: {
        id: "tx-url",
        transactionCode: refParam,
        timestamp: searchParams.get("timedIn") || new Date().toISOString(),
      },
    };
  };

  const loadCases = async () => {
    setError(null);

    // 1. If URL query params carry incident metadata, pre-populate immediately so the form shows in 0ms
    const fallbackFromUrl = buildFallbackCaseFromParams();
    if (fallbackFromUrl && !selectedCase) {
      populateFormFromCase(fallbackFromUrl, defaultHrEmail);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      // 2. If a specific caseId was clicked in the email, fetch that single case directly first (<10ms)
      let matchedSingle = false;
      if (caseIdParam) {
        try {
          const singleRes = await fetch(`/api/overdue/${encodeURIComponent(caseIdParam)}`);
          if (singleRes.ok) {
            const singleData = await singleRes.json();
            const hr = singleData.defaultHrEmail || "hr@company.com";
            setDefaultHrEmail(hr);
            populateFormFromCase(singleData, hr);
            matchedSingle = true;
            setLoading(false);
          }
        } catch {
          // Will fall back to full list fetch below
        }
      }

      // 3. Fetch full overdue case list (for case switcher or when accessed without ?caseId=...)
      const res = await fetch("/api/overdue?status=ALL");
      if (!res.ok) {
        if (!matchedSingle && !fallbackFromUrl) {
          throw new Error("Could not load overdue cases.");
        }
        return;
      }
      const data = await res.json();
      const loadedCases: OverdueCaseItem[] = data.cases || [];
      const hr = data.defaultHrEmail || "hr@company.com";
      setCases(loadedCases);
      setDefaultHrEmail(hr);

      if (!matchedSingle) {
        if (caseIdParam) {
          const cleanParam = caseIdParam.replace(/^INC-/i, "");
          const found = loadedCases.find(
            (item) =>
              item.id === caseIdParam ||
              item.caseNumber === caseIdParam ||
              item.caseNumber === cleanParam
          );
          if (found) {
            populateFormFromCase(found, hr);
          } else if (!fallbackFromUrl) {
            setError(`Overdue case '${caseIdParam}' was not found. Please select a case below.`);
          }
        } else if (loadedCases.length === 1) {
          populateFormFromCase(loadedCases[0], hr);
        }
      }
    } catch (err: any) {
      if (!fallbackFromUrl) {
        setError(err.message || "Failed to load overdue case details.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCases();
  }, [caseIdParam, decisionParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;

    setError(null);
    setSubmittedSuccess(null);

    if (!supervisorRemarks.trim() || supervisorRemarks.trim().length < 5) {
      setError("Please provide a brief justification or remarks (at least 5 characters).");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/overdue/supervisor-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          decision,
          supervisorName: supervisorName.trim() || undefined,
          supervisorEmail: supervisorEmail.trim() || undefined,
          supervisorRemarks: supervisorRemarks.trim(),
          hrEmail:
            hrEmail.trim() && hrEmail.trim() !== "hr@company.com"
              ? hrEmail.trim()
              : defaultHrEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to submit overtime approval form.");
        setSubmitting(false);
        return;
      }

      const targetHrEmail =
        data.case?.hrEmail ||
        (hrEmail.trim() && hrEmail.trim() !== "hr@company.com"
          ? hrEmail.trim()
          : defaultHrEmail);

      setSubmittedSuccess(
        decision === "APPROVED"
          ? `Incident Classified as EXCUSED (APPROVED) for ${selectedCase.employee?.firstName || ""} ${
              selectedCase.employee?.lastName || ""
            }. The overdue case (${selectedCase.caseNumber}) has been AUTOMATICALLY CLOSED — no printing or serving of the report is needed. Confirmation sent to HR (${targetHrEmail}).`
          : `Incident Classified as UNEXCUSED (DISAPPROVED) for ${selectedCase.employee?.firstName || ""} ${
              selectedCase.employee?.lastName || ""
            }. Incident Report is OPEN and forwarded to HR (${targetHrEmail}) for printing and serving.`
      );
      setSubmitting(false);

      // Automatically close the browser tab once the email has been sent to HR
      setTimeout(() => {
        try {
          window.open("", "_self");
          window.close();
        } catch {
          // Ignore if blocked by browser
        }
      }, 1200);
    } catch (err: any) {
      setError(err.message || "Network error submitting form.");
      setSubmitting(false);
    }
  };

  const activeIncidentRef = selectedCase
    ? selectedCase.caseNumber.startsWith("INC-")
      ? selectedCase.caseNumber
      : `INC-${selectedCase.caseNumber}`
    : "INC-NEXUS-OVD";

  const activeHoursElapsed = selectedCase
    ? Math.max(24, Math.floor((selectedCase.minutesOverdue || 0) / 60) + 24)
    : 24;

  const activeEmpName = selectedCase?.employee
    ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`.trim()
    : "Unknown Employee";

  const activeEmpCode = selectedCase?.employee?.employeeCode || "N/A";
  const activeDeptName = selectedCase?.employee?.department?.name || "General Department";
  const activeAssetTag = selectedCase?.phoneAsset?.assetTag || "N/A";
  const activePhoneModel = selectedCase?.phoneAsset
    ? `${selectedCase.phoneAsset.brand} ${selectedCase.phoneAsset.model}`.trim()
    : "";

  return (
    <div
      className="min-h-screen bg-slate-100 py-8 px-4 sm:px-6 flex flex-col items-center text-slate-900"
      style={{ colorScheme: "light" }}
    >
      <div className="w-full max-w-[600px] bg-white text-slate-900 rounded-2xl border border-rose-200 shadow-lg overflow-hidden">
        {/* Deep Crimson Top Header Banner matching Screenshot */}
        <div
          className="px-6 py-7 text-center text-white"
          style={{
            background: "linear-gradient(180deg, #9f1239 0%, #be123c 55%, #dc2626 100%)",
          }}
        >
          <div className="inline-block bg-rose-50 text-rose-800 text-[11px] font-extrabold uppercase tracking-wider px-4 py-1.5 rounded-full mb-3.5 shadow-sm">
            ⚠️ SUPERVISOR ACTION MANDATORY
          </div>
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wide text-white leading-tight">
            24-HOUR OVERDUE PHONE INCIDENT
          </h1>
          <div className="mt-2 text-xs text-rose-100 font-medium">
            SecurePass NEXUS &bull; Incident Escalation &bull; Ref: {activeIncidentRef}
          </div>
        </div>

        {/* Main Card Body */}
        <div className="p-6 sm:p-7 space-y-5 text-slate-900">
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {submittedSuccess ? (
            <div className="py-8 px-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <div className="space-y-1.5">
                <h2 className="text-base font-black uppercase tracking-wide text-emerald-900">
                  Report Sent to HR Department!
                </h2>
                <p className="text-xs text-emerald-800 leading-relaxed max-w-md mx-auto">
                  {submittedSuccess}
                </p>
              </div>
              <div className="pt-2 space-y-2">
                <p className="text-[11px] text-emerald-700 font-semibold">
                  Closing this tab automatically...
                </p>
                <button
                  type="button"
                  onClick={() => {
                    window.open("", "_self");
                    window.close();
                  }}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold uppercase tracking-wider shadow-sm transition"
                >
                  Close Tab Now
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
              <span className="text-xs text-slate-500">Loading overdue phone incident details...</span>
            </div>
          ) : !selectedCase ? (
            /* Case Selector List (when accessed without ?caseId=...) */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Select an Overdue Phone Incident to Review
                  </h2>
                  <p className="text-xs text-slate-500">
                    Tap any incident below to open its Supervisor Evaluation Form
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                  {cases.length} Case{cases.length === 1 ? "" : "s"}
                </span>
              </div>

              {cases.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto" />
                  <div className="text-sm font-semibold text-slate-700">
                    No Active 24-Hour Overdue Phone Incidents
                  </div>
                  <p className="text-xs text-slate-500">
                    All company phones are currently within their allowed custody window.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cases.map((c) => {
                    const empName = c.employee
                      ? `${c.employee.firstName} ${c.employee.lastName}`
                      : "Unassigned Employee";
                    const deptName = c.employee?.department?.name || "General Department";
                    const assetTag = c.phoneAsset?.assetTag || "Phone Asset";

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => populateFormFromCase(c, defaultHrEmail)}
                        className="w-full py-3.5 px-2 flex items-center justify-between text-left hover:bg-slate-50 rounded-xl transition"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-extrabold text-rose-600">
                              INC-{c.caseNumber.replace(/^INC-/, "")}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                c.overtimeApprovalStatus === "PENDING"
                                  ? "bg-amber-100 text-amber-800"
                                  : c.overtimeApprovalStatus === "APPROVED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {c.overtimeApprovalStatus === "PENDING"
                                ? "ACTION REQUIRED"
                                : c.overtimeApprovalStatus === "APPROVED"
                                ? "EXCUSED"
                                : "UNEXCUSED"}
                            </span>
                          </div>
                          <div className="text-xs font-extrabold text-slate-900 uppercase">
                            {empName} &bull;{" "}
                            <span className="font-mono text-sky-600">{assetTag}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {deptName} &bull; Check-In: {formatDateTime(c.custodyTransaction?.timestamp)}
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
            /* Active Supervisor Evaluation View */
            <div className="space-y-5">
              {/* Gray Rounded Details Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-6 py-5">
                <table className="w-full text-[13.5px] border-collapse">
                  <tbody>
                    <tr>
                      <td className="py-1.5 text-slate-500 w-[38%]">Incident Ref:</td>
                      <td className="py-1.5 font-mono font-extrabold text-rose-600">
                        {activeIncidentRef}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Employee Name:</td>
                      <td className="py-1.5 font-black text-[15px] text-slate-900 uppercase">
                        {activeEmpName}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Employee Pass / ID:</td>
                      <td className="py-1.5 font-mono font-extrabold text-sky-600">
                        {activeEmpCode}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Company Phone:</td>
                      <td className="py-1.5 font-extrabold text-slate-900">
                        {activeAssetTag}
                        {activePhoneModel ? ` (${activePhoneModel})` : ""}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Assigned Dept:</td>
                      <td className="py-1.5 font-extrabold text-slate-900">
                        {activeDeptName}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Dept Supervisor:</td>
                      <td className="py-1.5 font-medium text-slate-600">
                        {supervisorName || "Department Supervisor"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Check-In / Time-In:</td>
                      <td className="py-1.5 font-extrabold text-amber-700">
                        {formatDateTime(selectedCase.custodyTransaction?.timestamp)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Time Overdue:</td>
                      <td className="py-1.5 font-extrabold text-[14.5px] text-rose-600">
                        {activeHoursElapsed} Hours (Limit: 24h)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Supervisor Classification & Confirmation Form */}
              <form onSubmit={handleSubmit} className="space-y-5 pt-1">
                <div className="text-center space-y-3">
                  <div className="text-[13px] font-black uppercase tracking-wider text-slate-900">
                    CHOOSE SUPERVISOR CLASSIFICATION:
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDecision("APPROVED")}
                      className={`min-w-[165px] px-7 py-3.5 rounded-xl font-extrabold text-sm tracking-wide transition shadow-sm flex items-center justify-center space-x-2 ${
                        decision === "APPROVED"
                          ? "bg-emerald-600 text-white ring-4 ring-emerald-600/25"
                          : "bg-emerald-600/80 hover:bg-emerald-600 text-white opacity-60 hover:opacity-100"
                      }`}
                    >
                      <span>&#10004;</span>
                      <span>EXCUSED</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDecision("NOT_APPROVED")}
                      className={`min-w-[165px] px-7 py-3.5 rounded-xl font-extrabold text-sm tracking-wide transition shadow-sm flex items-center justify-center space-x-2 ${
                        decision === "NOT_APPROVED"
                          ? "bg-rose-700 text-white ring-4 ring-rose-700/25"
                          : "bg-rose-700/80 hover:bg-rose-700 text-white opacity-60 hover:opacity-100"
                      }`}
                    >
                      <span>&#10006;</span>
                      <span>UNEXCUSED</span>
                    </button>
                  </div>

                  <div className="text-[11.5px] text-slate-500">
                    {decision === "APPROVED" ? (
                      <span className="text-emerald-700 font-semibold">
                        Selected: EXCUSED (Approved) — Case will be automatically closed (no printing or serving needed).
                      </span>
                    ) : (
                      <span className="text-rose-700 font-semibold">
                        Selected: UNEXCUSED (Disapproved) — HR will print &amp; serve the Official Incident Report.
                      </span>
                    )}
                  </div>
                </div>

                {/* Supervisor Justification & Submit */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3.5 text-slate-900">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-900">
                      Supervisor Evaluation / Remarks (Why Phone Was Overdue){" "}
                      <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={supervisorRemarks}
                      onChange={(e) => setSupervisorRemarks(e.target.value)}
                      placeholder="Provide the reason why the company phone exceeded the 24-hour return limit..."
                      style={{ color: "#0f172a", backgroundColor: "#ffffff", colorScheme: "light" }}
                      className="w-full p-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 [&:-webkit-autofill]:[-webkit-text-fill-color:#0f172a] [&:-webkit-autofill]:[box-shadow:0_0_0px_1000px_#ffffff_inset]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className={`w-full py-3 px-4 rounded-xl font-extrabold text-xs uppercase tracking-wider text-white shadow-md transition flex items-center justify-center space-x-2 disabled:opacity-50 ${
                      decision === "APPROVED"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-rose-700 hover:bg-rose-800"
                    }`}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Submitting Classification to HR...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>
                          Confirm {decision === "APPROVED" ? "EXCUSED" : "UNEXCUSED"} &amp; Send to HR
                        </span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-center text-[11.5px] text-slate-500 leading-relaxed">
                  <strong>Security Notice:</strong> Clicking an email link will NOT modify database records without formal confirmation above.
                </p>
              </form>
            </div>
          )}
        </div>

        {/* Footer Bar matching Screenshot */}
        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3.5 text-center text-[11px] text-slate-500">
          Pampanga&apos;s Best &bull; SecurePass NEXUS &bull; Enterprise Custody &amp; Incident Workflow &bull;{" "}
          {formatDateTime(new Date().toISOString())}
        </div>
      </div>
    </div>
  );
}

export default function SupervisorMobileFormPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-6">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      }
    >
      <SupervisorFormContent />
    </Suspense>
  );
}
