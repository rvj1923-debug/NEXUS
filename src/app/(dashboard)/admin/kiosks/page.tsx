"use client";

import React, { useState, useEffect } from "react";
import {
  Tablet,
  Plus,
  RefreshCw,
  Search,
  Radio,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Globe,
  Settings,
  Trash2,
  Lock,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface KioskDevice {
  id: string;
  kioskCode: string;
  name: string;
  location: string;
  readerIdentifier: string | null;
  status: "ACTIVE" | "DISABLED" | "REVOKED";
  ipAddress: string | null;
  displayLanguage: "EN" | "FIL";
  soundEnabled: boolean;
  theme: "light" | "dark";
  inactivityTimeoutSeconds: number;
  lastHeartbeatAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastError: string | null;
  createdAt: string;
  _count?: { verificationRequests: number };
}

interface NfcReaderOption {
  id: string;
  readerIdentifier: string;
  name: string;
  location: string;
  status: string;
}

export default function AdminKiosksPage() {
  const [kiosks, setKiosks] = useState<KioskDevice[]>([]);
  const [readers, setReaders] = useState<NfcReaderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastBackupFile, setLastBackupFile] = useState<string | null>(null);
  const [lastMirrorOk, setLastMirrorOk] = useState<boolean | null>(null);
  const [lastMirrorError, setLastMirrorError] = useState<string | null>(null);

  // Create Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [kioskCode, setKioskCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [selectedReader, setSelectedReader] = useState("");
  const [language, setLanguage] = useState<"EN" | "FIL">("EN");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [kioskTheme, setKioskTheme] = useState<"light" | "dark">("light");
  const [timeoutSeconds, setTimeoutSeconds] = useState(30);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchKiosks = async () => {
    setLoading(true);
    try {
      const [res, healthRes] = await Promise.all([
        fetch("/api/admin/kiosks"),
        fetch("/api/health").catch(() => null),
      ]);
      const data = await res.json();
      if (res.ok) {
        setKiosks(data.kiosks || []);
        setReaders(data.availableReaders || []);
      }
      if (healthRes) {
        const healthData = await healthRes.json().catch(() => null);
        if (healthData) {
          setLastBackupAt(healthData.lastBackupAt ?? null);
          setLastBackupFile(healthData.lastBackupFile ?? null);
          setLastMirrorOk(
            typeof healthData.lastMirrorOk === "boolean" ? healthData.lastMirrorOk : null
          );
          setLastMirrorError(healthData.lastMirrorError ?? null);
        }
      }
    } catch (e) {
      console.error("Failed to load kiosks:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKiosks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError("");

    try {
      const res = await fetch("/api/admin/kiosks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kioskCode,
          name,
          location,
          readerIdentifier: selectedReader || null,
          displayLanguage: language,
          soundEnabled,
          theme: kioskTheme,
          inactivityTimeoutSeconds: Number(timeoutSeconds),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to create kiosk.");
        setCreating(false);
        return;
      }

      setCreateModalOpen(false);
      setKioskCode("");
      setName("");
      setLocation("");
      fetchKiosks();
    } catch {
      setFormError("Network error creating kiosk.");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateKioskSetting = async (
    kioskId: string,
    patch: Partial<Pick<KioskDevice, "displayLanguage" | "soundEnabled" | "theme">>
  ) => {
    try {
      const res = await fetch(`/api/admin/kiosks/${kioskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        fetchKiosks();
      }
    } catch {
      alert("Error updating kiosk settings.");
    }
  };

  const handleToggleStatus = async (kiosk: KioskDevice) => {
    const newStatus = kiosk.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/kiosks/${kiosk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) fetchKiosks();
    } catch {
      alert("Error updating kiosk status.");
    }
  };

  const handleRevokeSession = async (kiosk: KioskDevice) => {
    if (!confirm(`Are you sure you want to revoke the session secret for ${kiosk.kioskCode}? The kiosk terminal will require re-pairing.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/kiosks/${kiosk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeSession: true }),
      });
      if (res.ok) {
        alert("Session revoked successfully.");
        fetchKiosks();
      }
    } catch {
      alert("Error revoking session.");
    }
  };

  const handleDelete = async (kiosk: KioskDevice) => {
    if (!confirm(`Permanently remove kiosk registration for ${kiosk.kioskCode}?`)) return;

    try {
      const res = await fetch(`/api/admin/kiosks/${kiosk.id}`, { method: "DELETE" });
      if (res.ok) fetchKiosks();
    } catch {
      alert("Error deleting kiosk.");
    }
  };

  const filtered = kiosks.filter(
    (k) =>
      k.kioskCode.toLowerCase().includes(search.toLowerCase()) ||
      k.name.toLowerCase().includes(search.toLowerCase()) ||
      k.location.toLowerCase().includes(search.toLowerCase())
  );

  const backupAgeMs = lastBackupAt ? Date.now() - new Date(lastBackupAt).getTime() : null;
  const isBackupStale =
    !lastBackupAt || backupAgeMs === null || Number.isNaN(backupAgeMs) || backupAgeMs > 2 * 60 * 60 * 1000;
  const formattedLastBackup = lastBackupAt
    ? new Date(lastBackupAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Never";

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <Tablet className="w-6 h-6 text-indigo-600" />
            <span>Kiosk Terminal Management</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Register and govern self-service NFC kiosks, assign readers, monitor heartbeats and revoke compromised sessions
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href="/kiosk"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
          >
            <ExternalLink className="w-4 h-4 mr-1.5 text-blue-600" />
            Launch Live Kiosk
          </a>

          <button
            onClick={() => setCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Register Kiosk
          </button>
        </div>
      </div>

      {/* Database Backup Telemetry Banner */}
      <div
        className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
          isBackupStale || lastMirrorOk === false
            ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
            : "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
        }`}
      >
        <div className="flex items-center space-x-2.5">
          {isBackupStale || lastMirrorOk === false ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          )}
          <div>
            <span className="font-semibold">Last backup: {formattedLastBackup}</span>
            {lastBackupFile && (
              <span className="ml-2 font-mono text-[11px] opacity-75">({lastBackupFile})</span>
            )}
            {isBackupStale && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-bold text-[10px]">
                Warning: Backup is more than 2 hours old
              </span>
            )}
            {lastMirrorOk === false && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-rose-200/80 dark:bg-rose-900 text-rose-900 dark:text-rose-200 font-bold text-[10px]">
                Mirror failed{lastMirrorError ? `: ${lastMirrorError}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] opacity-80 flex items-center space-x-1">
          <Clock className="w-3.5 h-3.5 mr-1" />
          <span>Scheduled every 30 min on custody changes (48 frequent + 30 daily kept)</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium">Total Registered</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{kiosks.length}</h3>
            </div>
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600">
              <Tablet className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium">Active Stations</p>
              <h3 className="text-2xl font-bold text-emerald-600 mt-1">
                {kiosks.filter((k) => k.status === "ACTIVE").length}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium">Disabled / Revoked</p>
              <h3 className="text-2xl font-bold text-rose-600 mt-1">
                {kiosks.filter((k) => k.status !== "ACTIVE").length}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-medium">Paired Readers</p>
              <h3 className="text-2xl font-bold text-blue-600 mt-1">
                {kiosks.filter((k) => k.readerIdentifier).length}
              </h3>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600">
              <Radio className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Table */}
      <Card>
        <CardHeader className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by code, name or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            onClick={fetchKiosks}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 self-end sm:self-auto"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Kiosk Code</th>
                <th className="px-4 py-3">Location & Name</th>
                <th className="px-4 py-3">Assigned Reader</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Language, Theme &amp; Sound</th>
                <th className="px-4 py-3">Last Scan</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No kiosk terminals found.
                  </td>
                </tr>
              ) : (
                filtered.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {k.kioskCode}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{k.name}</div>
                      <div className="text-[11px] text-slate-400">{k.location}</div>
                    </td>
                    <td className="px-4 py-3">
                      {k.readerIdentifier ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-[11px]">
                          <Radio className="w-3 h-3 mr-1" />
                          {k.readerIdentifier}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          k.status === "ACTIVE"
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                            : k.status === "DISABLED"
                            ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                            : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        {k.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          aria-label={`Language for ${k.kioskCode}`}
                          value={k.displayLanguage || "EN"}
                          onChange={(e) =>
                            handleUpdateKioskSetting(k.id, {
                              displayLanguage: e.target.value as "EN" | "FIL",
                            })
                          }
                          className="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold text-slate-800 dark:text-slate-200"
                        >
                          <option value="EN">Lang: EN</option>
                          <option value="FIL">Lang: FIL</option>
                        </select>

                        <select
                          aria-label={`Theme for ${k.kioskCode}`}
                          value={k.theme || "light"}
                          onChange={(e) =>
                            handleUpdateKioskSetting(k.id, {
                              theme: e.target.value as "light" | "dark",
                            })
                          }
                          className="px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold text-slate-800 dark:text-slate-200"
                        >
                          <option value="light">Theme: Light</option>
                          <option value="dark">Theme: Dark</option>
                        </select>

                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateKioskSetting(k.id, {
                              soundEnabled: !(k.soundEnabled ?? true),
                            })
                          }
                          className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold transition ${
                            (k.soundEnabled ?? true)
                              ? "border-indigo-200 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
                              : "border-slate-200 bg-slate-100 dark:bg-slate-800 text-slate-500"
                          }`}
                        >
                          {(k.soundEnabled ?? true) ? "Sound: On" : "Sound: Off"}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        Timeout: {k.inactivityTimeoutSeconds}s
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {k.lastSuccessfulScanAt
                        ? new Date(k.lastSuccessfulScanAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <button
                        onClick={() => handleToggleStatus(k)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
                          k.status === "ACTIVE"
                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                        title="Enable or disable kiosk"
                      >
                        {k.status === "ACTIVE" ? "Disable" : "Enable"}
                      </button>

                      <button
                        onClick={() => handleRevokeSession(k)}
                        className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-amber-600 hover:bg-slate-50 transition"
                        title="Revoke session key"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDelete(k)}
                        className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-600 hover:bg-slate-50 transition"
                        title="Delete kiosk"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Register Kiosk Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Tablet className="w-5 h-5 text-indigo-600" />
              <span>Register New Kiosk Station</span>
            </h3>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Kiosk Code (Unique ID)
                </label>
                <input
                  type="text"
                  placeholder="e.g. KIOSK-LOBBY-01"
                  value={kioskCode}
                  onChange={(e) => setKioskCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Station Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ground Floor Main Entrance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Physical Worksite / Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tower 1 Turnstile Hall"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Assign NFC Reader
                </label>
                <select
                  value={selectedReader}
                  onChange={(e) => setSelectedReader(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- No Reader Assigned --</option>
                  {readers.map((r) => (
                    <option key={r.id} value={r.readerIdentifier}>
                      {r.readerIdentifier} — {r.name} ({r.location})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Display Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="EN">English (EN)</option>
                    <option value="FIL">Filipino (FIL)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Inactivity Timeout (s)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Default Theme
                  </label>
                  <select
                    value={kioskTheme}
                    onChange={(e) => setKioskTheme(e.target.value as "light" | "dark")}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Audio Chimes
                  </label>
                  <select
                    value={soundEnabled ? "true" : "false"}
                    onChange={(e) => setSoundEnabled(e.target.value === "true")}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="true">Enabled</option>
                    <option value="false">Muted</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center space-x-1"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Register Station</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
