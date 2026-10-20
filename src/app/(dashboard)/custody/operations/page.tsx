"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileWarning,
  RefreshCw,
  Search,
  ExternalLink,
  Tablet,
  Smartphone,
  User,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { IssueModal } from "@/components/custody/issue-modal";
import { SurrenderModal } from "@/components/custody/surrender-modal";
import { ExceptionModal } from "@/components/custody/exception-modal";
import { formatManilaDateTime, formatManilaTime, COMPANY_TIMEZONE } from "@/lib/custody/timezone";

export default function CustodyOperationsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ALL" | "ISSUANCE" | "SURRENDER">("ALL");

  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [surrenderModalOpen, setSurrenderModalOpen] = useState(false);
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [selectedTxForSurrender, setSelectedTxForSurrender] = useState<string | undefined>();

  // Live Self-Service Kiosk Queue (Method B)
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [approvingReq, setApprovingReq] = useState<any | null>(null);
  const [approvalCondition, setApprovalCondition] = useState("GOOD");
  const [approvalAccessories, setApprovalAccessories] = useState("Phone, Charger, Case");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvingLoading, setApprovingLoading] = useState(false);

  const fetchPendingRequests = async () => {
    try {
      const res = await fetch("/api/custody/pending");
      const data = await res.json();
      if (res.ok && data.requests) {
        setPendingRequests(data.requests);
      }
    } catch {
      // Ignore background poll errors
    }
  };

  const handleApprovePending = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingReq) return;
    setApprovingLoading(true);

    try {
      const res = await fetch("/api/custody/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: approvingReq.id,
          action: "APPROVE",
          conditionAtAction: approvalCondition,
          accessories: approvalAccessories,
          remarks: approvalNotes || "Desk custodian physical verification approved",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Approval failed.");
        setApprovingLoading(false);
        return;
      }

      setApprovingReq(null);
      fetchPendingRequests();
      fetchTransactions();
    } catch {
      alert("Network error approving request.");
    } finally {
      setApprovingLoading(false);
    }
  };

  const handleRejectPending = async (requestId: string) => {
    const reason = prompt("Enter rejection reason for this kiosk request:", "Physical device not presented or condition mismatch");
    if (!reason) return;

    try {
      const res = await fetch("/api/custody/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action: "REJECT",
          rejectionReason: reason,
        }),
      });

      if (res.ok) {
        fetchPendingRequests();
      }
    } catch {
      alert("Error rejecting request.");
    }
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custody?limit=15");
      const data = await res.json();
      if (data.transactions) {
        setTransactions(data.transactions);
      }
    } catch (e) {
      console.error("Failed to load custody transactions:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    fetchPendingRequests();

    // Poll kiosk requests every 3 seconds
    const interval = setInterval(fetchPendingRequests, 3000);
    return () => clearInterval(interval);
  }, []);

  const filteredTransactions = transactions.filter((tx) => {
    if (activeTab === "ALL") return true;
    return tx.transactionType === activeTab;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Issuance & Surrender Desk
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Custody Station Active
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manual and assisted issuance, physical condition inspection, shift return validation, and exception overrides
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-xs">
            <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            <span>DESK-CUSTODY-01</span>
          </span>
          <button
            onClick={() => setExceptionModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition-all flex items-center space-x-1"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Log Exception Override</span>
          </button>
        </div>
      </div>

      {/* Live Self-Service Kiosk Verification Queue (Method B: Assisted Verification) */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/10 shadow-sm">
        <CardHeader className="p-4 border-b border-blue-100 dark:border-blue-900/60 flex flex-row items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-blue-600 text-white">
              <Tablet className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <span>Self-Service Kiosk Verification Queue</span>
                {pendingRequests.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white font-mono text-[10px] animate-pulse">
                    {pendingRequests.length} PENDING
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-[11px]">
                Incoming card tap requests from self-service kiosks awaiting physical custodian handover and condition verification
              </CardDescription>
            </div>
          </div>
          <button
            onClick={fetchPendingRequests}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            title="Refresh queue"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </CardHeader>

        <CardContent className="p-4">
          {pendingRequests.length === 0 ? (
            <div className="py-6 text-center space-y-1 text-xs text-slate-400">
              <p className="font-medium text-slate-600 dark:text-slate-300">
                No pending self-service kiosk requests at this moment.
              </p>
              <p className="text-[11px]">
                When an employee taps their NFC card at any kiosk station, their physical handover request will appear here for physical inspection and confirmation.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-blue-400 dark:border-blue-700 shadow-md space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                        {req.requestCode}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          req.transactionType === "ISSUANCE"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                        }`}
                      >
                        REQUEST: {req.transactionType}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      <Clock className="w-3.5 h-3.5 animate-spin" />
                      <span>{req.remainingSeconds}s</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Employee:</span>
                      <span className="font-bold text-slate-900 dark:text-white">{req.employee.name}</span>
                      <span className="text-[10px] text-slate-500 block">{req.employee.department}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Requested Phone:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white">{req.phone.assetTag}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                    <span>Station: <strong>{req.kiosk?.name || "Main Kiosk"}</strong></span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleRejectPending(req.id)}
                        className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-[11px] font-semibold transition"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => {
                          setApprovingReq(req);
                          setApprovalCondition("GOOD");
                          setApprovalAccessories("Phone, Charger, Case");
                          setApprovalNotes("");
                        }}
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-sm transition"
                      >
                        Inspect & Approve
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Custodian Verification & Physical Inspection Modal */}
      {approvingReq && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Physical Phone Inspection & Approval
                </h3>
              </div>
              <button
                onClick={() => setApprovingReq(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Employee:</span>
                <span className="font-bold text-slate-900 dark:text-white">{approvingReq.employee.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Device Asset Tag:</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{approvingReq.phone.assetTag}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Operation:</span>
                <span className="font-bold uppercase text-slate-800 dark:text-slate-200">{approvingReq.transactionType}</span>
              </div>
            </div>

            <form onSubmit={handleApprovePending} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Physical Condition Inspection
                </label>
                <select
                  value={approvalCondition}
                  onChange={(e) => setApprovalCondition(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500 font-medium"
                >
                  <option value="GOOD">Good — Clean, intact display & casing</option>
                  <option value="MINOR_DAMAGE">Minor Damage — Minor scuffs, fully operational</option>
                  <option value="MAJOR_DAMAGE">Major Damage — Cracked screen / chassis damage</option>
                  <option value="NOT_FUNCTIONAL">Not Functional — Hardware defect / powers off</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Verified Accessories Released / Returned
                </label>
                <input
                  type="text"
                  value={approvalAccessories}
                  onChange={(e) => setApprovalAccessories(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Custodian Verification Notes
                </label>
                <input
                  type="text"
                  placeholder="Optional inspection notes..."
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={approvingLoading}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition flex items-center justify-center space-x-1"
                >
                  {approvingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Confirm Custody Handover</span>
                </button>
                <button
                  type="button"
                  onClick={() => setApprovingReq(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Action Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Issue Phone Action Box */}
        <Card className="border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-slate-900 hover:shadow-md transition-all">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Issue Device to Employee</CardTitle>
                  <CardDescription className="text-xs">
                    Assign custody, compute shift return deadline, and verify physical state
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Issuance records initial device condition, accessories released, binds employee responsibility, and sets shift return deadline in <strong>{COMPANY_TIMEZONE}</strong> timezone.
            </p>
            <button
              onClick={() => setIssueModalOpen(true)}
              className="w-full py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center space-x-1.5"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Launch Device Issuance Workflow</span>
            </button>
          </CardContent>
        </Card>

        {/* Surrender Phone Action Box */}
        <Card className="border-teal-200 dark:border-teal-900/60 bg-gradient-to-br from-teal-50/50 to-white dark:from-teal-950/20 dark:to-slate-900 hover:shadow-md transition-all">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-teal-600 text-white shadow-md shadow-teal-600/20">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Accept Phone Surrender</CardTitle>
                  <CardDescription className="text-xs">
                    Receive physical phone, assess condition, and close active custody
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Surrender checks against shift deadlines, evaluates late returns, inspects screen/chassis condition, and automatically triggers maintenance incidents for damaged assets.
            </p>
            <button
              onClick={() => {
                setSelectedTxForSurrender(undefined);
                setSurrenderModalOpen(true);
              }}
              className="w-full py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md shadow-teal-600/20 transition-all flex items-center justify-center space-x-1.5"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Process Device Surrender & Return</span>
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Live Transaction Log Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
              <span>Station Transaction Log</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                {transactions.length} records
              </span>
            </h3>

            {/* Filter Tabs */}
            <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs">
              <button
                onClick={() => setActiveTab("ALL")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeTab === "ALL" ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100" : "text-slate-500"}`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab("ISSUANCE")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeTab === "ISSUANCE" ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100" : "text-slate-500"}`}
              >
                Issuance
              </button>
              <button
                onClick={() => setActiveTab("SURRENDER")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${activeTab === "SURRENDER" ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100" : "text-slate-500"}`}
              >
                Surrender
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={fetchTransactions}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-all"
              title="Refresh transactions"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <Link
              href="/custody"
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center space-x-1"
            >
              <span>View Full History</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                <tr>
                  <th className="px-4 py-3">Tx Code</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Timestamp (Manila)</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Phone Asset</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3">Punctuality</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/60 transition-all">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      <Link href={`/custody/${tx.id}`} className="hover:text-indigo-600 hover:underline">
                        {tx.transactionCode}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          tx.transactionType === "ISSUANCE"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        }`}
                      >
                        {tx.transactionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {formatManilaDateTime(tx.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}` : (tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {tx.employee ? `${tx.employee.employeeCode} • ${tx.employee.department?.name || "General"}` : `NFC: ${tx.nfcCard?.cardUid || "Device"}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-slate-900 dark:text-white">
                        {tx.phoneAsset?.assetTag || tx.nfcCard?.cardNumber || tx.nfcCard?.cardUid || "Phone"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          tx.conditionAtAction === "GOOD"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {tx.conditionAtAction}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {tx.returnStatus === "LATE" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300">
                          LATE ({tx.overdueMinutes || 0}m)
                        </span>
                      ) : tx.returnStatus === "ON_TIME" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          ON TIME
                        </span>
                      ) : tx.status === "ISSUED" ? (
                        <span className="text-[10px] text-indigo-600 font-semibold font-mono">
                          ACTIVE IN CUSTODY
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/custody/${tx.id}`}
                        className="px-2.5 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg inline-flex items-center space-x-1"
                      >
                        <span>View</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Modals */}
      <IssueModal
        isOpen={issueModalOpen}
        onClose={() => setIssueModalOpen(false)}
        onSuccess={fetchTransactions}
      />
      <SurrenderModal
        isOpen={surrenderModalOpen}
        initialTransactionId={selectedTxForSurrender}
        onClose={() => setSurrenderModalOpen(false)}
        onSuccess={fetchTransactions}
      />
      <ExceptionModal
        isOpen={exceptionModalOpen}
        onClose={() => setExceptionModalOpen(false)}
        onSuccess={fetchTransactions}
      />
    </div>
  );
}
