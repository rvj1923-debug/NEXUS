"use client";

import React, { useState, useEffect } from "react";
import {
  FileSpreadsheet,
  Download,
  FileText,
  Calendar,
  Filter,
  RefreshCw,
  Search,
  CheckCircle2,
  ClockAlert,
  ShieldAlert,
  Smartphone,
  Check,
  Building2,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

interface SummaryMetrics {
  totalRegistered: number;
  available: number;
  issuedDuringPeriod: number;
  returnedDuringPeriod: number;
  onTimeReturns: number;
  lateReturns: number;
  stillOutstanding: number;
  activeOverdueCases: number;
  damagedDevices: number;
  lostDevices: number;
}

interface CustodyReportData {
  reportDateRange: string;
  startDate: string;
  endDate: string;
  summary: SummaryMetrics;
  transactions: any[];
  groupedData?: Record<string, any[]>;
}

export default function ReportsPage() {
  const [dateFilter, setDateFilter] = useState<"TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "QUARTER" | "CUSTOM">("TODAY");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [grouping, setGrouping] = useState<"NONE" | "DEPARTMENT" | "EMPLOYEE" | "PHONE" | "DATE">("NONE");
  const [reportData, setReportData] = useState<CustodyReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [reportRuns, setReportRuns] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchDepartments = async () => {
    try {
      const res = await fetch("/api/departments");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.departments)
          ? data.departments
          : [];
        setDepartments(list);
      }
    } catch (err) {
      console.error("Failed to load departments:", err);
      setDepartments([]);
    }
  };

  const fetchReport = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        dateFilter,
        grouping,
      });
      if (departmentId) params.append("departmentId", departmentId);
      if (dateFilter === "CUSTOM") {
        if (customStart) params.append("customStart", customStart);
        if (customEnd) params.append("customEnd", customEnd);
      }

      const res = await fetch(`/api/reports/custody?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch (err) {
      console.error("Failed to load report:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    fetchReport();
  }, [dateFilter, customStart, customEnd, departmentId, grouping]);

  const handleExport = (format: "xlsx" | "csv" | "pdf") => {
    setExporting(format);
    const params = new URLSearchParams({
      format,
      dateFilter,
      grouping,
    });
    if (departmentId) params.append("departmentId", departmentId);
    if (dateFilter === "CUSTOM") {
      if (customStart) params.append("customStart", customStart);
      if (customEnd) params.append("customEnd", customEnd);
    }

    const downloadUrl = `/api/reports/export?${params.toString()}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.target = "_blank";
    link.download = `custody_report_${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => setExporting(null), 2000);
  };

  const summary = reportData?.summary || {
    totalRegistered: 0,
    available: 0,
    issuedDuringPeriod: 0,
    returnedDuringPeriod: 0,
    onTimeReturns: 0,
    lateReturns: 0,
    stillOutstanding: 0,
    activeOverdueCases: 0,
    damagedDevices: 0,
    lostDevices: 0,
  };

  const filteredTransactions = (reportData?.transactions || []).filter((t: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const empName = `${t.employee?.firstName || ""} ${t.employee?.lastName || ""}`.toLowerCase();
    const tag = (t.phoneAsset?.assetTag || "").toLowerCase();
    const code = (t.transactionCode || "").toLowerCase();
    return empName.includes(q) || tag.includes(q) || code.includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Reports & Custody Ledger
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Multi-Format Export
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Authoritative audit reporting, shift return reconciliation, and certified XLSX/CSV/PDF exports
          </p>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleExport("xlsx")}
            disabled={exporting !== null}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>{exporting === "xlsx" ? "Generating..." : "Export Excel (.xlsx)"}</span>
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting === "csv" ? "Generating..." : "Export CSV"}</span>
          </button>
          <button
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{exporting === "pdf" ? "Generating..." : "Export PDF"}</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center space-x-1 bg-white dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {(["TODAY", "YESTERDAY", "WEEK", "MONTH", "QUARTER", "CUSTOM"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setDateFilter(filter)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  dateFilter === filter
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {filter === "TODAY"
                  ? "Today"
                  : filter === "YESTERDAY"
                  ? "Yesterday"
                  : filter === "WEEK"
                  ? "This Week"
                  : filter === "MONTH"
                  ? "This Month"
                  : filter === "QUARTER"
                  ? "This Quarter"
                  : "Custom"}
              </button>
            ))}
          </div>

          {/* Department Filter */}
          <div className="flex items-center space-x-2">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="">All Departments</option>
              {Array.isArray(departments) &&
                departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>

            {/* Grouping */}
            <Layers className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as any)}
              className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="NONE">No Grouping</option>
              <option value="DEPARTMENT">Group by Department</option>
              <option value="EMPLOYEE">Group by Employee</option>
              <option value="PHONE">Group by Phone</option>
              <option value="DATE">Group by Date</option>
            </select>
          </div>
        </div>

        {/* Custom Range Picker */}
        {dateFilter === "CUSTOM" && (
          <div className="flex items-center space-x-3 pt-2 border-t border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-500">From:</span>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1"
            />
            <span className="text-xs font-semibold text-slate-500">To:</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1"
            />
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
          <span>Active Window: <strong className="text-slate-800 dark:text-slate-200">{reportData?.reportDateRange || "Loading..."}</strong> ({COMPANY_TIMEZONE} UTC+8)</span>
          <button
            onClick={fetchReport}
            className="hover:underline flex items-center space-x-1 text-indigo-600 dark:text-indigo-400"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh Metrics</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Total Phones</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white mt-1">{summary.totalRegistered}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Issued Period</div>
          <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">{summary.issuedDuringPeriod}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">Returned Period</div>
          <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{summary.returnedDuringPeriod}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400">On-Time</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{summary.onTimeReturns}</div>
        </Card>
        <Card className="p-3 text-center border-l-2 border-l-purple-500">
          <div className="text-[10px] uppercase font-bold text-slate-400">Active Overdue</div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">{summary.activeOverdueCases}</div>
        </Card>
      </div>

      {/* Ledger Table Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <span>Period Custody Ledger</span>
            <span className="text-xs font-normal text-slate-400">
              ({filteredTransactions.length} records)
            </span>
          </h3>

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search in ledger..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="No Transactions In Window"
            description="No custody issuance or return activity recorded during this period range."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3.5">Tx Code</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Employee</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Asset Tag</th>
                    <th className="p-3.5">Issued At</th>
                    <th className="p-3.5">Deadline / Return</th>
                    <th className="p-3.5">Punctuality</th>
                    <th className="p-3.5">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTransactions.map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                      <td className="p-3.5 font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                        {t.transactionCode || "—"}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            t.status === "RETURNED"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : t.status === "OVERDUE"
                              ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                          }`}
                        >
                          {t.status || "UNKNOWN"}
                        </span>
                      </td>
                      <td className="p-3.5 font-medium text-slate-800 dark:text-slate-200">
                        {t.employee ? `${t.employee.firstName || ""} ${t.employee.lastName || ""}`.trim() || "—" : "—"}
                      </td>
                      <td className="p-3.5 text-slate-500">
                        {t.employee?.department?.name || "General"}
                      </td>
                      <td className="p-3.5 font-mono font-semibold">
                        {t.phoneAsset?.assetTag || "—"}
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {t.timestamp ? (
                          <>
                            <div>{new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                            <div className="text-[10px]">{new Date(t.timestamp).toLocaleDateString()}</div>
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {t.actualReturnAt ? (
                          <>
                            <div>{new Date(t.actualReturnAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                            <div className="text-[10px] text-emerald-600 font-medium">Surrendered</div>
                          </>
                        ) : (t.returnDeadlineAt || t.returnDeadline?.expectedReturnAt) ? (
                          <>
                            <div>{new Date(t.returnDeadlineAt || t.returnDeadline?.expectedReturnAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                            <div className="text-[10px] text-slate-400">Scheduled Due</div>
                          </>
                        ) : (
                          <div className="text-[11px] text-slate-400">—</div>
                        )}
                      </td>
                      <td className="p-3.5">
                        {t.returnStatus === "ON_TIME" && (
                          <span className="text-emerald-600 font-semibold text-[11px]">On-Time</span>
                        )}
                        {t.returnStatus === "LATE" && (
                          <span className="text-amber-600 font-semibold text-[11px]">Late</span>
                        )}
                        {!t.returnStatus && t.status === "ISSUED" && (
                          <span className="text-blue-600 font-medium text-[11px]">In Custody</span>
                        )}
                        {!t.returnStatus && t.status === "OVERDUE" && (
                          <span className="text-red-600 font-bold text-[11px]">Overdue ({t.overdueMinutes || 0}m)</span>
                        )}
                        {!t.returnStatus && t.status !== "ISSUED" && t.status !== "OVERDUE" && (
                          <span className="text-slate-400 text-[11px]">{t.status || "—"}</span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">
                        {t.custodyDurationMinutes !== null && t.custodyDurationMinutes !== undefined
                          ? `${Math.floor(t.custodyDurationMinutes / 60)}h ${t.custodyDurationMinutes % 60}m`
                          : "Active"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
