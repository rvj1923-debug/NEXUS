"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Radio,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  RefreshCw,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ClockAlert,
  Smartphone,
  User,
  ShieldCheck,
  Tablet,
  Download,
  Calendar,
  Layers,
  ArrowRight,
  ExternalLink,
  X,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

interface LiveEvent {
  id: string;
  transactionCode: string;
  transactionType: "TIME_IN" | "TIME_OUT";
  status: string;
  timestamp: string;
  actualReturnAt: string | null;
  returnStatus: string | null;
  custodyDurationMinutes: number | null;
  overdueMinutes: number;
  conditionAtAction: string;
  verifiedViaNfc: boolean;
  phoneAsset: {
    id: string;
    assetTag: string;
    brand: string;
    model: string;
    imei: string;
    color: string | null;
    custodyStatus: string;
  } | null;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    firstName: string;
    lastName: string;
    departmentName: string;
    departmentCode: string;
  } | null;
  nfcReader: {
    id?: string;
    name: string;
    location: string;
    readerIdentifier: string;
  };
  nfcCard: {
    cardUid: string;
    cardNumber: string;
  } | null;
  hasOverdueCase: boolean;
}

interface StatsData {
  currentlyActive: number;
  timedInToday: number;
  timedOutToday: number;
  overdueCount: number;
  totalPhones: number;
  availablePhones: number;
  avgDurationMinutes: number;
}

// Web Audio API chime synthesizer
function playEventChime(type: "TIME_IN" | "TIME_OUT") {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";

    if (type === "TIME_IN") {
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.frequency.setValueAtTime(783.99, ctx.currentTime); // G5
      osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.18); // C5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    }
  } catch {}
}

function formatRelativeTime(isoString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(isoString).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} mins`;
  return `${h}h ${m}m`;
}

export default function LiveMonitorPage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [stats, setStats] = useState<StatsData>({
    currentlyActive: 0,
    timedInToday: 0,
    timedOutToday: 0,
    overdueCount: 0,
    totalPhones: 0,
    availablePhones: 0,
    avgDurationMinutes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "TIME_IN" | "TIME_OUT" | "OVERDUE">("ALL");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"STREAM" | "TABLE">("STREAM");
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(3);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<LiveEvent | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const prevEventCountRef = useRef<number>(0);
  const latestTxCodeRef = useRef<string>("");

  const fetchData = useCallback(async (isManual = false) => {
    try {
      if (isManual) setLoading(true);
      const query = new URLSearchParams();
      if (typeFilter === "TIME_IN" || typeFilter === "TIME_OUT") {
        query.set("type", typeFilter);
      } else if (typeFilter === "OVERDUE") {
        query.set("status", "OVERDUE");
      }
      if (search) query.set("search", search);
      query.set("limit", "100");

      const res = await fetch(`/api/monitoring/time-in-out?${query.toString()}`);
      if (!res.ok) throw new Error("Failed to load live monitor feed");
      const data = await res.json();

      const newEvents: LiveEvent[] = data.events || [];
      setEvents(newEvents);
      if (data.stats) {
        setStats(data.stats);
      }
      setLastRefreshedAt(new Date().toLocaleTimeString());

      // Trigger audio chime if a brand new transaction just landed
      if (newEvents.length > 0 && latestTxCodeRef.current && newEvents[0].transactionCode !== latestTxCodeRef.current) {
        if (soundEnabled) {
          playEventChime(newEvents[0].transactionType);
        }
      }

      if (newEvents.length > 0) {
        latestTxCodeRef.current = newEvents[0].transactionCode;
      }
      prevEventCountRef.current = newEvents.length;
    } catch (err) {
      console.error("Live monitor fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search, soundEnabled]);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [typeFilter, search]);

  // Periodic polling interval
  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const interval = setInterval(() => {
      fetchData();
    }, autoRefreshSec * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshSec, fetchData]);

  // Fullscreen handler
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Export filtered events to CSV
  const handleExportCsv = () => {
    if (events.length === 0) return;
    const headers = [
      "Transaction Code",
      "Event Type",
      "Timestamp",
      "Return Timestamp",
      "Asset Tag",
      "Brand",
      "Model",
      "IMEI",
      "Employee Code",
      "Employee Name",
      "Department",
      "Reader Station",
      "Duration (Minutes)",
      "Return Status",
      "Condition",
    ];

    const rows = events.map((ev) => [
      ev.transactionCode,
      ev.transactionType,
      ev.timestamp,
      ev.actualReturnAt || "",
      ev.phoneAsset?.assetTag || "",
      ev.phoneAsset?.brand || "",
      ev.phoneAsset?.model || "",
      ev.phoneAsset?.imei || "",
      ev.employee?.employeeCode || "",
      ev.employee?.fullName || "",
      ev.employee?.departmentName || "",
      `${ev.nfcReader?.name} (${ev.nfcReader?.location})`,
      ev.custodyDurationMinutes ?? "",
      ev.returnStatus || "",
      ev.conditionAtAction || "GOOD",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Live_Phone_Time_In_Out_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Telemetry Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center space-x-2.5">
              <span>Live Phone Time In / Time Out Monitor</span>
            </h1>
            {/* Live Pulsing Radar Beacon */}
            <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>LIVE</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time turnstile telemetry tracking company smartphone departure (Time In) and depot restow (Time Out)
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl border text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              soundEnabled
                ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-800 dark:text-indigo-300"
                : "border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={soundEnabled ? "Audio chime active for new scans" : "Audio muted"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
            <span className="hidden sm:inline">{soundEnabled ? "Chime On" : "Chime Off"}</span>
          </button>

          {/* Auto Refresh Interval */}
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={autoRefreshSec}
              onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
              className="bg-transparent text-slate-700 dark:text-slate-300 text-xs focus:outline-none cursor-pointer"
            >
              <option value={3}>Auto: 3s</option>
              <option value={5}>Auto: 5s</option>
              <option value={10}>Auto: 10s</option>
              <option value={0}>Paused</option>
            </select>
          </div>

          {/* Manual Refresh Button */}
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            title="Toggle Fullscreen Depot Display"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* CSV Export */}
          <button
            onClick={handleExportCsv}
            disabled={events.length === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700 disabled:opacity-50"
            title="Export time in / time out records to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Export CSV</span>
          </button>

          {/* Link to Turnstile Kiosk */}
          <Link
            href="/kiosk"
            target="_blank"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02]"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span>Launch Kiosk</span>
            <ExternalLink className="w-3 h-3 opacity-70" />
          </Link>
        </div>
      </div>

      {/* KPI Live Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Metric 1: Timed In Today */}
        <Card className="border-l-4 border-l-emerald-500 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Timed In Today
              </span>
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1">
              {stats.timedInToday}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Device departures logged
            </p>
          </CardContent>
        </Card>

        {/* Metric 2: Timed Out Today */}
        <Card className="border-l-4 border-l-red-500 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Timed Out Today
              </span>
              <div className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-red-600 dark:text-red-400 font-mono mt-1">
              {stats.timedOutToday}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Depot returns verified
            </p>
          </CardContent>
        </Card>

        {/* Metric 3: Overdue Devices */}
        <Card className="border-l-4 border-l-rose-500 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Active Overdue
              </span>
              <div className={`p-1.5 rounded-lg ${stats.overdueCount > 0 ? "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                <ClockAlert className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-black font-mono mt-1 ${stats.overdueCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-200"}`}>
              {stats.overdueCount}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {stats.overdueCount > 0 ? "Past authorized shift deadline" : "Zero active overdue breaches"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and View Mode Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Left: Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTypeFilter("ALL")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              typeFilter === "ALL"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            All Activity ({events.length})
          </button>
          <button
            onClick={() => setTypeFilter("TIME_IN")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1.5 ${
              typeFilter === "TIME_IN"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Time In Only</span>
          </button>
          <button
            onClick={() => setTypeFilter("TIME_OUT")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1.5 ${
              typeFilter === "TIME_OUT"
                ? "bg-red-600 text-white shadow-sm"
                : "text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Time Out Only</span>
          </button>
          <button
            onClick={() => setTypeFilter("OVERDUE")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1.5 ${
              typeFilter === "OVERDUE"
                ? "bg-rose-600 text-white shadow-sm"
                : "text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            }`}
          >
            <ClockAlert className="w-3.5 h-3.5" />
            <span>Overdue Alerts</span>
          </button>
        </div>

        {/* Right: Search & View Switcher */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setViewMode("STREAM")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                viewMode === "STREAM"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              title="Stream view"
            >
              Feed
            </button>
            <button
              onClick={() => setViewMode("TABLE")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                viewMode === "TABLE"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              title="Audit Table view"
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {events.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={Radio}
              title="No Time In / Time Out Records Found"
              description="No physical custody movements match your active filter. Tapping an NFC tag on the kiosk will immediately stream here live."
              actionText="Open Kiosk Turnstile"
              actionHref="/kiosk"
            />
          </CardContent>
        </Card>
      ) : viewMode === "STREAM" ? (
        /* STREAM FEED CARDS */
        <div className="space-y-3">
          {events.map((ev, idx) => {
            const isTimeIn = ev.transactionType === "TIME_IN";
            const isOverdue = ev.status === "OVERDUE" || ev.hasOverdueCase;

            return (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className={`group p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer hover:shadow-md ${
                  idx === 0
                    ? "border-indigo-300 dark:border-indigo-800/80 ring-2 ring-indigo-500/20"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Left: Action Icon + Highlighted Employee Name */}
                  <div className="flex items-start space-x-3.5">
                    {/* Event Type Icon Pill */}
                    <div
                      className={`p-3 rounded-2xl shrink-0 shadow-sm transition-transform group-hover:scale-105 ${
                        isTimeIn
                          ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                          : "bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
                      }`}
                    >
                      {isTimeIn ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownLeft className="w-6 h-6" />}
                    </div>

                    <div className="space-y-1">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                            isTimeIn
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {isTimeIn ? "TIME IN" : "TIME OUT"}
                        </span>

                        {isOverdue && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            <ClockAlert className="w-3 h-3" />
                            <span>OVERDUE</span>
                          </span>
                        )}

                        {ev.verifiedViaNfc && (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            <ShieldCheck className="w-3 h-3 text-indigo-500" />
                            <span>NFC VERIFIED</span>
                          </span>
                        )}
                      </div>

                      {/* Highlighted Employee Name */}
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
                        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xl bg-indigo-50/90 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/80 shadow-2xs">
                          <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span className="font-black text-base sm:text-lg tracking-tight text-slate-900 dark:text-white">
                            {ev.employee?.fullName || "Unassigned"}
                          </span>
                        </div>
                      </div>

                      {/* Location & Reader */}
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 pt-0.5">
                        <span>Station: <strong className="text-slate-700 dark:text-slate-300">{ev.nfcReader?.name}</strong></span>
                        <span>•</span>
                        <span>Location: {ev.nfcReader?.location}</span>
                        {ev.employee?.departmentName && (
                          <>
                            <span>•</span>
                            <span>Dept: <strong className="text-slate-700 dark:text-slate-300">{ev.employee.departmentName}</strong></span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Timestamp & Duration */}
                  <div className="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 dark:border-slate-800">
                    <div className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                      {formatRelativeTime(ev.timestamp)}
                    </div>

                    {!isTimeIn && ev.custodyDurationMinutes && (
                      <div className="mt-1 sm:mt-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg inline-block">
                        Duration: {formatDuration(ev.custodyDurationMinutes)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* AUDIT TABLE VIEW */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Station / Reader</th>
                  <th className="py-3 px-4">Event Time</th>
                  <th className="py-3 px-4">Custody Duration</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {events.map((ev) => {
                  const isTimeIn = ev.transactionType === "TIME_IN";
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => setSelectedEvent(ev)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${
                            isTimeIn
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {isTimeIn ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                          <span>{isTimeIn ? "TIME IN" : "TIME OUT"}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800/70 font-extrabold text-sm text-slate-900 dark:text-white">
                          <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span>{ev.employee?.fullName || "—"}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          {ev.employee?.departmentName || "—"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        <div className="font-medium">{ev.nfcReader?.name}</div>
                        <div className="text-[11px] text-slate-400">{ev.nfcReader?.location}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-slate-800 dark:text-slate-200 font-medium">
                          {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatRelativeTime(ev.timestamp)}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-300 font-medium">
                        {isTimeIn ? (
                          <span className="text-slate-400 italic">Active in custody</span>
                        ) : (
                          formatDuration(ev.custodyDurationMinutes)
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {ev.status === "OVERDUE" ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            OVERDUE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {ev.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(ev);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-colors"
                        >
                          View Slip
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TRANSACTION AUDIT SLIP MODAL */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60">
              <div className="flex items-center space-x-3">
                <div
                  className={`p-2.5 rounded-2xl ${
                    selectedEvent.transactionType === "TIME_IN"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  }`}
                >
                  {selectedEvent.transactionType === "TIME_IN" ? (
                    <ArrowUpRight className="w-5 h-5" />
                  ) : (
                    <ArrowDownLeft className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {selectedEvent.transactionType === "TIME_IN" ? "Time In Verification Slip" : "Time Out Return Slip"}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 text-xs">
              {/* Highlighted Employee Box */}
              <div className="p-5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/50 border-2 border-indigo-200 dark:border-indigo-800/80 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Employee Name
                </div>
                <div className="font-black text-xl sm:text-2xl text-slate-900 dark:text-white">
                  {selectedEvent.employee?.fullName || "Unassigned"}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 pt-1">
                  Department: <strong className="text-slate-900 dark:text-white">{selectedEvent.employee?.departmentName}</strong>
                </div>
              </div>

              {/* Operational Telemetry Details */}
              <div className="space-y-2.5">
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Timestamp:</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {new Date(selectedEvent.timestamp).toLocaleString()}
                  </span>
                </div>

                {selectedEvent.actualReturnAt && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Actual Return:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {new Date(selectedEvent.actualReturnAt).toLocaleString()}
                    </span>
                  </div>
                )}

                {selectedEvent.custodyDurationMinutes && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Total Custody Elapsed:</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                      {formatDuration(selectedEvent.custodyDurationMinutes)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Turnstile Station:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedEvent.nfcReader?.name} ({selectedEvent.nfcReader?.location})
                  </span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">NFC Hardware Authentication:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Cryptographic Tag Tap Verified</span>
                  </span>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 font-bold transition-colors"
                >
                  Close Audit Slip
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
