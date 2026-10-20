"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  Plus,
  FileSpreadsheet,
  Search,
  Filter,
  ShieldCheck,
  ShieldAlert,
  CreditCard,
  ChevronRight,
  UserX,
  Trash2,
  Loader2,
  Building2,
  Pencil,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { AddEmployeeModal } from "@/components/employees/add-employee-modal";
import { EditEmployeeModal, EditableEmployee } from "@/components/employees/edit-employee-modal";
import { BulkImportModal } from "@/components/employees/bulk-import-modal";
import { DeactivateEmployeeModal } from "@/components/employees/deactivate-employee-modal";
import { DeleteEmployeeModal } from "@/components/employees/delete-employee-modal";
import { DepartmentManagementModal } from "@/components/employees/department-management-modal";
import { BulkImportDepartmentModal } from "@/components/employees/bulk-import-department-modal";
import { BulkImportSupervisorsModal } from "@/components/employees/bulk-import-supervisors-modal";
import { EmptyState } from "@/components/empty-state";
import { parseSupervisors } from "@/lib/supervisors";

interface EmployeeItem extends EditableEmployee {
  nfcCards: Array<{
    id: string;
    cardUid: string;
    status: string;
  }>;
  incidentReportIssued?: boolean;
  activeIncidentCase?: {
    id: string;
    caseNumber: string;
    minutesOverdue: number;
  } | null;
  latestClearedCase?: {
    id: string;
    caseNumber: string;
    hrClearedBy?: string | null;
    hrClearedAt?: string | null;
  } | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingIncidentEmpId, setRemovingIncidentEmpId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isBulkDeptOpen, setIsBulkDeptOpen] = useState(false);
  const [isBulkSupOpen, setIsBulkSupOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeItem | null>(null);
  const [deactivatingEmployee, setDeactivatingEmployee] = useState<EmployeeItem | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<EmployeeItem | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (departmentId) params.set("departmentId", departmentId);
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const res = await fetch(`/api/employees?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (data.employees) {
        setEmployees(data.employees);
      }
    } catch {
      // Transient fetch error
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, statusFilter]);

  const handleDeleteAllEmployees = async () => {
    setDeleteAllError(null);
    setDeletingAll(true);
    try {
      const res = await fetch("/api/employees", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setDeleteAllError(data.error || "Failed to delete all employees.");
        setDeletingAll(false);
        return;
      }
      setIsDeleteAllOpen(false);
      setBannerMessage(data.message || "All employee records have been permanently deleted.");
      await fetchEmployees();
      await fetchDepartments();
      setTimeout(() => setBannerMessage(null), 7000);
    } catch {
      setDeleteAllError("Network error while deleting employees.");
    } finally {
      setDeletingAll(false);
    }
  };

  const handleRemoveIncidentReport = async (emp: EmployeeItem) => {
    try {
      setRemovingIncidentEmpId(emp.id);
      setBannerMessage(null);
      const res = await fetch("/api/overdue/hr-remove-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: emp.id,
          caseId: emp.activeIncidentCase?.id,
          hrOfficerName: "HR Department Admin",
          hrRemarks: `HR Department removed INCIDENT REPORT ISSUED on ${emp.firstName} ${emp.lastName} (${emp.employeeCode}) from Employee Directory.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setBannerMessage(
          data.message ||
            `✅ INCIDENT REPORT ISSUED removed by HR for ${emp.firstName} ${emp.lastName} (${emp.employeeCode}).`
        );
        await fetchEmployees();
        setTimeout(() => setBannerMessage(null), 7000);
      }
    } catch {
      // Ignore transient error
    } finally {
      setRemovingIncidentEmpId(null);
    }
  };

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch("/api/departments");
      const data = await res.json().catch(() => ({}));
      if (data.departments) {
        setDepartments(data.departments);
      }
    } catch {
      // Ignore transient error
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEmployees();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchEmployees]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Employee Directory
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              {employees.length} Personnel
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Permanent personnel master records, department assignments, supervisor emails, and NFC credential bindings
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {employees.length > 0 && (
            <button
              onClick={() => {
                setDeleteAllError(null);
                setIsDeleteAllOpen(true);
              }}
              className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 shadow-sm transition-all"
              title="Permanently delete all employee records"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete All Employees</span>
            </button>
          )}
          <button
            onClick={() => setIsDeptModalOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
            title="Manage, add, and delete departments"
          >
            <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Departments</span>
          </button>
          <button
            onClick={() => setIsBulkDeptOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
            title="Bulk import department codes/initials and department names"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Bulk Import Depts</span>
          </button>
          <button
            onClick={() => setIsBulkSupOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
            title="Bulk import supervisors using department codes (supports 1 or 2 supervisors per department)"
          >
            <Mail className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>Bulk Import Supervisors</span>
          </button>
          <button
            onClick={() => setIsBulkOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Bulk Import Employees</span>
          </button>
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Relational Integrity Architecture Banner */}
      <div className="p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-950 bg-indigo-50/50 dark:bg-indigo-950/20 text-xs text-indigo-900 dark:text-indigo-300 flex items-start space-x-2.5">
        <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Relational Architecture Verified:</span> Employee primary keys are decoupled from physical NFC card UIDs. Replacing damaged or lost cards retains complete historical transactions without destroying employee records.
        </div>
      </div>

      {bannerMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{bannerMessage}</span>
        </div>
      )}

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, ID code, designation, or supervisor email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          {/* Department Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsDeptModalOpen(true)}
              className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Add or Delete Departments"
            >
              <Building2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "ACTIVE" | "INACTIVE" | "ALL")}
            className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ACTIVE">Active Personnel</option>
            <option value="INACTIVE">Deactivated</option>
            <option value="ALL">All Records</option>
          </select>
        </div>
      </div>

      {/* Employees Table */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          <span className="text-xs text-slate-500">Loading employee directory...</span>
        </div>
      ) : employees.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No Employees Found"
          description={
            search || departmentId
              ? "No records matched your search filters. Try resetting the department or search query."
              : "The employee directory currently contains no registered records. Personnel can be registered individually or batch imported."
          }
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5 pl-5">Personnel</th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5">Supervisor(s) (24h Overdue Alert)</th>
                  <th className="p-3.5">NFC Credential</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {employees.map((emp) => {
                  const activeCard = emp.nfcCards?.find((c) => c.status === "ACTIVE");
                  const resolvedSupEmail =
                    emp.supervisorEmail ||
                    emp.department?.supervisorEmail ||
                    emp.supervisor?.email ||
                    null;
                  const resolvedSupName =
                    emp.supervisorName ||
                    emp.department?.supervisorName ||
                    (emp.supervisor
                      ? `${emp.supervisor.firstName} ${emp.supervisor.lastName}`.trim()
                      : null);
                  const parsedSup = parseSupervisors(resolvedSupName, resolvedSupEmail);

                  return (
                    <tr
                      key={emp.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Name & ID */}
                      <td className="p-3.5 pl-5">
                        <Link
                          href={`/employees/${emp.id}`}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center space-x-2"
                        >
                          <span>
                            {emp.firstName} {emp.lastName}
                          </span>
                        </Link>
                        <div className="text-[11px] font-mono text-slate-400 flex items-center space-x-2 mt-0.5">
                          <span className="font-semibold text-slate-600 dark:text-slate-400">
                            {emp.employeeCode}
                          </span>
                          {emp.designation && <span>• {emp.designation}</span>}
                        </div>
                      </td>

                      {/* Department */}
                      <td className="p-3.5">
                        {emp.department ? (
                          <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {emp.department.name}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium italic bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Supervisor Email */}
                      <td className="p-3.5">
                        {parsedSup.list.length > 0 ? (
                          <div className="space-y-1.5">
                            {parsedSup.list.map((sup, idx) => (
                              <div key={idx} className="space-y-0.5">
                                {sup.email && (
                                  <div className="inline-flex items-center space-x-1.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                                    <Mail className="w-3 h-3 text-indigo-500 shrink-0" />
                                    <span>{sup.email}</span>
                                    {parsedSup.list.length > 1 && (
                                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                                        #{idx + 1}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {sup.name && (
                                  <div className="text-[10px] text-slate-400">
                                    {sup.name}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingEmployee(emp)}
                            className="inline-flex items-center space-x-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            <Mail className="w-3 h-3" />
                            <span>+ Add Supervisor Email</span>
                          </button>
                        )}
                      </td>

                      {/* NFC Credential */}
                      <td className="p-3.5">
                        {activeCard ? (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            <CreditCard className="w-3 h-3" />
                            <span>{activeCard.cardUid}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No Active Card</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3.5">
                        <div className="flex flex-col items-start gap-1">
                          {emp.isActive ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              Deactivated
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 pr-5 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">

                          <button
                            onClick={() => setEditingEmployee(emp)}
                            title="Edit Employee Details & Supervisor Email"
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>

                          <Link
                            href={`/employees/${emp.id}`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                          >
                            <span>Profile</span>
                            <ChevronRight className="w-3 h-3" />
                          </Link>

                          {emp.isActive && (
                            <button
                              onClick={() => setDeactivatingEmployee(emp)}
                              title="Controlled Clearance & Deactivation"
                              className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            onClick={() => setDeletingEmployee(emp)}
                            title="Delete Employee Permanently"
                            className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
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
      <AddEmployeeModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSuccess={() => {
          fetchEmployees();
        }}
      />

      <EditEmployeeModal
        isOpen={Boolean(editingEmployee)}
        employee={editingEmployee}
        onClose={() => setEditingEmployee(null)}
        onSuccess={() => {
          fetchEmployees();
          fetchDepartments();
        }}
      />

      <BulkImportModal
        isOpen={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        onSuccess={() => {
          fetchEmployees();
        }}
      />

      {deactivatingEmployee && (
        <DeactivateEmployeeModal
          isOpen={Boolean(deactivatingEmployee)}
          employee={deactivatingEmployee}
          onClose={() => setDeactivatingEmployee(null)}
          onSuccess={() => {
            setDeactivatingEmployee(null);
            fetchEmployees();
          }}
        />
      )}

      {deletingEmployee && (
        <DeleteEmployeeModal
          isOpen={Boolean(deletingEmployee)}
          employee={deletingEmployee}
          onClose={() => setDeletingEmployee(null)}
          onSuccess={() => {
            setDeletingEmployee(null);
            fetchEmployees();
          }}
        />
      )}

      {/* Department Management Modal */}
      <DepartmentManagementModal
        isOpen={isDeptModalOpen}
        onClose={() => setIsDeptModalOpen(false)}
        onDepartmentChange={() => {
          fetchDepartments();
          fetchEmployees();
        }}
      />

      {/* Bulk Import Department Modal */}
      <BulkImportDepartmentModal
        isOpen={isBulkDeptOpen}
        onClose={() => setIsBulkDeptOpen(false)}
        onSuccess={() => {
          fetchDepartments();
          fetchEmployees();
        }}
      />

      {/* Bulk Import Supervisors by Department Code Modal */}
      <BulkImportSupervisorsModal
        isOpen={isBulkSupOpen}
        onClose={() => setIsBulkSupOpen(false)}
        onSuccess={() => {
          fetchDepartments();
          fetchEmployees();
        }}
      />

      {/* Delete All Employees Confirmation Modal */}
      {isDeleteAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Delete All Employees
                  </h3>
                  <p className="text-xs text-slate-500">
                    Permanent Bulk Personnel Deletion
                  </p>
                </div>
              </div>
              <button
                onClick={() => !deletingAll && setIsDeleteAllOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {deleteAllError && (
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-start space-x-2.5">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{deleteAllError}</span>
                </div>
              )}

              <div className="space-y-3">
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Are you sure you want to permanently delete{" "}
                  <strong className="text-slate-900 dark:text-white">
                    all {employees.length} employee record(s)
                  </strong>{" "}
                  from the directory?
                </p>

                <div className="p-3.5 rounded-xl bg-red-50/50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="font-semibold text-red-700 dark:text-red-400">
                    Notice:
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    This action will permanently remove all employee master records, clear their associated NFC card bindings, release any active phones back to available inventory, and remove related assignments and custody history. This cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDeleteAllOpen(false)}
                  disabled={deletingAll}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllEmployees}
                  disabled={deletingAll}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:opacity-50 transition-all"
                >
                  {deletingAll ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting All...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Yes, Delete All Employees</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
