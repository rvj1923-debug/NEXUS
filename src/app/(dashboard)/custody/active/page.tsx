"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Clock,
  User,
  Smartphone,
  AlertTriangle,
  ArrowDownLeft,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SurrenderModal } from "@/components/custody/surrender-modal";
import { formatManilaDateTime, formatManilaTime } from "@/lib/custody/timezone";

export default function ActiveCustodyPage() {
  const [activeItems, setActiveItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTxForSurrender, setSelectedTxForSurrender] = useState<string | null>(null);

  const fetchActive = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custody/active");
      const data = await res.json();
      if (data.activeCustody) {
        setActiveItems(data.activeCustody);
      }
    } catch (e) {
      console.error("Failed to load active custody:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActive();
    const interval = setInterval(fetchActive, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const filteredItems = activeItems.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.employee.name.toLowerCase().includes(q) ||
      item.employee.employeeCode.toLowerCase().includes(q) ||
      item.employee.department.toLowerCase().includes(q) ||
      item.phoneAsset.assetTag.toLowerCase().includes(q) ||
      item.phoneAsset.brand.toLowerCase().includes(q) ||
      item.phoneAsset.model.toLowerCase().includes(q) ||
      item.phoneAsset.imei.toLowerCase().includes(q) ||
      item.transactionCode.toLowerCase().includes(q)
    );
  });

  const overdueCount = activeItems.filter((i) => i.isOverdue).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Active Custody Monitor
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {activeItems.length} Devices Outstanding
            </span>
            {overdueCount > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 animate-pulse">
                {overdueCount} Overdue
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time tracking of company phones currently deployed in employee possession with shift deadline monitors
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchActive}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-all"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href="/custody/operations"
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all"
          >
            Issue New Device
          </Link>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center space-x-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search active possessor, employee ID, asset tag, or IMEI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Active Items Table */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Zero Devices Currently Issued"
          description={
            search
              ? "No active custody checkouts match your search criteria."
              : "All registered phones are accounted for in storage vaults or chargers. No active custody check-outs are open."
          }
          actionText={search ? undefined : "Issue a Device"}
          actionHref="/custody/operations"
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 font-mono text-[11px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">Device Asset</th>
                  <th className="p-3.5">Current Possessor</th>
                  <th className="p-3.5">Issued At (Manila)</th>
                  <th className="p-3.5">Return Deadline</th>
                  <th className="p-3.5">Custody Duration</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/70 dark:hover:bg-slate-850/60 transition-all ${item.isOverdue ? "bg-red-50/30 dark:bg-red-950/10" : ""}`}
                  >
                    <td className="p-3.5">
                      <div className="font-bold font-mono text-slate-900 dark:text-slate-100">
                        {item.phoneAsset.assetTag}
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] font-mono mt-0.5">
                        <span className="text-slate-400">IMEI: {item.phoneAsset.imei}</span>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {item.employee.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {item.employee.employeeCode} • {item.employee.department}
                      </div>
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {formatManilaDateTime(item.timestamp)}
                    </td>
                    <td className="p-3.5 font-mono text-[11px]">
                      {item.returnDeadlineAt ? (
                        <span className={item.isOverdue ? "text-red-600 font-bold" : "text-slate-700 dark:text-slate-300"}>
                          {formatManilaDateTime(item.returnDeadlineAt)}
                        </span>
                      ) : (
                        <span className="text-slate-400">End of Shift</span>
                      )}
                    </td>
                    <td className="p-3.5 font-mono text-slate-700 dark:text-slate-300">
                      {Math.floor(item.custodyMinutes / 60)}h {item.custodyMinutes % 60}m
                    </td>
                    <td className="p-3.5">
                      {item.isOverdue ? (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300">
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                          <span>OVERDUE (+{item.overdueMinutes}m)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                          ON SCHEDULE
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => setSelectedTxForSurrender(item.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 transition-all inline-flex items-center space-x-1"
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        <span>Accept Return</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Surrender Modal */}
      {selectedTxForSurrender && (
        <SurrenderModal
          isOpen={!!selectedTxForSurrender}
          initialTransactionId={selectedTxForSurrender}
          onClose={() => setSelectedTxForSurrender(null)}
          onSuccess={fetchActive}
        />
      )}
    </div>
  );
}
