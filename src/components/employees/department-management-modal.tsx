"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Users,
  Smartphone,
  AlertTriangle,
  FileSpreadsheet,
  Mail,
} from "lucide-react";
import { BulkImportDepartmentModal } from "@/components/employees/bulk-import-department-modal";
import { BulkImportSupervisorsModal } from "@/components/employees/bulk-import-supervisors-modal";
import { parseSupervisors } from "@/lib/supervisors";

interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  supervisorName?: string | null;
  supervisorEmail?: string | null;
  _count?: {
    employees: number;
    phoneAssets: number;
  };
}

interface DepartmentManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDepartmentChange?: () => void;
}

export function DepartmentManagementModal({
  isOpen,
  onClose,
  onDepartmentChange,
}: DepartmentManagementModalProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isBulkDeptOpen, setIsBulkDeptOpen] = useState(false);
  const [isBulkSupOpen, setIsBulkSupOpen] = useState(false);

  // Form State (Add & Edit)
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [selectedEditId, setSelectedEditId] = useState<string>("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisor2Name, setSupervisor2Name] = useState("");
  const [supervisor2Email, setSupervisor2Email] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit Supervisor State
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editSupName, setEditSupName] = useState("");
  const [editSupEmail, setEditSupEmail] = useState("");
  const [editSup2Name, setEditSup2Name] = useState("");
  const [editSup2Email, setEditSup2Email] = useState("");
  const [savingSup, setSavingSup] = useState(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteDept, setConfirmDeleteDept] = useState<Department | null>(null);

  const resetFormToAdd = () => {
    setFormMode("add");
    setSelectedEditId("");
    setName("");
    setCode("");
    setDescription("");
    setSupervisorName("");
    setSupervisorEmail("");
    setSupervisor2Name("");
    setSupervisor2Email("");
  };

  const populateFormForEdit = (dept: Department) => {
    const parsed = parseSupervisors(dept.supervisorName, dept.supervisorEmail);
    setFormMode("edit");
    setSelectedEditId(dept.id);
    setName(dept.name);
    setCode(dept.code);
    setDescription(dept.description || "");
    setSupervisorName(parsed.supervisor1Name);
    setSupervisorEmail(parsed.supervisor1Email);
    setSupervisor2Name(parsed.supervisor2Name);
    setSupervisor2Email(parsed.supervisor2Email);
    setActionError(null);
    setActionSuccess(null);
  };

  const fetchDepartments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/departments");
      const data = await res.json();
      if (data.departments) {
        setDepartments(data.departments);
      }
    } catch {
      setActionError("Failed to load departments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActionError(null);
      setActionSuccess(null);
      resetFormToAdd();
      setEditingDeptId(null);
      setConfirmDeleteDept(null);
      fetchDepartments();
    }
  }, [isOpen, fetchDepartments]);

  const handleSaveSupervisor = async (deptId: string) => {
    setActionError(null);
    setActionSuccess(null);
    try {
      setSavingSup(true);
      const res = await fetch("/api/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deptId,
          supervisorName: editSupName.trim() || null,
          supervisorEmail: editSupEmail.trim() || null,
          supervisor2Name: editSup2Name.trim() || null,
          supervisor2Email: editSup2Email.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Failed to update department supervisor.");
        return;
      }
      setActionSuccess(`Supervisor(s) updated for '${data.department.name}'.`);
      setEditingDeptId(null);
      fetchDepartments();
      if (onDepartmentChange) onDepartmentChange();
    } catch (err: any) {
      setActionError(err.message || "Failed to update department supervisor.");
    } finally {
      setSavingSup(false);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    if (formMode === "edit" && !selectedEditId) {
      setActionError("Please select a department to edit.");
      return;
    }
    if (!name.trim()) {
      setActionError("Please provide a department name.");
      return;
    }
    if (!code.trim()) {
      setActionError("Please provide a department code.");
      return;
    }

    try {
      setCreating(true);

      if (formMode === "edit") {
        const res = await fetch("/api/departments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: selectedEditId,
            name: name.trim(),
            code: code.trim().toUpperCase(),
            description: description.trim() || null,
            supervisorName: supervisorName.trim() || null,
            supervisorEmail: supervisorEmail.trim() || null,
            supervisor2Name: supervisor2Name.trim() || null,
            supervisor2Email: supervisor2Email.trim() || null,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          setActionError(data.error || "Failed to update department.");
          return;
        }

        setActionSuccess(`Department '${data.department.name}' (${data.department.code}) updated successfully.`);
        resetFormToAdd();
        fetchDepartments();
        if (onDepartmentChange) onDepartmentChange();
        return;
      }

      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          description: description.trim() || undefined,
          supervisorName: supervisorName.trim() || undefined,
          supervisorEmail: supervisorEmail.trim() || undefined,
          supervisor2Name: supervisor2Name.trim() || undefined,
          supervisor2Email: supervisor2Email.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Failed to create department.");
        return;
      }

      setActionSuccess(`Department '${data.department.name}' (${data.department.code}) created successfully.`);
      resetFormToAdd();
      fetchDepartments();
      if (onDepartmentChange) onDepartmentChange();
    } catch (err: any) {
      setActionError(err.message || "An unexpected error occurred.");
    } finally {
      setCreating(false);
    }
  };

  const [clearingAll, setClearingAll] = useState(false);

  const handleDeleteAll = async () => {
    setActionError(null);
    setActionSuccess(null);
    try {
      setClearingAll(true);
      const res = await fetch("/api/departments", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Failed to remove all departments.");
        return;
      }
      setActionSuccess(data.message || "All departments removed.");
      setConfirmDeleteDept(null);
      resetFormToAdd();
      fetchDepartments();
      if (onDepartmentChange) onDepartmentChange();
    } catch (err: any) {
      setActionError(err.message || "Failed to remove all departments.");
    } finally {
      setClearingAll(false);
    }
  };

  const handleDelete = async (dept: Department) => {
    setActionError(null);
    setActionSuccess(null);

    try {
      setDeletingId(dept.id);
      const res = await fetch(`/api/departments/${dept.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Failed to delete department.");
        return;
      }

      setActionSuccess(`Department '${dept.name}' deleted successfully.`);
      setConfirmDeleteDept(null);
      if (selectedEditId === dept.id) {
        resetFormToAdd();
      }
      fetchDepartments();
      if (onDepartmentChange) onDepartmentChange();
    } catch (err: any) {
      setActionError(err.message || "Failed to delete department.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-850/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Department Management
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add, edit, bulk import, and configure department supervisor emails for 24h overdue phone alerts
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsBulkSupOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition shadow-sm"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Import Supervisors</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBulkDeptOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Bulk Import Depts</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        <div className="px-6 pt-4 space-y-2">
          {actionError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-start space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}
          {actionSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center space-x-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section 1: Add / Edit Department Form */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700">
                <button
                  type="button"
                  onClick={resetFormToAdd}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    formMode === "add"
                      ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add New Department</span>
                </button>
                <button
                  type="button"
                  disabled={departments.length === 0}
                  onClick={() => {
                    setFormMode("edit");
                    if (!selectedEditId && departments.length > 0) {
                      populateFormForEdit(departments[0]);
                    }
                  }}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-40 ${
                    formMode === "edit"
                      ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit Department</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkDeptOpen(true)}
                className="inline-flex items-center space-x-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Batch Import CSV / Excel</span>
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-3">
              {formMode === "edit" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    Select Department to Edit <span className="text-rose-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedEditId}
                    onChange={(e) => {
                      const dept = departments.find((d) => d.id === e.target.value);
                      if (dept) {
                        populateFormForEdit(dept);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Department Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Information Technology Department"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Code / Initial <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={15}
                    placeholder="e.g. ITD"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-xs font-mono font-bold uppercase bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Supervisor 1 Name <span className="text-slate-400 font-normal">(Primary)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Roberto Mendoza"
                    value={supervisorName}
                    onChange={(e) => setSupervisorName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Supervisor 1 Email (24h Overdue Alert) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. supervisor1@company.com"
                    value={supervisorEmail}
                    onChange={(e) => setSupervisorEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Supervisor 2 Name <span className="text-slate-400 font-normal">(Optional 2nd Supervisor)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Maria Santos"
                    value={supervisor2Name}
                    onChange={(e) => setSupervisor2Name(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Supervisor 2 Email (24h Overdue Alert) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. supervisor2@company.com"
                    value={supervisor2Email}
                    onChange={(e) => setSupervisor2Email(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Description <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Brief description or purpose of this department"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end items-center space-x-2 pt-1">
                {formMode === "edit" && (
                  <button
                    type="button"
                    onClick={resetFormToAdd}
                    className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  type="submit"
                  disabled={creating || !name.trim() || !code.trim()}
                  className={`inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl disabled:opacity-50 text-white shadow-sm transition active:scale-95 ${
                    formMode === "edit"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{formMode === "edit" ? "Saving..." : "Creating..."}</span>
                    </>
                  ) : formMode === "edit" ? (
                    <>
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Save Department Changes</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Department</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Section 2: Department List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center space-x-1.5">
                <span>Existing Departments</span>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                  {departments.length}
                </span>
              </h3>
              {departments.length > 0 && (
                <button
                  type="button"
                  disabled={clearingAll}
                  onClick={handleDeleteAll}
                  className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{clearingAll ? "Removing All..." : "Remove All Departments"}</span>
                </button>
              )}
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                <span className="text-xs">Loading departments...</span>
              </div>
            ) : departments.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No departments configured yet. Click &ldquo;Bulk Import&rdquo; above to import your departments.
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                {departments.map((dept) => {
                  const empCount = dept._count?.employees || 0;
                  const phoneCount = dept._count?.phoneAssets || 0;
                  const isConfirming = confirmDeleteDept?.id === dept.id;
                  const isDeleting = deletingId === dept.id;
                  const isEditingSup = editingDeptId === dept.id;
                  const parsedSup = parseSupervisors(dept.supervisorName, dept.supervisorEmail);

                  return (
                    <div
                      key={dept.id}
                      className="p-3.5 flex flex-col gap-3 hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                              {dept.name}
                            </span>
                            <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                              {dept.code}
                            </span>
                          </div>
                          {dept.description && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {dept.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                            <span className="inline-flex items-center space-x-1">
                              <Users className="w-3 h-3 text-slate-400" />
                              <span className={empCount > 0 ? "font-semibold text-slate-700 dark:text-slate-300" : ""}>
                                {empCount} Personnel
                              </span>
                            </span>
                            {phoneCount > 0 && (
                              <span className="inline-flex items-center space-x-1">
                                <Smartphone className="w-3 h-3 text-slate-400" />
                                <span>{phoneCount} Phones</span>
                              </span>
                            )}
                            <span className="text-slate-300 dark:text-slate-700">•</span>
                            <span className="text-[11px] text-slate-600 dark:text-slate-300">
                              Supervisor(s):{" "}
                              {parsedSup.list.length > 0 ? (
                                <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400">
                                  {parsedSup.list.map((s, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800/70 text-[10px]"
                                    >
                                      {s.name && s.email ? `${s.name} (${s.email})` : s.name || s.email}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="italic text-amber-600 dark:text-amber-400">
                                  Uses employee supervisor / fallback
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => populateFormForEdit(dept)}
                            title={`Edit department '${dept.name}'`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50/60 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingSup) {
                                setEditingDeptId(null);
                              } else {
                                const parsed = parseSupervisors(dept.supervisorName, dept.supervisorEmail);
                                setEditingDeptId(dept.id);
                                setEditSupName(parsed.supervisor1Name);
                                setEditSupEmail(parsed.supervisor1Email);
                                setEditSup2Name(parsed.supervisor2Name);
                                setEditSup2Email(parsed.supervisor2Email);
                              }
                            }}
                            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition"
                          >
                            {isEditingSup ? "Cancel" : "Set Supervisors"}
                          </button>

                          {isConfirming ? (
                            <div className="flex items-center space-x-2 animate-in fade-in">
                              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                                Confirm delete?
                              </span>
                              <button
                                onClick={() => handleDelete(dept)}
                                disabled={isDeleting}
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50"
                              >
                                {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, Delete"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteDept(null)}
                                disabled={isDeleting}
                                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setConfirmDeleteDept(dept);
                                setActionError(null);
                              }}
                              title={`Delete department '${dept.name}'`}
                              className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditingSup && (
                        <div className="pt-2.5 border-t border-slate-200/70 dark:border-slate-800 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-slate-500">Supervisor 1 Name (Primary)</label>
                              <input
                                type="text"
                                placeholder="Supervisor 1 Full Name"
                                value={editSupName}
                                onChange={(e) => setEditSupName(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-slate-500">Supervisor 1 Email (24h Overdue Alert)</label>
                              <input
                                type="email"
                                placeholder="supervisor1@company.com"
                                value={editSupEmail}
                                onChange={(e) => setEditSupEmail(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-[10px] font-semibold text-slate-500">Supervisor 2 Name (Optional)</label>
                              <input
                                type="text"
                                placeholder="Supervisor 2 Full Name"
                                value={editSup2Name}
                                onChange={(e) => setEditSup2Name(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                              />
                            </div>
                            <div className="sm:col-span-2 space-y-1">
                              <label className="text-[10px] font-semibold text-slate-500">Supervisor 2 Email (Optional)</label>
                              <input
                                type="email"
                                placeholder="supervisor2@company.com"
                                value={editSup2Email}
                                onChange={(e) => setEditSup2Email(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={savingSup}
                              onClick={() => handleSaveSupervisor(dept.id)}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                            >
                              {savingSup ? "Saving..." : "Save Both"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span>Changes reflect immediately in the employee directory and kiosk.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>

      <BulkImportDepartmentModal
        isOpen={isBulkDeptOpen}
        onClose={() => setIsBulkDeptOpen(false)}
        onSuccess={() => {
          setActionSuccess("Departments bulk imported successfully.");
          fetchDepartments();
          if (onDepartmentChange) onDepartmentChange();
        }}
      />

      <BulkImportSupervisorsModal
        isOpen={isBulkSupOpen}
        onClose={() => setIsBulkSupOpen(false)}
        onSuccess={() => {
          setActionSuccess("Department supervisors bulk imported successfully.");
          fetchDepartments();
          if (onDepartmentChange) onDepartmentChange();
        }}
      />
    </div>
  );
}
