"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Printer,
  ArrowLeft,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

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

function PrintIncidentReportContent() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get("caseId") || "";
  const autoPrint = searchParams.get("autoprint") === "1";

  const [caseData, setCaseData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (caseId) {
          const res = await fetch(`/api/overdue/${caseId}`);
          if (res.ok) {
            const data = await res.json();
            setCaseData(data);
            setLoading(false);
            if (autoPrint) {
              setTimeout(() => window.print(), 600);
            }
            return;
          }
        }
        // Fallback: load all overdue cases and pick matching or latest
        const allRes = await fetch("/api/overdue?status=ALL");
        if (allRes.ok) {
          const allData = await allRes.json();
          const list = allData.cases || [];
          const found = caseId
            ? list.find((c: any) => c.id === caseId || c.caseNumber === caseId)
            : list[0];
          if (found) {
            setCaseData(found);
            if (autoPrint) {
              setTimeout(() => window.print(), 600);
            }
          } else {
            setError("Overdue Incident Report not found.");
          }
        } else {
          setError("Failed to load Overdue Incident Report.");
        }
      } catch (err: any) {
        setError(err.message || "Error loading incident report.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [caseId, autoPrint]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-3 bg-slate-100">
        <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
        <p className="text-xs font-medium text-slate-600">
          Preparing Printable Overdue Phone Incident Report...
        </p>
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 space-y-4 bg-slate-100">
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error || "Incident report not found."}</span>
        </div>
        <a
          href="/api/auth/hr-access"
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
        >
          Open Admin Overdue Reports Tab
        </a>
      </div>
    );
  }

  const empName = caseData.employee
    ? `${caseData.employee.firstName} ${caseData.employee.lastName}`
    : "Assigned Employee";
  const empCode = caseData.employee?.employeeCode || "N/A";
  const deptName = caseData.employee?.department?.name || "Operations";
  const designation = caseData.employee?.designation || "Employee";
  const assetTag =
    caseData.phoneAsset?.assetTag ||
    caseData.custodyTransaction?.nfcCard?.cardNumber ||
    caseData.custodyTransaction?.nfcCard?.cardUid ||
    "Company Phone";
  const phoneModel = caseData.phoneAsset
    ? `${caseData.phoneAsset.brand || ""} ${caseData.phoneAsset.model || ""}`.trim()
    : "Company Mobile Device";
  const imei = caseData.phoneAsset?.imei || "N/A";
  const isApproved = caseData.overtimeApprovalStatus === "APPROVED";
  const isDisapproved = caseData.overtimeApprovalStatus === "NOT_APPROVED";
  const incidentNumber = `INC-OVD-${(caseData.caseNumber || "").replace("OVD-", "")}`;

  return (
    <div className="min-h-screen bg-slate-200 py-6 px-4 print:bg-white print:p-0 print:min-h-0">
      {/* Strict Single-Page A4 Print Styles */}
      <style jsx global>{`
        @page {
          size: A4 portrait;
          margin: 10mm;
        }
        @media print {
          html,
          body {
            width: 210mm;
            height: 297mm;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .a4-single-page {
            width: 190mm !important;
            max-width: 190mm !important;
            height: 275mm !important;
            max-height: 275mm !important;
            margin: 0 auto !important;
            padding: 6mm !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Top Action Bar (Hidden when printing) */}
      <div className="max-w-[210mm] mx-auto mb-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white p-3.5 rounded-2xl shadow-md print:hidden">
        <div className="flex items-center space-x-3">
          <a
            href={`/api/auth/hr-access?caseId=${caseData.id}`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Go to Admin Overdue Reports Tab</span>
          </a>
          <span className="text-xs text-slate-300 font-mono">
            {incidentNumber}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href={`/api/auth/hr-access?caseId=${caseData.id}`}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-bold transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open / Close Incident Report in Admin</span>
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold shadow-sm transition"
          >
            <Printer className="w-4 h-4" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Printable Official Document — Exact Single-Page A4 Sheet */}
      <div className="a4-single-page w-full max-w-[210mm] min-h-[297mm] max-h-[297mm] mx-auto bg-white border border-rose-200 shadow-lg p-[10mm] print:border-0 print:shadow-none text-slate-900 flex flex-col justify-between box-border overflow-hidden rounded-2xl print:rounded-none">
        <div className="space-y-3">
          {/* Deep Crimson Top Header Banner matching Screenshot */}
          <div
            className="rounded-xl px-5 py-4 text-center text-white"
            style={{
              background: isApproved
                ? "linear-gradient(180deg, #065f46 0%, #047857 55%, #059669 100%)"
                : "linear-gradient(180deg, #9f1239 0%, #be123c 55%, #dc2626 100%)",
            }}
          >
            <div
              className={`inline-block text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-1 rounded-full mb-1.5 ${
                isApproved ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
              }`}
            >
              {isApproved
                ? "✓ SUPERVISOR EXCUSED • AUTO-CLOSED"
                : "⚠️ 24-HOUR OVERDUE ESCALATION • HR INCIDENT REPORT"}
            </div>
            <h1 className="text-lg font-black tracking-wide uppercase leading-tight text-white">
              24-HOUR OVERDUE PHONE INCIDENT REPORT
            </h1>
            <div className="text-[11px] text-white/90 font-medium mt-0.5">
              SecurePass NEXUS &bull; Incident Escalation &bull; Ref: {incidentNumber} &bull; Case: {caseData.caseNumber}
            </div>
          </div>

          {/* Soft Rose / Emerald Alert Callout Box */}
          <div>
            {isApproved ? (
              <div className="px-4 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-950 flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-snug">
                  <strong>Attention HR Department:</strong> Department Supervisor classified this{" "}
                  <strong>{Math.max(24, Math.floor((caseData.minutesOverdue || 0) / 60) + 24)} continuous hours</strong>{" "}
                  overdue company phone incident as <strong>EXCUSED (APPROVED)</strong>. This case is automatically closed and no incident report needs to be served.
                </div>
              </div>
            ) : (
              <div className="px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 flex items-start space-x-2.5">
                <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-snug">
                  <strong>Attention Supervisor &amp; HR:</strong> A company-issued mobile phone checked out by an employee has exceeded{" "}
                  <strong>{Math.max(24, Math.floor((caseData.minutesOverdue || 0) / 60) + 24)} continuous hours</strong>{" "}
                  without a turnstile return scan and was classified as <strong>{isDisapproved ? "UNEXCUSED (DISAPPROVED)" : "PENDING EVALUATION"}</strong>. HR must print and serve this Incident Report to the employee, obtain signatures below, and upload proof of service.
                </div>
              </div>
            )}
          </div>

          {/* Section 1: Rounded Gray Incident Summary Card matching Screenshot */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5 border-b border-slate-200 pb-1">
              1. Overdue Incident &amp; Custody Details
            </div>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                <tr>
                  <td className="py-1 text-slate-500 w-[22%]">Incident Ref:</td>
                  <td className="py-1 font-mono font-extrabold text-rose-600 w-[28%]">{incidentNumber}</td>
                  <td className="py-1 text-slate-500 w-[22%]">Employee Pass / ID:</td>
                  <td className="py-1 font-mono font-extrabold text-sky-600 w-[28%]">{empCode}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">Employee Name:</td>
                  <td className="py-1 font-black text-slate-900 uppercase">{empName}</td>
                  <td className="py-1 text-slate-500">Assigned Dept:</td>
                  <td className="py-1 font-extrabold text-slate-900">{deptName} ({designation})</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">Company Phone:</td>
                  <td className="py-1 font-mono font-extrabold text-slate-900">{assetTag}</td>
                  <td className="py-1 text-slate-500">Model / IMEI:</td>
                  <td className="py-1 font-semibold text-slate-800">{phoneModel} ({imei})</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">Check-In / Time-In:</td>
                  <td className="py-1 font-extrabold text-amber-700">
                    {formatDateTime(caseData.custodyTransaction?.timestamp)}
                  </td>
                  <td className="py-1 text-slate-500">Time Overdue:</td>
                  <td className="py-1 font-extrabold text-rose-600">
                    {Math.max(24, Math.floor((caseData.minutesOverdue || 0) / 60) + 24)} Hours (Limit: 24h • +{caseData.minutesOverdue}m)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Section 2: Supervisor Explanation & Classification */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 space-y-2 text-[11px]">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
              2. Department Supervisor Classification &amp; Remarks
            </div>
            <div className="grid grid-cols-3 gap-2 pb-1.5 border-b border-slate-200">
              <div>
                <span className="text-slate-500 block text-[10px]">Dept Supervisor:</span>
                <span className="font-bold text-slate-900">
                  {caseData.supervisorReviewedBy ||
                    caseData.employee?.department?.supervisorName ||
                    "Department Supervisor"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Supervisor Email:</span>
                <span className="font-mono text-slate-900">
                  {caseData.supervisorEmail || "N/A"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Classification:</span>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold ${
                    isApproved
                      ? "bg-emerald-600 text-white"
                      : isDisapproved
                      ? "bg-rose-700 text-white"
                      : "bg-amber-100 text-amber-800 border border-amber-300"
                  }`}
                >
                  {isApproved
                    ? "✓ EXCUSED (APPROVED)"
                    : isDisapproved
                    ? "✖ UNEXCUSED (DISAPPROVED)"
                    : "PENDING SUPERVISOR"}
                </span>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-700 block mb-1 text-[10px] uppercase">
                Why the Company Phone Was Overdue (Supervisor&apos;s Statement):
              </span>
              <div className="p-2 rounded-lg bg-white border border-slate-200 text-slate-900 whitespace-pre-wrap min-h-[34px] max-h-[58px] overflow-hidden">
                {caseData.supervisorRemarks || "No supervisor explanation recorded yet."}
              </div>
            </div>
          </div>

          {/* Section 3: HR Incident Report Status & Proof of Service */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 space-y-1.5 text-[11px]">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
              3. HR Department Incident Report Status &amp; Service Record
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-slate-500 block text-[10px]">Incident Report Status:</span>
                <span className="font-extrabold text-slate-900">
                  {caseData.incidentStatusLabel || "OPEN"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">HR Officer:</span>
                <span className="font-bold text-slate-900">
                  {caseData.hrClearedBy || "HR Department"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Date Updated / Closed:</span>
                <span className="font-mono text-slate-900">{caseData.hrClearedAt || "—"}</span>
              </div>
            </div>

            {caseData.hrClearanceRemarks && (
              <div>
                <span className="text-slate-500 block text-[10px]">HR Remarks:</span>
                <div className="p-1.5 rounded bg-white border border-slate-200 text-slate-800 mt-0.5 truncate">
                  {caseData.hrClearanceRemarks}
                </div>
              </div>
            )}

            {caseData.proofImageUrl && (
              <div className="flex items-center space-x-3 pt-1">
                <img
                  src={caseData.proofImageUrl}
                  alt="Proof of Served Incident Report"
                  className="h-16 w-auto rounded border border-slate-300 object-contain"
                />
                <div className="text-[10px] text-slate-600">
                  <div className="font-bold text-slate-800">
                    ✓ Proof of Service Photo Attached
                  </div>
                  <div>Uploaded by HR Department when closing the Incident Report.</div>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Employee Written Explanation / Acknowledgment Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[10px] text-slate-600 space-y-4">
            <div className="font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
              4. Employee Receipt &amp; Written Explanation (If Applicable)
            </div>
            <div>
              I hereby acknowledge receipt of this <strong>24-Hour Overdue Phone Incident Report</strong> regarding company phone <strong>{assetTag}</strong>:
            </div>
            <div className="border-b border-dashed border-slate-300 pt-1" />
          </div>
        </div>

        {/* Section 5: Physical Signatures & Footer at Bottom of Single A4 Sheet */}
        <div className="pt-2 border-t-2 border-slate-900 space-y-2">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-700 mb-5">
            5. Official Acknowledgment &amp; Service Signatures
          </div>

          <div className="grid grid-cols-3 gap-6 text-[11px] pt-3">
            <div className="border-t border-slate-900 pt-1 text-center">
              <div className="font-bold text-slate-900 truncate">{empName}</div>
              <div className="text-[10px] text-slate-600">
                Employee Signature &amp; Date Received
              </div>
            </div>

            <div className="border-t border-slate-900 pt-1 text-center">
              <div className="font-bold text-slate-900 truncate">
                {caseData.supervisorReviewedBy || "Department Supervisor"}
              </div>
              <div className="text-[10px] text-slate-600">
                Department Supervisor Signature
              </div>
            </div>

            <div className="border-t border-slate-900 pt-1 text-center">
              <div className="font-bold text-slate-900 truncate">
                {caseData.hrClearedBy || "HR Department Officer"}
              </div>
              <div className="text-[10px] text-slate-600">
                HR Officer Signature &amp; Date Served
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 text-center text-[10px] text-slate-500">
            Pampanga&apos;s Best &bull; SecurePass NEXUS &bull; Enterprise Custody &amp; Incident Workflow &bull; Printed{" "}
            {formatDateTime(new Date().toISOString())}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintIncidentReportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      }
    >
      <PrintIncidentReportContent />
    </Suspense>
  );
}
