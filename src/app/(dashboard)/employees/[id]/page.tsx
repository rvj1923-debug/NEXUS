"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  User,
  Building2,
  Phone,
  Mail,
  CreditCard,
  ShieldCheck,
  History,
  AlertTriangle,
  UserX,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  Calendar,
  CheckCircle2,
  Pencil,
  ShieldAlert,
} from "lucide-react";
import { EditEmployeeModal } from "@/components/employees/edit-employee-modal";
import { DeactivateEmployeeModal } from "@/components/employees/deactivate-employee-modal";
import { DeleteEmployeeModal } from "@/components/employees/delete-employee-modal";
import { EnrollCardModal } from "@/components/nfc/enroll-card-modal";
import { ReplaceCardModal } from "@/components/nfc/replace-card-modal";

interface EmployeeDetails {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneNumber: string | null;
  designation: string | null;
  status: string;
  isActive: boolean;
  multiCardAuthorized: boolean;
  supervisorName?: string | null;
  supervisorEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  incidentReportIssued?: boolean;
  activeIncidentCase?: {
    id: string;
    caseNumber: string;
    minutesOverdue: number;
    overtimeApprovalStatus?: string;
    supervisorRemarks?: string | null;
  } | null;
  latestClearedCase?: {
    id: string;
    caseNumber: string;
    hrClearedBy?: string | null;
    hrClearedAt?: string | null;
    hrClearanceRemarks?: string | null;
  } | null;
  department: {
    id: string;
    name: string;
    code: string;
    supervisorName?: string | null;
    supervisorEmail?: string | null;
  };
  supervisor?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    designation: string | null;
    email?: string | null;
  } | null;
  nfcCards: Array<{
    id: string;
    cardUid: string;
    cardNumber: string | null;
    status: string;
    identifierType: string;
    replacementReason: string | null;
    createdAt: string;
  }>;
  custodyTransactions: Array<{
    id: string;
    transactionType: string;
    timestamp: string;
    status: string;
    phoneAsset: {
      id: string;
      assetTag: string;
      brand: string;
      model: string;
    };
    nfcReader?: {
      readerCode: string;
      locationName: string;
    } | null;
  }>;
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;

  const [employee, setEmployee] = useState<EmployeeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingIncident, setRemovingIncident] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<"overview" | "cards" | "custody">("overview");

  // Modals
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isEnrollCardOpen, setIsEnrollCardOpen] = useState(false);
  const [replacingCard, setReplacingCard] = useState<{ id: string; cardUid: string } | null>(null);

  const fetchEmployeeData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`);
      if (!res.ok) {
        throw new Error("Failed to load employee details");
      }
      const data = await res.json();
      setEmployee(data.employee);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  const handleHrRemoveIncident = async () => {
    if (!employee) return;
    try {
      setRemovingIncident(true);
      setActionMessage(null);
      const res = await fetch("/api/overdue/hr-remove-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employee.id,
          caseId: employee.activeIncidentCase?.id,
          hrOfficerName: "HR Department Admin",
          hrRemarks: `HR Department removed INCIDENT REPORT ISSUED on ${employee.firstName} ${employee.lastName} (${employee.employeeCode}).`,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage(
          data.message ||
            `✅ INCIDENT REPORT ISSUED removed by HR Department for ${employee.firstName} ${employee.lastName}.`
        );
        await fetchEmployeeData();
      }
    } catch (err) {
      console.error("Failed to remove incident report:", err);
    } finally {
      setRemovingIncident(false);
    }
  };

  useEffect(() => {
    fetchEmployeeData();
  }, [fetchEmployeeData]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="text-xs text-slate-500 font-medium">Retrieving personnel profile...</span>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4">
        <div className="p-3 bg-red-50 text-red-600 rounded-2xl inline-block">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Personnel Record Not Found
        </h2>
        <p className="text-xs text-slate-500">
          {error || "The requested employee ID does not exist or may have been permanently purged."}
        </p>
        <Link
          href="/employees"
          className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-white hover:bg-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Directory</span>
        </Link>
      </div>
    );
  }

  const activeCard = employee.nfcCards?.find((c) => c.status === "ACTIVE");

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
        <Link
          href="/employees"
          className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Directory</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {employee.incidentReportIssued && (
            <button
              onClick={handleHrRemoveIncident}
              disabled={removingIncident}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                {removingIncident
                  ? "Removing Incident Report..."
                  : "HR: Remove INCIDENT REPORT ISSUED"}
              </span>
            </button>
          )}

          <button
            onClick={() => setIsEditOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit Employee & Supervisor Email</span>
          </button>

          {employee.isActive && (
            <button
              onClick={() => setIsDeactivateOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition-colors"
            >
              <UserX className="w-3.5 h-3.5" />
              <span>Deactivate</span>
            </button>
          )}

          <button
            onClick={() => setIsDeleteOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/60 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Employee</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {employee.incidentReportIssued && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-xl bg-rose-600 text-white shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-extrabold text-rose-900 dark:text-rose-200 uppercase tracking-wide">
                🚨 INCIDENT REPORT ISSUED — 24-Hour Overdue Company Phone
              </div>
              <p className="text-xs text-rose-800 dark:text-rose-300 mt-0.5">
                This employee has an active <strong>INCIDENT REPORT ISSUED</strong> status due to an unreturned company phone past 24 hours
                {employee.activeIncidentCase ? ` (Case ${employee.activeIncidentCase.caseNumber})` : ""}. The HR Department can remove this incident report status below.
              </p>
            </div>
          </div>
          <button
            onClick={handleHrRemoveIncident}
            disabled={removingIncident}
            className="shrink-0 inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {removingIncident ? "Removing..." : "Remove INCIDENT REPORT ISSUED (HR)"}
            </span>
          </button>
        </div>
      )}

      {/* Profile Overview Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl shadow-md shrink-0">
              {employee.firstName.charAt(0)}
              {employee.lastName.charAt(0)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {employee.firstName} {employee.lastName}
                </h1>
                {employee.isActive ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    Active
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                    Deactivated
                  </span>
                )}
                {employee.incidentReportIssued ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-600 text-white">
                    🚨 INCIDENT REPORT ISSUED
                  </span>
                ) : employee.latestClearedCase ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                    ✓ Incident Report Removed by HR
                  </span>
                ) : null}
                {employee.multiCardAuthorized && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    Multi-Card Authorized
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-y-1 gap-x-3">
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  {employee.employeeCode}
                </span>
                <span>•</span>
                <span>{employee.designation || "Staff Member"}</span>
                <span>•</span>
                <span className="flex items-center space-x-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{employee.department.name}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 md:pl-6">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Active Card
              </span>
              <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {activeCard ? activeCard.cardUid : "None"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Department
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block truncate max-w-[120px]">
                {employee.department.name}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 col-span-2 sm:col-span-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Custody Taps
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {employee.custodyTransactions?.length || 0} Events
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "overview"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <User className="w-4 h-4" />
          <span>Personnel Profile</span>
        </button>

        <button
          onClick={() => setActiveTab("cards")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "cards"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>NFC Credentials ({employee.nfcCards?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab("custody")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "custody"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <History className="w-4 h-4" />
          <span>Custody Audit Trail ({employee.custodyTransactions?.length || 0})</span>
        </button>
      </div>

      {/* Tab 1: Personnel Profile */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact & Administrative Details */}
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Administrative & Contact Parameters
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 flex items-center space-x-2">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Corporate Email:</span>
                </span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {employee.email || "Not Provided"}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 flex items-center space-x-2">
                  <Phone className="w-3.5 h-3.5" />
                  <span>Contact Phone:</span>
                </span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {employee.phoneNumber || "Not Provided"}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 flex items-center space-x-2">
                  <User className="w-3.5 h-3.5" />
                  <span>Assigned Supervisor(s):</span>
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-200 text-right">
                  {employee.supervisorName ||
                    employee.department?.supervisorName ||
                    (employee.supervisor
                      ? `${employee.supervisor.firstName} ${employee.supervisor.lastName} (${employee.supervisor.employeeCode})`
                      : "Not Configured")}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 flex items-center space-x-2">
                  <Mail className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Supervisor Email(s) (24h Overdue):</span>
                </span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 text-right">
                  {employee.supervisorEmail ||
                    employee.department?.supervisorEmail ||
                    employee.supervisor?.email || (
                      <button
                        onClick={() => setIsEditOpen(true)}
                        className="text-amber-600 dark:text-amber-400 hover:underline font-sans"
                      >
                        + Add Supervisor Email
                      </button>
                    )}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500 flex items-center space-x-2">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Enrollment Date:</span>
                </span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {new Date(employee.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Department & Operational Parameters */}
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Department & Operational Status
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 flex items-center space-x-2">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Department:</span>
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {employee.department.name} ({employee.department.code})
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Designation / Role:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {employee.designation || "Staff Member"}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Account Status:</span>
                <span>
                  {employee.isActive ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                      Deactivated
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500">Multi-Card Access:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {employee.multiCardAuthorized ? "Authorized" : "Standard (Single Badge)"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: NFC Credentials */}
      {activeTab === "cards" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Assigned NFC Physical Cards
              </h3>
              <p className="text-xs text-slate-500">
                Card credentials linked to this personnel profile. Replacing a credential retains historical custody integrity.
              </p>
            </div>
            <button
              onClick={() => setIsEnrollCardOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Enroll New Card</span>
            </button>
          </div>

          {employee.nfcCards && employee.nfcCards.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Card UID</th>
                    <th className="p-3">Card Number</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Issued Date</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {employee.nfcCards.map((card) => (
                    <tr key={card.id}>
                      <td className="p-3 font-mono font-semibold text-purple-700 dark:text-purple-300">
                        {card.cardUid}
                      </td>
                      <td className="p-3 font-mono text-slate-500">{card.cardNumber || "—"}</td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {card.identifierType}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            card.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : card.status === "REVOKED"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {card.status}
                        </span>
                        {card.replacementReason && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Reason: {card.replacementReason}
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(card.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        {card.status === "ACTIVE" && (
                          <button
                            onClick={() =>
                              setReplacingCard({ id: card.id, cardUid: card.cardUid })
                            }
                            className="inline-flex items-center space-x-1 px-2 py-1 text-[11px] font-medium rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 transition-colors"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Replace Card</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-xl">
              No NFC credentials registered for this employee.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Custody Audit Trail */}
      {activeTab === "custody" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Physical Custody Transaction Log
          </h3>

          {employee.custodyTransactions && employee.custodyTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Event Type</th>
                    <th className="p-3">Device</th>
                    <th className="p-3">Reader / Kiosk</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {employee.custodyTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(tx.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold">
                        {tx.transactionType === "ISSUANCE" ? (
                          <span className="text-indigo-600 dark:text-indigo-400">
                            Check-Out (Issuance)
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Check-In (Surrender)
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono">
                        {tx.phoneAsset.assetTag}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {tx.nfcReader?.locationName || "Custody Desk"}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-xl">
              No physical custody transactions logged for this employee yet.
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <EditEmployeeModal
        isOpen={isEditOpen}
        employee={employee}
        onClose={() => setIsEditOpen(false)}
        onSuccess={() => {
          fetchEmployeeData();
        }}
      />

      <DeactivateEmployeeModal
        isOpen={isDeactivateOpen}
        employee={{
          id: employee.id,
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
        }}
        onClose={() => setIsDeactivateOpen(false)}
        onSuccess={() => {
          setIsDeactivateOpen(false);
          fetchEmployeeData();
        }}
      />

      <EnrollCardModal
        isOpen={isEnrollCardOpen}
        initialEmployeeId={employee.id}
        onClose={() => setIsEnrollCardOpen(false)}
        onSuccess={() => {
          setIsEnrollCardOpen(false);
          fetchEmployeeData();
        }}
      />

      {replacingCard && (
        <ReplaceCardModal
          isOpen={Boolean(replacingCard)}
          card={{
            id: replacingCard.id,
            cardUid: replacingCard.cardUid,
            employee: {
              firstName: employee.firstName,
              lastName: employee.lastName,
              employeeCode: employee.employeeCode,
            },
          }}
          onClose={() => setReplacingCard(null)}
          onSuccess={() => {
            setReplacingCard(null);
            fetchEmployeeData();
          }}
        />
      )}

      {isDeleteOpen && (
        <DeleteEmployeeModal
          isOpen={isDeleteOpen}
          employee={{
            id: employee.id,
            employeeCode: employee.employeeCode,
            firstName: employee.firstName,
            lastName: employee.lastName,
          }}
          onClose={() => setIsDeleteOpen(false)}
          onSuccess={() => {
            router.push("/employees");
          }}
        />
      )}
    </div>
  );
}
