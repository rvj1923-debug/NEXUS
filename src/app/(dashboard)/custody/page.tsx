"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Download,
  Calendar,
  User,
  Smartphone,
  ExternalLink,
  CheckCircle2,
  XCircle,
  FileWarning,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IssueModal } from "@/components/custody/issue-modal";
import { SurrenderModal } from "@/components/custody/surrender-modal";
import { ExceptionModal } from "@/components/custody/exception-modal";
import { formatManilaDateTime, formatManilaTime, COMPANY_TIMEZONE } from "@/lib/custody/timezone";

export default function CustodyHistoryPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [returnStatusFilter, setReturnStatusFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [departments, setDepartments] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const limit = 15;

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    onTime: 0,
    late: 0,
  });

  // Modals
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [surrenderModalOpen, setSurrenderModalOpen] = useState(false);
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [selectedTxForSurrender, setSelectedTxForSurrender] = useState<string | undefined>();

  // Fetch departments
  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => {
        if (data.departments) setDepartments(data.departments);
      })
      .catch((err) => console.error("Failed to load departments:", err));
  }, []);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (returnStatusFilter !== "ALL") params.set("returnStatus", returnStatusFilter);
      if (departmentFilter !== "ALL") params.set("departmentId", departmentFilter);

      const res = await fetch(`/api/custody?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(data.transactions);
        setTotalCount(data.pagination.total);
        setTotalPages(data.pagination.totalPages || 1);
      }
    } catch (e) {
      console.error("Failed to fetch custody transactions:", e);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, returnStatusFilter, departmentFilter]);

  // Fetch stats separately
  const fetchStats = async () => {
    try {
      const [allRes, activeRes] = await Promise.all([
        fetch("/api/custody?limit=1000"),
        fetch("/api/custody/active"),
      ]);
      const allData = await allRes.json();
      const activeData = await activeRes.json();

      if (allData.success && allData.transactions) {
        const txs: any[] = allData.transactions;
        const total = txs.length;
        const active = activeData.activeCustody ? activeData.activeCustody.length : 0;
        const onTime = txs.filter((t) => t.returnStatus === "ON_TIME").length;
        const late = txs.filter((t) => t.returnStatus === "LATE" || t.status === "OVERDUE").length;

        setStats({ total, active, onTime, late });
      }
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    fetchStats();
  }, []);

  const handleRefresh = () => {
    fetchTransactions();
    fetchStats();
  };

  // Export transactions to CSV
  const handleExportCSV = () => {
    if (transactions.length === 0) return;
    const headers = [
      "Transaction Code",
      "Type",
      "Status",
      "Return Status",
      "Employee Code",
      "Employee Name",
      "Department",
      "Asset Tag",
      "Brand",
      "Model",
      "IMEI",
      "Issued At (UTC)",
      "Return Deadline (UTC)",
      "Actual Return (UTC)",
      "Duration (Minutes)",
      "Overdue (Minutes)",
      "Condition",
      "Manual Override",
      "Override Reason",
    ];

    const rows = transactions.map((t) => [
      `"${t.transactionCode}"`,
      `"${t.transactionType}"`,
      `"${t.status}"`,
      `"${t.returnStatus || "PENDING"}"`,
      `"${t.employee?.employeeCode || ""}"`,
      `"${t.employee?.firstName || ""} ${t.employee?.lastName || ""}"`,
      `"${t.employee?.department?.name || ""}"`,
      `"${t.phoneAsset?.assetTag || ""}"`,
      `"${t.phoneAsset?.brand || ""}"`,
      `"${t.phoneAsset?.model || ""}"`,
      `"${t.phoneAsset?.imei || ""}"`,
      `"${t.timestamp ? new Date(t.timestamp).toISOString() : ""}"`,
      `"${t.returnDeadlineAt ? new Date(t.returnDeadlineAt).toISOString() : ""}"`,
      `"${t.actualReturnAt ? new Date(t.actualReturnAt).toISOString() : ""}"`,
      t.custodyDurationMinutes ?? "",
      t.overdueMinutes ?? 0,
      `"${t.conditionAtAction || ""}"`,
      t.isManualOverride ? "YES" : "NO",
      `"${(t.overrideReason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `custody-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Custody Transaction Registry
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {COMPANY_TIMEZONE} (UTC+8)
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Complete transaction ledger for company phone issuance, returns, shift deadlines, and physical condition verifications.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Link
            href="/custody/active"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition"
          >
            <Clock className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
            Active Custody ({stats.active})
          </Link>
          <Link
            href="/custody/operations"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
            Operations Desk
          </Link>
          <Link
            href="/kiosk"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition"
          >
            <Smartphone className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
            Kiosk View
          </Link>

          <button
            onClick={() => setIssueModalOpen(true)}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white shadow-sm transition"
          >
            <ArrowUpRight className="w-3.5 h-3.5 mr-1.5" />
            Issue Device
          </button>
          <button
            onClick={() => {
              setSelectedTxForSurrender(undefined);
              setSurrenderModalOpen(true);
            }}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-medium text-white shadow-sm transition"
          >
            <ArrowDownLeft className="w-3.5 h-3.5 mr-1.5" />
            Accept Return
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Transactions</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">{stats.total}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Historical ledger records</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Currently Active</p>
              <h3 className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">{stats.active}</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">Devices currently held</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">On-Time Returns</p>
              <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{stats.onTime}</h3>
              <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 font-medium mt-0.5">
                {stats.total > 0 ? `${Math.round((stats.onTime / Math.max(1, stats.onTime + stats.late)) * 100)}% punctuality` : "N/A"}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Late & Overdue</p>
              <h3 className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-0.5">{stats.late}</h3>
              <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 font-medium mt-0.5">
                Requires supervisor review
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search transaction code, employee name, asset tag, IMEI..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="ISSUED">Active (ISSUED)</option>
                <option value="RETURNED">RETURNED</option>
                <option value="OVERDUE">OVERDUE</option>
                <option value="LOST">LOST</option>
                <option value="DISPUTED">DISPUTED</option>
              </select>

              {/* Punctuality Filter */}
              <select
                value={returnStatusFilter}
                onChange={(e) => {
                  setReturnStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Punctuality</option>
                <option value="ON_TIME">ON_TIME</option>
                <option value="LATE">LATE</option>
              </select>

              {/* Department Filter */}
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Departments</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>

              {/* Action Buttons */}
              <button
                onClick={handleRefresh}
                title="Refresh Table"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-500" : ""}`} />
              </button>

              <button
                onClick={handleExportCSV}
                title="Export CSV"
                className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5 mr-1 text-slate-500" />
                CSV
              </button>

              <button
                onClick={() => setExceptionModalOpen(true)}
                title="Manual Override"
                className="inline-flex items-center px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/40 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition"
              >
                <ShieldAlert className="w-3.5 h-3.5 mr-1" />
                Override
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Phone Asset</th>
                <th className="px-4 py-3">Issued Time</th>
                <th className="px-4 py-3">Return & Punctuality</th>
                <th className="px-4 py-3">Duration / Overdue</th>
                <th className="px-4 py-3">Condition & Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Loading custody transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <FileWarning className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    No custody transactions found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isIssued = tx.status === "ISSUED";
                  const isOverdue = tx.status === "OVERDUE" || (tx.overdueMinutes && tx.overdueMinutes > 0);
                  const isLate = tx.returnStatus === "LATE";
                  const isOnTime = tx.returnStatus === "ON_TIME";

                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Transaction Code & Status Badge */}
                      <td className="px-4 py-3 font-mono">
                        <div className="flex flex-col space-y-1">
                          <Link
                            href={`/custody/${tx.id}`}
                            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center"
                          >
                            {tx.transactionCode}
                            <ExternalLink className="w-2.5 h-2.5 ml-1 opacity-60" />
                          </Link>
                          <div className="flex items-center gap-1.5">
                            {isIssued ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                                ACTIVE
                              </span>
                            ) : tx.status === "RETURNED" ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                                RETURNED
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                                {tx.status}
                              </span>
                            )}

                            {tx.isManualOverride && (
                              <span className="px-1 py-0.2 text-[9px] font-bold rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
                                OVERRIDE
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Employee Info */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}` : (tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`)}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
                          {tx.employee ? (
                            <>
                              <span>{tx.employee.employeeCode}</span>
                              <span>•</span>
                              <span className="truncate max-w-[120px]">{tx.employee.department?.name || "General"}</span>
                            </>
                          ) : (
                            <span>NFC Card: {tx.nfcCard?.cardUid || "Device"}</span>
                          )}
                        </div>
                      </td>

                      {/* Phone Asset */}
                      <td className="px-4 py-3">
                        <div className="font-semibold font-mono text-slate-900 dark:text-slate-100">
                          {tx.phoneAsset?.assetTag || tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`}
                        </div>
                      </td>

                      {/* Issued Time */}
                      <td className="px-4 py-3">
                        <div className="text-slate-800 dark:text-slate-200">
                          {formatManilaDateTime(tx.timestamp)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {tx.handledByUserId ? "By Custodian" : "Direct Tap"}
                        </div>
                      </td>

                      {/* Return & Punctuality */}
                      <td className="px-4 py-3">
                        {tx.actualReturnAt ? (
                          <div>
                            <div className="text-slate-800 dark:text-slate-200">
                              {formatManilaDateTime(tx.actualReturnAt)}
                            </div>
                            <div className="mt-0.5">
                              {isOnTime && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                                  <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                                  ON_TIME
                                </span>
                              )}
                              {isLate && (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                                  <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                                  LATE
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="text-[11px] text-slate-500">
                              Deadline: {formatManilaTime(tx.returnDeadlineAt)}
                            </span>
                            <div className="mt-0.5">
                              {isOverdue ? (
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 animate-pulse">
                                  <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                                  OVERDUE
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">Shift Active</span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Duration & Overdue */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {tx.custodyDurationMinutes !== null && tx.custodyDurationMinutes !== undefined
                            ? `${Math.floor(tx.custodyDurationMinutes / 60)}h ${tx.custodyDurationMinutes % 60}m`
                            : "In Progress"}
                        </div>
                        {tx.overdueMinutes > 0 ? (
                          <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                            +{tx.overdueMinutes}m late
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400">Within grace period</div>
                        )}
                      </td>

                      {/* Condition & Notes */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col space-y-1">
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded w-fit ${
                              tx.conditionAtAction === "GOOD"
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                : tx.conditionAtAction === "MINOR_DAMAGE"
                                ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                            }`}
                          >
                            {tx.conditionAtAction}
                          </span>
                          {tx.incidents && tx.incidents.length > 0 && (
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold flex items-center">
                              <ShieldAlert className="w-2.5 h-2.5 mr-0.5" />
                              INC-{tx.incidents[0].incidentNumber || "REPORTED"}
                            </span>
                          )}
                          {tx.surrenderedByRepresentative && (
                            <span className="text-[10px] text-slate-400 italic">
                              Rep: {tx.representativeName || "Authorized proxy"}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right space-x-2">
                        <Link
                          href={`/custody/${tx.id}`}
                          className="inline-flex items-center px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition"
                        >
                          Details
                        </Link>
                        {isIssued && (
                          <button
                            onClick={() => {
                              setSelectedTxForSurrender(tx.id);
                              setSurrenderModalOpen(true);
                            }}
                            className="inline-flex items-center px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 text-[11px] font-medium border border-emerald-200 dark:border-emerald-800 transition"
                          >
                            Return
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-xs text-slate-500">
          <div>
            Showing <span className="font-medium text-slate-700 dark:text-slate-300">{transactions.length}</span> of{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">{totalCount}</span> transactions
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition"
            >
              Previous
            </button>
            <span className="text-slate-600 dark:text-slate-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      {/* Embedded Modals */}
      <IssueModal
        open={issueModalOpen}
        onOpenChange={setIssueModalOpen}
        onSuccess={() => {
          handleRefresh();
        }}
      />

      <SurrenderModal
        open={surrenderModalOpen}
        onOpenChange={setSurrenderModalOpen}
        preselectedTransactionId={selectedTxForSurrender}
        onSuccess={() => {
          handleRefresh();
        }}
      />

      <ExceptionModal
        open={exceptionModalOpen}
        onOpenChange={setExceptionModalOpen}
        onSuccess={() => {
          handleRefresh();
        }}
      />
    </div>
  );
}
