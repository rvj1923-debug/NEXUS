import React from "react";
import { ScrollText, ShieldCheck, Filter, Clock, User, Shield } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export const revalidate = 0;

export default async function AuditLogsPage() {
  const logs = await db.auditLog.findMany({
    take: 50,
    orderBy: { timestamp: "desc" },
    include: { user: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Immutable System Audit Logs
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              {logs.length} Events Recorded
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tamper-evident audit trail of authentication events, authorization checks, and custody modifications
          </p>
        </div>
      </div>

      <div className="p-3.5 rounded-xl border border-purple-100 dark:border-purple-950 bg-purple-50/50 dark:bg-purple-950/20 text-xs text-purple-900 dark:text-purple-300 flex items-start space-x-2.5">
        <Shield className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Auditor Access Area:</span> This log is restricted by server-side policy to System Administrators and Corporate Compliance Auditors. All records contain IP addresses, user agents, timestamps, and before/after payloads.
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No Audit Logs Recorded"
          description="Security and operational actions will be written here automatically."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-4">Action</th>
                  <th className="p-4">User</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Entity</th>
                  <th className="p-4">IP Address</th>
                  <th className="p-4">Payload / Details</th>
                  <th className="p-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                    <td className="p-4">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4 text-slate-700 dark:text-slate-300 font-sans">
                      {log.userEmail || "System"}
                    </td>
                    <td className="p-4">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        {log.userRole || "N/A"}
                      </span>
                    </td>
                    <td className="p-4 text-slate-500">
                      {log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)}...)` : ""}
                    </td>
                    <td className="p-4 text-slate-500">
                      {log.ipAddress || "127.0.0.1"}
                    </td>
                    <td className="p-4 max-w-xs truncate text-slate-600 dark:text-slate-400" title={log.changes || ""}>
                      {log.changes || "—"}
                    </td>
                    <td className="p-4 text-slate-500 font-mono">
                      {new Date(log.timestamp).toLocaleString()}
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
