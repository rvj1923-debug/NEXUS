"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  UserCheck,
  Loader2,
  AlertCircle,
  Mail,
  User,
  Building2,
  Briefcase,
  Phone,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { parseSupervisors } from "@/lib/supervisors";

interface Department {
  id: string;
  name: string;
  code: string;
  supervisorName?: string | null;
  supervisorEmail?: string | null;
}

export interface EditableEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneNumber: string | null;
  designation: string | null;
  status?: string;
  isActive: boolean;
  supervisorName?: string | null;
  supervisorEmail?: string | null;
  department?: {
    id: string;
    name: string;
    code: string;
    supervisorName?: string | null;
    supervisorEmail?: string | null;
  } | null;
  supervisor?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    email?: string | null;
  } | null;
}

interface EditEmployeeModalProps {
  isOpen: boolean;
  employee: EditableEmployee | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditEmployeeModal({
  isOpen,
  employee,
  onClose,
  onSuccess,
}: EditEmployeeModalProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Employee Details State
  const [employeeCode, setEmployeeCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designation, setDesignation] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "TERMINATED">("ACTIVE");

  // Supervisor Contact State (for 24-Hour Overdue Report)
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisor2Name, setSupervisor2Name] = useState("");
  const [supervisor2Email, setSupervisor2Email] = useState("");
  const [applySupervisorToDepartment, setApplySupervisorToDepartment] = useState(true);

  useEffect(() => {
    if (isOpen && employee) {
      setError(null);
      setSuccessMsg(null);
      setEmployeeCode(employee.employeeCode || "");
      setFirstName(employee.firstName || "");
      setLastName(employee.lastName || "");
      setDepartmentId(employee.department?.id || "");
      setDesignation(employee.designation || "");
      setEmail(employee.email || "");
      setPhoneNumber(employee.phoneNumber || "");
      setStatus(
        (employee.status as "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "TERMINATED") || "ACTIVE"
      );

      // Pre-fill supervisor name & email from employee record, department, or linked supervisor
      const defaultSupName =
        employee.supervisorName ||
        employee.department?.supervisorName ||
        (employee.supervisor
          ? `${employee.supervisor.firstName} ${employee.supervisor.lastName}`.trim()
          : "");
      const defaultSupEmail =
        employee.supervisorEmail ||
        employee.department?.supervisorEmail ||
        employee.supervisor?.email ||
        "";

      const parsed = parseSupervisors(defaultSupName, defaultSupEmail);
      setSupervisorName(parsed.supervisor1Name);
      setSupervisorEmail(parsed.supervisor1Email);
      setSupervisor2Name(parsed.supervisor2Name);
      setSupervisor2Email(parsed.supervisor2Email);
      setApplySupervisorToDepartment(true);

      fetch("/api/departments")
        .then((res) => res.json())
        .then((data) => {
          if (data.departments) {
            setDepartments(data.departments);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, employee]);

  if (!isOpen || !employee) return null;

  const handleDepartmentChange = (newDeptId: string) => {
    setDepartmentId(newDeptId);
    const selectedDept = departments.find((d) => d.id === newDeptId);
    if (selectedDept) {
      const parsed = parseSupervisors(selectedDept.supervisorName, selectedDept.supervisorEmail);
      if (!supervisorName && parsed.supervisor1Name) {
        setSupervisorName(parsed.supervisor1Name);
      }
      if (!supervisorEmail && parsed.supervisor1Email) {
        setSupervisorEmail(parsed.supervisor1Email);
      }
      if (!supervisor2Name && parsed.supervisor2Name) {
        setSupervisor2Name(parsed.supervisor2Name);
      }
      if (!supervisor2Email && parsed.supervisor2Email) {
        setSupervisor2Email(parsed.supervisor2Email);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("First Name and Last Name are required.");
      return;
    }

    if (!departmentId) {
      setError("Please select a department.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeCode: employeeCode.trim().toUpperCase(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          departmentId,
          designation: designation.trim() || null,
          email: email.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
          status,
          supervisorName: supervisorName.trim() || null,
          supervisorEmail: supervisorEmail.trim().toLowerCase() || null,
          supervisor2Name: supervisor2Name.trim() || null,
          supervisor2Email: supervisor2Email.trim().toLowerCase() || null,
          applySupervisorToDepartment,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update employee details.");
        return;
      }

      setSuccessMsg("Employee details and supervisor email updated successfully.");
      onSuccess();
      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err.message || "Network error occurred while updating employee.");
    } finally {
      setLoading(false);
    }
  };

  const selectedDeptName =
    departments.find((d) => d.id === departmentId)?.name ||
    employee.department?.name ||
    "Department";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-sm">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Edit Employee & Supervisor Email
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Update personnel profile and configure the supervisor email for 24-hour overdue phone alerts
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Section 1: Personnel Details */}
          <div className="space-y-3.5">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Employee Details</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  First Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First Name"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Last Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Employee ID Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
                  placeholder="e.g. OPS-001"
                  className="w-full px-3 py-2 text-xs font-mono font-bold uppercase bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <span className="inline-flex items-center space-x-1">
                    <Building2 className="w-3 h-3 text-slate-400" />
                    <span>Department</span>
                  </span>
                </label>
                <select
                  value={departmentId}
                  onChange={(e) => handleDepartmentChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Unassigned / Select Department --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <span className="inline-flex items-center space-x-1">
                    <Briefcase className="w-3 h-3 text-slate-400" />
                    <span>Job Title / Designation</span>
                  </span>
                </label>
                <input
                  type="text"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g. Field Technician"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Employment Status
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "TERMINATED")
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ON_LEAVE">ON LEAVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="TERMINATED">TERMINATED</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <span className="inline-flex items-center space-x-1">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <span>Employee Work Email</span>
                  </span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="employee@company.com"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  <span className="inline-flex items-center space-x-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>Contact Phone Number</span>
                  </span>
                </label>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+63 917 000 0000"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Supervisor Email for 24-Hour Overdue Report */}
          <div className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Department Supervisors (24-Hour Overdue Phone Alert)</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Configure up to 2 supervisors. When a company phone is overdue beyond 24 hours, both supervisors are contacted simultaneously via email.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisor 1 Full Name <span className="text-slate-400 font-normal">(Primary)</span>
                </label>
                <input
                  type="text"
                  value={supervisorName}
                  onChange={(e) => setSupervisorName(e.target.value)}
                  placeholder="e.g. Roberto Mendoza"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisor 1 Email <span className="text-indigo-600 dark:text-indigo-400 font-bold">(24h Overdue Alert)</span>
                </label>
                <input
                  type="email"
                  value={supervisorEmail}
                  onChange={(e) => setSupervisorEmail(e.target.value)}
                  placeholder="supervisor1@company.com"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisor 2 Full Name <span className="text-slate-400 font-normal">(Optional 2nd Supervisor)</span>
                </label>
                <input
                  type="text"
                  value={supervisor2Name}
                  onChange={(e) => setSupervisor2Name(e.target.value)}
                  placeholder="e.g. Maria Santos"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisor 2 Email <span className="text-slate-400 font-normal">(Optional — Also Notified)</span>
                </label>
                <input
                  type="email"
                  value={supervisor2Email}
                  onChange={(e) => setSupervisor2Email(e.target.value)}
                  placeholder="supervisor2@company.com"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <label className="flex items-center space-x-2 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applySupervisorToDepartment}
                onChange={(e) => setApplySupervisorToDepartment(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300">
                Also set as default Supervisor(s) for the entire{" "}
                <strong className="text-indigo-700 dark:text-indigo-300">{selectedDeptName}</strong>{" "}
                department
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center space-x-1.5 px-5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm transition-all"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{loading ? "Saving Changes..." : "Save Employee & Supervisor"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
