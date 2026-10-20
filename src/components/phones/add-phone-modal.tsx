"use client";

import React, { useState, useEffect } from "react";
import { X, Smartphone, Loader2, AlertCircle } from "lucide-react";

interface Department {
  id: string;
  name: string;
  code: string;
}

interface AddPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddPhoneModal({ isOpen, onClose, onSuccess }: AddPhoneModalProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    assetTag: "",
    barcode: "",
    brand: "OUKITEL",
    model: "OUKITEL G1",
    imei: "",
    imei2: "",
    serialNumber: "",
    mobileNumber: "",
    simDetails: "",
    departmentId: "",
    condition: "EXCELLENT",
    issuedAccessories: "",
    notes: "",
  });

  useEffect(() => {
    if (isOpen) {
      fetch("/api/departments")
        .then((res) => res.json())
        .then((data) => {
          setDepartments(data.departments || []);
          if (data.departments?.length > 0 && !formData.departmentId) {
            setFormData((prev) => ({ ...prev, departmentId: data.departments[0].id }));
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/phones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to register phone");
        setLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError("Network error registering phone asset.");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Register Company Phone Asset
              </h3>
              <p className="text-xs text-slate-500">
                Add physical mobile device, hardware specs, and IMEI identifiers
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Asset Tag / Company Asset ID *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. PHN-2026-001"
                value={formData.assetTag}
                onChange={(e) => setFormData({ ...formData, assetTag: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Department
              </label>
              <select
                value={formData.departmentId}
                onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                <option value="">-- General Pool --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Phone Brand *
              </label>
              <input
                type="text"
                required
                placeholder="OUKITEL"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Phone Model *
              </label>
              <input
                type="text"
                required
                placeholder="OUKITEL G1"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                IMEI 1 (Primary) *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 354892019482019"
                value={formData.imei}
                onChange={(e) => setFormData({ ...formData, imei: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                IMEI 2 (Dual SIM Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 354892019482027"
                value={formData.imei2}
                onChange={(e) => setFormData({ ...formData, imei2: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Serial Number
              </label>
              <input
                type="text"
                placeholder="e.g. R58M109XAP"
                value={formData.serialNumber}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hardware Condition
              </label>
              <select
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-semibold"
              >
                <option value="EXCELLENT">EXCELLENT — Pristine / Like New</option>
                <option value="GOOD">GOOD — Normal Operating Condition</option>
                <option value="FAIR">FAIR — Minor Scratches / Signs of Wear</option>
                <option value="DAMAGED">DAMAGED — Screen Cracked / Broken</option>
                <option value="REPAIR_PENDING">REPAIR PENDING — With IT Vendor</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Assigned Mobile # (Optional)
              </label>
              <input
                type="tel"
                placeholder="e.g. +1 555-0982"
                value={formData.mobileNumber}
                onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                SIM / Carrier Details
              </label>
              <input
                type="text"
                placeholder="e.g. Verizon Corporate 5G"
                value={formData.simDetails}
                onChange={(e) => setFormData({ ...formData, simDetails: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Issued Accessories Checklist
            </label>
            <input
              type="text"
              placeholder="e.g. Charger, Case, Tempered Glass"
              value={formData.issuedAccessories}
              onChange={(e) => setFormData({ ...formData, issuedAccessories: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
            />
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              <span>Register Phone</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
