"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Smartphone,
  ShieldCheck,
  Building2,
  Calendar,
  History,
  User,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Plus,
  Wrench,
  CheckCircle2,
  Tag,
  Hash,
} from "lucide-react";
import { NewAssignmentModal } from "@/components/assignments/new-assignment-modal";
import { ReplaceAssignmentModal } from "@/components/assignments/replace-assignment-modal";

interface PhoneDetail {
  id: string;
  assetTag: string;
  barcode: string | null;
  brand: string;
  model: string;
  imei: string;
  imei2: string | null;
  serialNumber: string | null;
  mobileNumber: string | null;
  simDetails: string | null;
  condition: string;
  operationalStatus: string;
  assignmentStatus: string;
  custodyStatus: string;
  issuedAccessories: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  department?: {
    id: string;
    name: string;
    code: string;
  } | null;
  assignments: Array<{
    id: string;
    status: string;
    assignmentType: string;
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
    assignedByUser?: {
      fullName: string;
      email: string;
    } | null;
  }>;
  transactions: Array<{
    id: string;
    transactionType: string;
    timestamp: string;
    status: string;
    employee: {
      id: string;
      employeeCode: string;
      firstName: string;
      lastName: string;
    };
    nfcReader?: {
      readerCode: string;
      locationName: string;
    } | null;
  }>;
  incidents: Array<{
    id: string;
    incidentNumber: string;
    type: string;
    severity: string;
    status: string;
    description: string;
    createdAt: string;
  }>;
}

export default function PhoneDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const phoneId = resolvedParams.id;

  const [phone, setPhone] = useState<PhoneDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"specs" | "assignments" | "custody" | "incidents">("specs");

  // Modals
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [replacingAssignment, setReplacingAssignment] = useState<any | null>(null);

  const fetchPhoneData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/phones/${phoneId}`);
      if (!res.ok) {
        throw new Error("Failed to load device details");
      }
      const data = await res.json();
      setPhone(data.phone);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [phoneId]);

  useEffect(() => {
    fetchPhoneData();
  }, [fetchPhoneData]);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs text-slate-500 font-medium">Retrieving hardware asset record...</span>
      </div>
    );
  }

  if (error || !phone) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4">
        <div className="p-3 bg-red-50 text-red-600 rounded-2xl inline-block">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Device Record Not Found
        </h2>
        <p className="text-xs text-slate-500">
          {error || "The requested phone asset does not exist in inventory."}
        </p>
        <Link
          href="/phones"
          className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-white hover:bg-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Phone Inventory</span>
        </Link>
      </div>
    );
  }

  const activeAssignment = phone.assignments?.find((a) => a.status === "ACTIVE");

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Nav */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <Link
          href="/phones"
          className="inline-flex items-center space-x-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Phone Inventory</span>
        </Link>

        <div className="flex items-center space-x-2">
          {!activeAssignment && phone.custodyStatus !== "ISSUED" && (
            <button
              onClick={() => setIsAssignModalOpen(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Assign to Personnel</span>
            </button>
          )}

          {activeAssignment && (
            <button
              onClick={() =>
                setReplacingAssignment({
                  id: activeAssignment.id,
                  employee: activeAssignment.employee,
                  phoneAsset: {
                    id: phone.id,
                    assetTag: phone.assetTag,
                    brand: phone.brand,
                    model: phone.model,
                  },
                })
              }
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Replace Device</span>
            </button>
          )}
        </div>
      </div>

      {/* Profile Overview Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
              <Smartphone className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <span className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
                  {phone.assetTag}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    phone.custodyStatus === "AVAILABLE"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                      : phone.custodyStatus === "ISSUED"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                  }`}
                >
                  Custody: {phone.custodyStatus}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Policy: {phone.assignmentStatus}
                </span>
              </div>

              <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-y-1 gap-x-3">
                <span className="font-mono">IMEI: {phone.imei}</span>
                {phone.department && (
                  <>
                    <span>•</span>
                    <span className="flex items-center space-x-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>{phone.department.name}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Metrics Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t md:border-t-0 md:border-l border-slate-100 dark:border-slate-800 pt-4 md:pt-0 md:pl-6">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Assigned To
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block truncate">
                {activeAssignment
                  ? `${activeAssignment.employee.firstName} ${activeAssignment.employee.lastName}`
                  : "Unassigned"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Condition
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {phone.condition}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 col-span-2 sm:col-span-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Total Custody Taps
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {phone.transactions?.length || 0} Events
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("specs")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "specs"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Tag className="w-4 h-4" />
          <span>Specifications & Serial</span>
        </button>

        <button
          onClick={() => setActiveTab("assignments")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "assignments"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <User className="w-4 h-4" />
          <span>Allocation History ({phone.assignments?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab("custody")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "custody"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <History className="w-4 h-4" />
          <span>Custody Logs ({phone.transactions?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab("incidents")}
          className={`pb-3 transition-colors flex items-center space-x-2 border-b-2 ${
            activeTab === "incidents"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <Wrench className="w-4 h-4" />
          <span>Incidents & Damages ({phone.incidents?.length || 0})</span>
        </button>
      </div>

      {/* Tab 1: Specs */}
      {activeTab === "specs" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Hardware Identifiers & Radio Telecom
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Asset Tag ID:</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {phone.assetTag}
                </span>
              </div>

              {phone.barcode && (
                <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Barcode / 2D Matrix:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {phone.barcode}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Primary IMEI:</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                  {phone.imei}
                </span>
              </div>

              {phone.imei2 && (
                <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Secondary IMEI (eSIM):</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">{phone.imei2}</span>
                </div>
              )}

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Manufacturer Serial:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {phone.serialNumber || "—"}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Assigned Mobile Line:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {phone.mobileNumber || "No SIM Attached"}
                </span>
              </div>

              {phone.simDetails && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-500">SIM ICCID / Carrier:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {phone.simDetails}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Accessories & Asset Lifecycle
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Issued Accessories:</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {phone.issuedAccessories || "Device Unit Only"}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Registered On:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {new Date(phone.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Department Custody Scope:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {phone.department?.name || "General Enterprise Pool"}
                </span>
              </div>

              {phone.notes && (
                <div className="pt-2">
                  <span className="text-slate-500 block mb-1">Asset Custodian Notes:</span>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs">
                    {phone.notes}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Allocation History */}
      {activeTab === "assignments" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Personnel Allocation History
            </h3>
          </div>

          {phone.assignments && phone.assignments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Assigned Employee</th>
                    <th className="p-3">Policy Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Start Date</th>
                    <th className="p-3">End Date</th>
                    <th className="p-3">Authorized By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {phone.assignments.map((asgn) => (
                    <tr key={asgn.id}>
                      <td className="p-3">
                        <Link
                          href={`/employees/${asgn.employee.id}`}
                          className="font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {asgn.employee.firstName} {asgn.employee.lastName}
                        </Link>
                        <div className="text-[11px] font-mono text-slate-400">
                          {asgn.employee.employeeCode}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">
                        {asgn.assignmentType}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            asgn.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : asgn.status === "REPLACED"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {asgn.status}
                        </span>
                        {asgn.notes && (
                          <div className="text-[10px] text-slate-400 mt-0.5">{asgn.notes}</div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(asgn.startDate).toLocaleDateString()}
                      </td>
                      <td className="p-3 font-mono text-slate-500">
                        {asgn.endDate ? new Date(asgn.endDate).toLocaleDateString() : "Current"}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400 text-[11px]">
                        {asgn.assignedByUser ? asgn.assignedByUser.fullName : "System Init"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-xl">
              No personnel assignments recorded for this device.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Custody Logs */}
      {activeTab === "custody" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Physical Custody Movement History
          </h3>

          {phone.transactions && phone.transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Event Type</th>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Reader / Kiosk</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {phone.transactions.map((tx) => (
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
                      <td className="p-3">
                        {tx.employee ? (
                          <Link
                            href={`/employees/${tx.employee.id}`}
                            className="font-medium text-slate-800 dark:text-slate-200 hover:underline"
                          >
                            {tx.employee.firstName} {tx.employee.lastName}
                          </Link>
                        ) : (
                          <span className="text-slate-500 font-mono text-[11px]">Direct NFC Tap</span>
                        )}
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
              No physical custody movement logs for this device yet.
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Incidents */}
      {activeTab === "incidents" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Damages, Defects & Maintenance Tickets
          </h3>

          {phone.incidents && phone.incidents.length > 0 ? (
            <div className="space-y-3">
              {phone.incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {inc.incidentNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                      {inc.severity} Severity
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{inc.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-xl">
              No incidents or damage reports logged for this asset.
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <NewAssignmentModal
        isOpen={isAssignModalOpen}
        preselectedPhoneId={phone.id}
        onClose={() => setIsAssignModalOpen(false)}
        onSuccess={() => {
          setIsAssignModalOpen(false);
          fetchPhoneData();
        }}
      />

      {replacingAssignment && (
        <ReplaceAssignmentModal
          isOpen={Boolean(replacingAssignment)}
          assignment={replacingAssignment}
          onClose={() => setReplacingAssignment(null)}
          onSuccess={() => {
            setReplacingAssignment(null);
            fetchPhoneData();
          }}
        />
      )}
    </div>
  );
}
