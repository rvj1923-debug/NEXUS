"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Link2,
  Plus,
  RefreshCw,
  XCircle,
  Search,
  Filter,
  ShieldCheck,
  Smartphone,
  User,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { NewAssignmentModal } from "@/components/assignments/new-assignment-modal";
import { ReplaceAssignmentModal } from "@/components/assignments/replace-assignment-modal";
import { EmptyState } from "@/components/empty-state";

interface AssignmentItem {
  id: string;
  assignmentType: string;
  status: "ACTIVE" | "REPLACED" | "TERMINATED";
  startDate: string;
  endDate: string | null;
  notes: string | null;
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department?: { name: string; code: string } | null;
  };
  phoneAsset: {
    id: string;
    assetTag: string;
    brand: string;
    model: string;
    custodyStatus: string;
  };
  assignedByUser?: {
    fullName: string;
    email: string;
  } | null;
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [search, setSearch] = useState("");

  // Modals & Action States
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [replacingAssignment, setReplacingAssignment] = useState<AssignmentItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/assignments?${params.toString()}`);
      const data = await res.json();
      if (data.assignments) {
        setAssignments(data.assignments);
      }
    } catch (err) {
      console.error("Failed to load assignments:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const handleTerminateAssignment = async (id: string, phoneCustodyStatus: string) => {
    if (phoneCustodyStatus === "ISSUED") {
      setActionError("Cannot terminate allocation while phone is physically outstanding in custody. Surrender device first.");
      return;
    }

    if (!confirm("Are you sure you want to terminate this standing allocation? The device will return to the unassigned inventory pool.")) {
      return;
    }

    setTerminatingId(id);
    setActionError(null);

    try {
      const res = await fetch(`/api/assignments/${id}/terminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Standing allocation ended by Custodian" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to terminate assignment");
        setTerminatingId(null);
        return;
      }

      fetchAssignments();
    } catch {
      setActionError("Network error terminating assignment");
    } finally {
      setTerminatingId(null);
    }
  };

  const filteredAssignments = assignments.filter((asgn) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      asgn.employee.firstName.toLowerCase().includes(q) ||
      asgn.employee.lastName.toLowerCase().includes(q) ||
      asgn.employee.employeeCode.toLowerCase().includes(q) ||
      asgn.phoneAsset.assetTag.toLowerCase().includes(q) ||
      asgn.phoneAsset.model.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Standing Phone Assignments
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              {assignments.length} Records
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Standing device-to-person policy mapping separate from daily physical custody transactions
          </p>
        </div>

        <button
          onClick={() => setIsNewModalOpen(true)}
          className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Assignment</span>
        </button>
      </div>

      {/* Relational Integrity Notice */}
      <div className="p-3.5 rounded-xl border border-purple-100 dark:border-purple-950 bg-purple-50/50 dark:bg-purple-950/20 text-xs text-purple-900 dark:text-purple-300 flex items-start space-x-2.5">
        <ShieldCheck className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Custody Guard Active:</span> Devices currently physically checked out in the field (<code className="font-mono text-[11px] bg-purple-100 dark:bg-purple-900/60 px-1 py-0.5 rounded">custodyStatus === &quot;ISSUED&quot;</code>) cannot be reassigned or terminated until verified and surrendered at a kiosk or custody desk.
        </div>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Employee, Code, or Asset Tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="ACTIVE">Active Allocations Only</option>
            <option value="REPLACED">Replaced History</option>
            <option value="TERMINATED">Terminated</option>
            <option value="">All Allocations</option>
          </select>
        </div>
      </div>

      {/* Assignments Table */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-xs text-slate-500">Loading assignments...</span>
        </div>
      ) : filteredAssignments.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No Allocations Found"
          description={
            search
              ? "No allocations matched your search query."
              : "No standing assignments configured for this filter. Employees draw from general pools unless assigned."
          }
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5 pl-5">Assignee Personnel</th>
                  <th className="p-3.5">Assigned Device</th>
                  <th className="p-3.5">Physical Custody</th>
                  <th className="p-3.5">Policy Type</th>
                  <th className="p-3.5">Allocation Period</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredAssignments.map((asgn) => {
                  const isIssued = asgn.phoneAsset.custodyStatus === "ISSUED";

                  return (
                    <tr
                      key={asgn.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Employee */}
                      <td className="p-3.5 pl-5">
                        <Link
                          href={`/employees/${asgn.employee.id}`}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 block"
                        >
                          {asgn.employee.firstName} {asgn.employee.lastName}
                        </Link>
                        <div className="text-[11px] font-mono text-slate-400">
                          {asgn.employee.employeeCode}{" "}
                          {asgn.employee.department ? `• ${asgn.employee.department.code}` : ""}
                        </div>
                      </td>

                      {/* Phone Asset */}
                      <td className="p-3.5">
                        <Link
                          href={`/phones/${asgn.phoneAsset.id}`}
                          className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>{asgn.phoneAsset.assetTag}</span>
                        </Link>
                      </td>

                      {/* Physical Custody */}
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isIssued
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                          }`}
                        >
                          {isIssued ? "Checked Out (In Field)" : "Docked / Available"}
                        </span>
                      </td>

                      {/* Policy Type */}
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {asgn.assignmentType}
                        </span>
                      </td>

                      {/* Date */}
                      <td className="p-3.5 font-mono text-slate-500 text-[11px]">
                        <div>From: {new Date(asgn.startDate).toLocaleDateString()}</div>
                        {asgn.endDate && <div>To: {new Date(asgn.endDate).toLocaleDateString()}</div>}
                      </td>

                      {/* Status */}
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            asgn.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              : asgn.status === "REPLACED"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {asgn.status}
                        </span>
                        {asgn.notes && (
                          <div className="text-[10px] text-slate-400 mt-1 max-w-[200px] truncate" title={asgn.notes}>
                            {asgn.notes}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 pr-5 text-right">
                        {asgn.status === "ACTIVE" ? (
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={() => setReplacingAssignment(asgn)}
                              disabled={isIssued}
                              title={
                                isIssued
                                  ? "Cannot replace device while physically outstanding"
                                  : "Approved Phone Replacement Workflow"
                              }
                              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 disabled:opacity-40 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Replace</span>
                            </button>

                            <button
                              onClick={() => handleTerminateAssignment(asgn.id, asgn.phoneAsset.custodyStatus)}
                              disabled={isIssued || terminatingId === asgn.id}
                              title={
                                isIssued
                                  ? "Cannot terminate allocation while phone is physically checked out"
                                  : "Terminate standing assignment"
                              }
                              className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 disabled:opacity-40 transition-colors"
                            >
                              {terminatingId === asgn.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              <span>End</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Archived</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <NewAssignmentModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSuccess={() => {
          setIsNewModalOpen(false);
          fetchAssignments();
        }}
      />

      {replacingAssignment && (
        <ReplaceAssignmentModal
          isOpen={Boolean(replacingAssignment)}
          assignment={replacingAssignment}
          onClose={() => setReplacingAssignment(null)}
          onSuccess={() => {
            setReplacingAssignment(null);
            fetchAssignments();
          }}
        />
      )}
    </div>
  );
}
