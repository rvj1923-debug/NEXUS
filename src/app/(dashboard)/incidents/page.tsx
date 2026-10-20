import React from "react";
import { ShieldAlert, Plus, Wrench, AlertCircle } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export const revalidate = 0;

export default async function IncidentsPage() {
  const incidents = await db.incident.findMany({
    include: {
      phoneAsset: true,
      employee: true,
      reportedByUser: true,
      actions: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Incident & Damage Management
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {incidents.length} Reported
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Hardware damage documentation, loss/theft investigations, IT vendor repairs, and resolution logs
          </p>
        </div>

        <button
          disabled
          title="Incident intake workflow activates in Phase 2"
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 text-white opacity-60 cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Report Incident (Phase 2)</span>
        </button>
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No Incidents Reported"
          description="Hardware conditions are normal across the fleet. Damaged, lost, or malfunctioning devices filed by IT Support or Custodians will appear here."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-4">Incident #</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Severity</th>
                  <th className="p-4">Phone Asset</th>
                  <th className="p-4">Reported By</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {incidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                    <td className="p-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {inc.incidentNumber}
                    </td>
                    <td className="p-4 font-semibold text-slate-700 dark:text-slate-300">
                      {inc.incidentType}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                        {inc.severity}
                      </span>
                    </td>
                    <td className="p-4 font-mono text-slate-600 dark:text-slate-400">
                      {inc.phoneAsset?.assetTag || "Unspecified"}
                    </td>
                    <td className="p-4 text-slate-600 dark:text-slate-400">
                      {inc.reportedByUser.fullName}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                        {inc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
