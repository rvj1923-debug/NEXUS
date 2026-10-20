"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Smartphone,
  Plus,
  FileSpreadsheet,
  Search,
  Filter,
  ShieldCheck,
  ChevronRight,
  Loader2,
  Building2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { AddPhoneModal } from "@/components/phones/add-phone-modal";
import { BulkImportPhoneModal } from "@/components/phones/bulk-import-phone-modal";
import { EmptyState } from "@/components/empty-state";

interface PhoneItem {
  id: string;
  assetTag: string;
  barcode: string | null;
  brand: string;
  model: string;
  imei: string;
  imei2: string | null;
  serialNumber: string | null;
  mobileNumber: string | null;
  condition: string;
  operationalStatus: string;
  assignmentStatus: string;
  custodyStatus: string;
  department?: {
    id: string;
    name: string;
    code: string;
  } | null;
  assignments?: Array<{
    id: string;
    status: string;
    employee: {
      id: string;
      employeeCode: string;
      firstName: string;
      lastName: string;
    };
  }>;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

export default function PhonesPage() {
  const [phones, setPhones] = useState<PhoneItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [custodyFilter, setCustodyFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);

  const fetchPhones = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (departmentId) params.set("departmentId", departmentId);
      if (custodyFilter) params.set("custodyStatus", custodyFilter);
      if (conditionFilter) params.set("condition", conditionFilter);

      const res = await fetch(`/api/phones?${params.toString()}`);
      const data = await res.json();
      if (data.phones) {
        setPhones(data.phones);
      }
    } catch (err) {
      console.error("Failed to load phones:", err);
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, custodyFilter, conditionFilter]);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => res.json())
      .then((data) => setDepartments(data.departments || []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPhones();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchPhones]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Company Phone Fleet Inventory
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              {phones.length} Registered Assets
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Physical device lifecycle, dual-status assignment vs physical custody, IMEI tracking, and condition monitoring
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIsBulkOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Bulk Import</span>
          </button>
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Phone Asset</span>
          </button>
        </div>
      </div>

      {/* Architecture Domain Notice */}
      <div className="p-3.5 rounded-xl border border-blue-100 dark:border-blue-950 bg-blue-50/50 dark:bg-blue-950/20 text-xs text-blue-900 dark:text-blue-300 flex items-start space-x-2.5">
        <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Decoupled Domain Architecture:</span> Standing assignment (<code className="font-mono text-[11px] bg-blue-100 dark:bg-blue-900/60 px-1 py-0.5 rounded">assignmentStatus</code>) and physical custody (<code className="font-mono text-[11px] bg-blue-100 dark:bg-blue-900/60 px-1 py-0.5 rounded">custodyStatus</code>) are modeled independently. Reassigning a physically checked-out device is strictly prevented until surrendered.
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Asset Tag, Brand, Model, Serial, or IMEI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap gap-2 sm:gap-0">
          {/* Department Filter */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>

          {/* Physical Custody Filter */}
          <select
            value={custodyFilter}
            onChange={(e) => setCustodyFilter(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Custody States</option>
            <option value="AVAILABLE">AVAILABLE (In Dock)</option>
            <option value="ISSUED">ISSUED (In Field)</option>
            <option value="OVERDUE">OVERDUE</option>
          </select>

          {/* Condition Filter */}
          <select
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Conditions</option>
            <option value="NEW">NEW</option>
            <option value="EXCELLENT">EXCELLENT</option>
            <option value="GOOD">GOOD</option>
            <option value="FAIR">FAIR</option>
            <option value="DAMAGED">DAMAGED</option>
          </select>
        </div>
      </div>

      {/* Phones Table */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-xs text-slate-500">Loading mobile inventory...</span>
        </div>
      ) : phones.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="No Phone Assets Found"
          description={
            search || departmentId || custodyFilter || conditionFilter
              ? "No assets match your search parameters. Try adjusting filters."
              : "No phones registered in fleet inventory. Add devices individually or use the CSV Bulk Import tool."
          }
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3.5 pl-5">Asset Tag</th>
                  <th className="p-3.5">Device Model</th>
                  <th className="p-3.5">IMEI / Identifiers</th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5">Physical Custody</th>
                  <th className="p-3.5">Assignment</th>
                  <th className="p-3.5">Condition</th>
                  <th className="p-3.5 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {phones.map((phone) => {
                  const activeAssignment = phone.assignments?.[0];

                  return (
                    <tr
                      key={phone.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Asset Tag */}
                      <td className="p-3.5 pl-5">
                        <Link
                          href={`/phones/${phone.id}`}
                          className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1.5"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          <span>{phone.assetTag}</span>
                        </Link>
                      </td>

                      {/* Device Model */}
                      <td className="p-3.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {phone.model || "OUKITEL G1"}
                        </span>
                      </td>

                      {/* IMEI & Serial (Masked by API based on role) */}
                      <td className="p-3.5 font-mono text-[11px] text-slate-500">
                        <div>
                          <span className="text-slate-400">IMEI:</span> {phone.imei}
                        </div>
                        {phone.serialNumber && (
                          <div className="text-slate-400">
                            <span>S/N:</span> {phone.serialNumber}
                          </div>
                        )}
                        {phone.mobileNumber && (
                          <div className="text-slate-400">
                            <span>Line:</span> {phone.mobileNumber}
                          </div>
                        )}
                      </td>

                      {/* Department */}
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {phone.department?.name || "General Pool"}
                        </span>
                      </td>

                      {/* Physical Custody Status */}
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            phone.custodyStatus === "AVAILABLE"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              : phone.custodyStatus === "ISSUED"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                          }`}
                        >
                          {phone.custodyStatus}
                        </span>
                      </td>

                      {/* Allocation / Assignee */}
                      <td className="p-3.5">
                        {activeAssignment ? (
                          <div>
                            <Link
                              href={`/employees/${activeAssignment.employee.id}`}
                              className="font-medium text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              {activeAssignment.employee.firstName} {activeAssignment.employee.lastName}
                            </Link>
                            <div className="text-[11px] font-mono text-slate-400">
                              {activeAssignment.employee.employeeCode}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Shared Pool</span>
                        )}
                      </td>

                      {/* Condition */}
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {phone.condition}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 pr-5 text-right">
                        <Link
                          href={`/phones/${phone.id}`}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                        >
                          <span>Details</span>
                          <ChevronRight className="w-3 h-3" />
                        </Link>
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
      <AddPhoneModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSuccess={() => {
          setIsAddOpen(false);
          fetchPhones();
        }}
      />

      <BulkImportPhoneModal
        isOpen={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        onSuccess={() => {
          setIsBulkOpen(false);
          fetchPhones();
        }}
      />
    </div>
  );
}
