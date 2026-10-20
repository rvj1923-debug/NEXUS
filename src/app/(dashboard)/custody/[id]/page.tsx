"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Smartphone,
  User,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Radio,
  FileText,
  Calendar,
  Layers,
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SurrenderModal } from "@/components/custody/surrender-modal";
import { formatManilaDateTime, formatManilaTime, COMPANY_TIMEZONE } from "@/lib/custody/timezone";

export default function CustodyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const txId = params.id as string;

  const [transaction, setTransaction] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [surrenderModalOpen, setSurrenderModalOpen] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/custody/${txId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load transaction details");
      }
      setTransaction(data.transaction);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (txId) {
      fetchDetail();
    }
  }, [txId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Loading custody transaction details...</p>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-rose-600 mx-auto" />
        <h2 className="text-lg font-bold text-rose-900 dark:text-rose-200">Transaction Not Found</h2>
        <p className="text-xs text-rose-700 dark:text-rose-400">{error || "Could not retrieve transaction record."}</p>
        <Link
          href="/custody"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
          Back to Custody Transactions
        </Link>
      </div>
    );
  }

  const isIssued = transaction.status === "ISSUED";
  const isOnTime = transaction.returnStatus === "ON_TIME";
  const isLate = transaction.returnStatus === "LATE";
  const isOverdue = transaction.status === "OVERDUE" || (transaction.overdueMinutes > 0 && !transaction.actualReturnAt);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/custody"
          className="inline-flex items-center text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back to All Transactions
        </Link>

        <div className="flex items-center space-x-2">
          {isIssued && (
            <button
              onClick={() => setSurrenderModalOpen(true)}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-medium text-white shadow-sm transition"
            >
              <ArrowDownLeft className="w-3.5 h-3.5 mr-1.5" />
              Accept Device Return
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Print Record
          </button>
        </div>
      </div>

      {/* Hero Header Card */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm bg-gradient-to-r from-slate-50/50 to-white dark:from-slate-900/60 dark:to-slate-900/20">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <span className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
                  {transaction.transactionCode}
                </span>

                {/* Primary Status Badge */}
                {isIssued ? (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    ACTIVE CUSTODY
                  </span>
                ) : transaction.status === "RETURNED" ? (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    RETURNED COMPLETED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                    {transaction.status}
                  </span>
                )}

                {/* Punctuality Badge */}
                {isOnTime && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-flex items-center">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" />
                    ON_TIME
                  </span>
                )}
                {isLate && (
                  <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 inline-flex items-center">
                    <AlertTriangle className="w-3 h-3 mr-1 text-rose-500" />
                    LATE ({transaction.overdueMinutes}m overdue)
                  </span>
                )}
                {isOverdue && !transaction.actualReturnAt && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-rose-600 text-white animate-pulse inline-flex items-center">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    CURRENTLY OVERDUE
                  </span>
                )}

                {/* Verification Mode Badge */}
                {transaction.verifiedViaNfc ? (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 inline-flex items-center">
                    <Radio className="w-3 h-3 mr-1 text-indigo-500" />
                    NFC Verified Tap
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    Manual Station Entry
                  </span>
                )}

                {transaction.isManualOverride && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 inline-flex items-center">
                    <ShieldAlert className="w-3 h-3 mr-1 text-amber-600" />
                    MANUAL OVERRIDE
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Transaction recorded on {formatManilaDateTime(transaction.timestamp)} ({COMPANY_TIMEZONE})
              </p>
            </div>

            <div className="flex items-center space-x-3 text-right">
              <div>
                <p className="text-[11px] text-slate-400 uppercase font-semibold">Custody Duration</p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {transaction.custodyDurationMinutes !== null && transaction.custodyDurationMinutes !== undefined
                    ? `${Math.floor(transaction.custodyDurationMinutes / 60)}h ${transaction.custodyDurationMinutes % 60}m`
                    : "In Progress"}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid: Details Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Custody Timeline */}
        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold flex items-center">
              <Clock className="w-4 h-4 mr-2 text-blue-500" />
              Custody Timeline & Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Issued Timestamp:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {formatManilaDateTime(transaction.timestamp)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Scheduled Shift Deadline:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {formatManilaDateTime(transaction.returnDeadlineAt)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Grace Period:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {transaction.returnDeadline?.gracePeriodMinutes ?? 30} minutes included
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Actual Return:</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {transaction.actualReturnAt ? formatManilaDateTime(transaction.actualReturnAt) : "Pending Surrender"}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Punctuality Result:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {transaction.returnStatus || (isIssued ? "PENDING" : "COMPLETED")}
                {transaction.overdueMinutes > 0 && ` (${transaction.overdueMinutes} minutes overdue)`}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Device Asset Details */}
        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center">
                <Smartphone className="w-4 h-4 mr-2 text-indigo-500" />
                Company Phone Asset
              </span>
              <Link
                href={`/phones`}
                className="text-xs text-blue-600 dark:text-blue-400 font-normal hover:underline inline-flex items-center"
              >
                View in Registry <ExternalLink className="w-3 h-3 ml-1" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Asset Tag / ID:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                {transaction.phoneAsset?.assetTag}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Primary IMEI:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {transaction.phoneAsset?.imei}
              </span>
            </div>
            {transaction.phoneAsset?.imei2 && (
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500">Secondary IMEI 2:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {transaction.phoneAsset?.imei2}
                </span>
              </div>
            )}
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Current Operational Status:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {transaction.phoneAsset?.operationalStatus}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Employee Custodian Details */}
        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center">
                <User className="w-4 h-4 mr-2 text-emerald-500" />
                Employee Custodian
              </span>
              <Link
                href={`/employees`}
                className="text-xs text-blue-600 dark:text-blue-400 font-normal hover:underline inline-flex items-center"
              >
                View Employee <ExternalLink className="w-3 h-3 ml-1" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Full Name:</span>
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {transaction.employee?.firstName} {transaction.employee?.lastName}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Employee ID:</span>
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {transaction.employee?.employeeCode}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Department:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {transaction.employee?.department?.name || "General"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Position / Title:</span>
              <span className="text-slate-800 dark:text-slate-200">
                {transaction.employee?.position || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Shift Schedule:</span>
              <span className="text-slate-800 dark:text-slate-200">
                {transaction.employee?.shiftSchedule || "Standard Shift (08:00 - 17:00 Manila)"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Hardware & Physical Condition Verification */}
        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold flex items-center">
              <ShieldCheck className="w-4 h-4 mr-2 text-teal-500" />
              Hardware & Condition Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Condition Recorded:</span>
              <span
                className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                  transaction.conditionAtAction === "GOOD"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : transaction.conditionAtAction === "MINOR_DAMAGE"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                }`}
              >
                {transaction.conditionAtAction}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Accessories Issued:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {transaction.accessoriesIssued || "Phone, Charger, Case"}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Accessories Returned:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {transaction.accessoriesReturned || (isIssued ? "In Possession" : "All Returned")}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">NFC Reader Used:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {transaction.nfcReader?.readerName || "USB Kiosk Reader"}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Card UID Credential:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {transaction.nfcCard?.cardUid || "Station Key In"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Card 5: Manual Override & Exceptions (Conditional) */}
      {(transaction.isManualOverride || transaction.surrenderedByRepresentative || transaction.conditionNotes) && (
        <Card className="border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/10 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center">
              <ShieldAlert className="w-4 h-4 mr-2 text-amber-600" />
              Special Exceptions & Custodian Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            {transaction.isManualOverride && (
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-300">Manual Override Justification:</p>
                <p className="text-amber-800 dark:text-amber-400 mt-0.5 p-2 bg-white/70 dark:bg-slate-900/50 rounded border border-amber-200 dark:border-amber-900">
                  {transaction.overrideReason || "Manual override granted by authorized custodian."}
                </p>
              </div>
            )}
            {transaction.surrenderedByRepresentative && (
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-300">Authorized Representative Surrender:</p>
                <p className="text-amber-800 dark:text-amber-400 mt-0.5">
                  Handed in by authorized proxy: <span className="font-bold">{transaction.representativeName}</span>
                </p>
              </div>
            )}
            {transaction.conditionNotes && (
              <div>
                <p className="font-semibold text-slate-800 dark:text-slate-200">Condition Inspection Notes:</p>
                <p className="text-slate-700 dark:text-slate-300 mt-0.5 p-2 bg-white/70 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-800">
                  {transaction.conditionNotes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card 6: Linked Incident (Conditional) */}
      {transaction.incidents && transaction.incidents.length > 0 && (
        <Card className="border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/10 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-rose-900 dark:text-rose-200 flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 text-rose-600" />
              Associated Security / Damage Incident
            </CardTitle>
            <CardDescription className="text-xs text-rose-700 dark:text-rose-400">
              This custody transaction automatically triggered an incident report for investigation.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3 text-xs">
            {transaction.incidents.map((inc: any) => (
              <div
                key={inc.id}
                className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-rose-200 dark:border-rose-900 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                    {inc.incidentNumber}
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 font-semibold text-[10px]">
                      {inc.severity}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[10px]">
                      {inc.status}
                    </span>
                  </div>
                </div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{inc.title}</p>
                <p className="text-slate-600 dark:text-slate-400">{inc.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Card 7: Immutable Audit Trail / Custody Events */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-sm font-semibold flex items-center">
            <Layers className="w-4 h-4 mr-2 text-slate-600 dark:text-slate-400" />
            Immutable Audit Trail & Event Log
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
            Append-only verification ledger generated cryptographically on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          {transaction.custodyEvents && transaction.custodyEvents.length > 0 ? (
            <div className="space-y-4 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
              {transaction.custodyEvents.map((evt: any, idx: number) => (
                <div key={evt.id || idx} className="relative flex items-start space-x-3 text-xs">
                  <div className="relative z-10 w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center text-slate-600 dark:text-slate-300">
                    <div className="w-2 h-2 rounded-full bg-blue-600" />
                  </div>
                  <div className="flex-1 bg-slate-50/75 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {evt.eventType}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {formatManilaDateTime(evt.timestamp)}
                      </span>
                    </div>
                    {evt.details && (
                      <p className="text-slate-600 dark:text-slate-400 mt-1 font-mono text-[11px]">
                        {evt.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">No secondary events recorded.</p>
          )}
        </CardContent>
      </Card>

      {/* Surrender Modal */}
      <SurrenderModal
        open={surrenderModalOpen}
        onOpenChange={setSurrenderModalOpen}
        preselectedTransactionId={transaction.id}
        onSuccess={() => {
          fetchDetail();
        }}
      />
    </div>
  );
}
