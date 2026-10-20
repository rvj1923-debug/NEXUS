"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Radio,
  Cpu,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wifi,
  Keyboard,
  Shield,
  Plus,
  Edit2,
  Trash2,
  Tablet,
  Activity,
  ArrowRight,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface NfcReaderItem {
  id: string;
  readerIdentifier: string;
  name: string;
  location: string;
  readerType: string;
  connectionMode: string;
  vendorId: string | null;
  productId: string | null;
  deviceInstanceId: string | null;
  pairedKiosk: string | null;
  ipAddress: string | null;
  status: string;
  lastScannedAt: string | null;
  lastError: string | null;
  agentVersion: string | null;
  lastHeartbeatAt: string | null;
  isActive: boolean;
  transactionCount: number;
}

export default function ReaderManagementPage() {
  const [readers, setReaders] = useState<NfcReaderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<any>(null);

  // Test scan modal state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [selectedReader, setSelectedReader] = useState<NfcReaderItem | null>(null);
  const [testScanInput, setTestScanInput] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Pair modal state
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [pairKioskInput, setPairKioskInput] = useState("");
  const [pairLoading, setPairLoading] = useState(false);

  // Add reader modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newReader, setNewReader] = useState({
    readerIdentifier: "",
    name: "",
    location: "",
    readerType: "KIOSK",
    connectionMode: "MODE_A_KEYBOARD_WEDGE",
    vendorId: "FFFF",
    productId: "0035",
    deviceInstanceId: "USB\\VID_FFFF&PID_0035\\E4D155F50F01",
    pairedKiosk: "KIOSK-GATE-A",
  });

  const fetchReaders = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/readers");
      const data = await res.json();
      if (data.readers) {
        setReaders(data.readers);
      }
    } catch (e) {
      console.error("Failed to fetch readers:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReaders();
  }, []);

  const handleAutoDetect = async () => {
    try {
      setDetecting(true);
      const res = await fetch("/api/readers/detect");
      const data = await res.json();
      setDetectionResult(data);
    } catch (e) {
      console.error("Hardware detection error:", e);
    } finally {
      setDetecting(false);
    }
  };

  const handleTestScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testScanInput.trim()) return;

    try {
      setTestLoading(true);
      const res = await fetch("/api/readers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput: testScanInput.trim(),
          readerIdentifier: selectedReader?.readerIdentifier,
          readerId: selectedReader?.id,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      fetchReaders(); // refresh last scan time
    } catch (e) {
      console.error("Test scan error:", e);
    } finally {
      setTestLoading(false);
    }
  };

  const handlePairKiosk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReader || !pairKioskInput.trim()) return;

    try {
      setPairLoading(true);
      const res = await fetch("/api/readers/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          readerId: selectedReader.id,
          kioskIdentifier: pairKioskInput.trim(),
        }),
      });
      if (res.ok) {
        setPairModalOpen(false);
        fetchReaders();
      }
    } catch (e) {
      console.error("Pairing error:", e);
    } finally {
      setPairLoading(false);
    }
  };

  const handleAddReader = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/readers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newReader),
      });
      if (res.ok) {
        setAddModalOpen(false);
        setNewReader({
          readerIdentifier: "",
          name: "",
          location: "",
          readerType: "KIOSK",
          connectionMode: "MODE_A_KEYBOARD_WEDGE",
          vendorId: "FFFF",
          productId: "0035",
          deviceInstanceId: "USB\\VID_FFFF&PID_0035\\E4D155F50F01",
          pairedKiosk: "",
        });
        fetchReaders();
      }
    } catch (e) {
      console.error("Error creating reader:", e);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ONLINE":
        return (
          <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>ONLINE</span>
          </span>
        );
      case "ERROR":
        return (
          <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300">
            <AlertTriangle className="w-3 h-3 text-red-500" />
            <span>ERROR</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            <span>OFFLINE</span>
          </span>
        );
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case "MODE_A_KEYBOARD_WEDGE":
        return "Mode A (Keyboard Wedge)";
      case "MODE_B_PCSC":
        return "Mode B (Windows PC/SC)";
      case "MODE_C_RAW_HID":
        return "Mode C (Raw HID)";
      default:
        return mode || "Mode A (Keyboard Wedge)";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              NFC Readers & Hardware Integration
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Universal USB Engine
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Universal USB NFC reader diagnostics, keystroke wedge timing, PC/SC fallback, and kiosk pairing
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleAutoDetect}
            disabled={detecting}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-all flex items-center space-x-1.5"
          >
            <Cpu className={`w-4 h-4 ${detecting ? "animate-spin text-indigo-500" : "text-slate-500"}`} />
            <span>{detecting ? "Detecting..." : "Auto-Detect Hardware"}</span>
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Register Reader</span>
          </button>
        </div>
      </div>

      {/* Auto-Detection Hardware Diagnostic Banner */}
      {detectionResult && (
        <Card className="border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-white dark:from-indigo-950/30 dark:to-slate-900 shadow-sm">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Hardware Diagnostic Discovery Report
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                {detectionResult.agentOnline ? (
                  <span className="flex items-center space-x-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full font-semibold">
                    <Wifi className="w-3 h-3 text-emerald-500" />
                    <span>Agent 127.0.0.1:8002 Online</span>
                  </span>
                ) : detectionResult.remoteAgent ? (
                  <span className="text-[11px] font-mono text-sky-700 dark:text-sky-400 bg-sky-100 dark:bg-sky-950/60 px-2 py-0.5 rounded-full font-semibold">
                    Agents run on kiosk PCs
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-full font-semibold">
                    Direct Browser Mode
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {detectionResult.detectedHardware?.map((hw: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                    <span>{hw.description}</span>
                    <span className="text-indigo-600 font-mono text-[11px]">
                      VID: {hw.vendorId} | PID: {hw.productId}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono break-all">
                    Instance: {hw.deviceId}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold">
                      Recommended: {hw.recommendedMode}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-500 italic">
              {detectionResult.systemSummary?.recommendation}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Reader Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {readers.map((reader) => (
          <Card
            key={reader.id}
            className="hover:shadow-md transition-all border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {reader.name}
                    </CardTitle>
                    <span className="font-mono text-[11px] text-slate-500">
                      {reader.readerIdentifier}
                    </span>
                  </div>
                </div>
                {getStatusBadge(reader.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400 font-sans">Mode:</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {getModeLabel(reader.connectionMode)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400 font-sans">Paired Kiosk:</span>
                  <span className="font-semibold">
                    {reader.pairedKiosk || <span className="text-slate-400 italic">None</span>}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400 font-sans">Location:</span>
                  <span className="font-sans truncate max-w-[160px] text-right">
                    {reader.location}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span className="text-slate-400 font-sans">Last Scan:</span>
                  <span>
                    {reader.lastScannedAt ? (
                      new Date(reader.lastScannedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    ) : (
                      <span className="text-slate-400">No scans yet</span>
                    )}
                  </span>
                </div>
                {reader.lastError && (
                  <div className="p-1.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[10px] flex items-center space-x-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span className="truncate">{reader.lastError}</span>
                  </div>
                )}
              </div>

              {/* Hardware Specs */}
              <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 font-mono">
                <div>VID: {reader.vendorId || "FFFF"}</div>
                <div>PID: {reader.productId || "0035"}</div>
                <div>Agent: {reader.agentVersion || "1.0.0"}</div>
                <div>Ops: {reader.transactionCount} scans</div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => {
                    setSelectedReader(reader);
                    setPairKioskInput(reader.pairedKiosk || reader.readerIdentifier);
                    setPairModalOpen(true);
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center space-x-1"
                >
                  <Tablet className="w-3 h-3 text-slate-500" />
                  <span>Pair Kiosk</span>
                </button>

                <button
                  onClick={() => {
                    setSelectedReader(reader);
                    setTestScanInput("");
                    setTestResult(null);
                    setTestModalOpen(true);
                  }}
                  className="px-3 py-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg flex items-center space-x-1"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Test Scan</span>
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Test Scan Modal */}
      {testModalOpen && selectedReader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Live Scan Diagnostic Test
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {selectedReader.name} ({selectedReader.readerIdentifier})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTestModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleTestScan} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Card Scan Input (Keystroke wedge or manual UID)
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. 04:A2:8B:71:68 or tap USB reader"
                  value={testScanInput}
                  onChange={(e) => setTestScanInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setTestModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={testLoading || !testScanInput.trim()}
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow flex items-center space-x-1"
                >
                  <span>Verify Reader Response</span>
                </button>
              </div>
            </form>

            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs space-y-1 font-mono ${
                  testResult.success
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                    : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
                }`}
              >
                <div className="font-sans font-bold flex items-center space-x-1">
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  )}
                  <span>
                    {testResult.success
                      ? testResult.debounced
                        ? "Scan Suppressed (Debounced Duplicate)"
                        : "Reader Scan Recognized"
                      : "Scan Recognition Error"}
                  </span>
                </div>
                {testResult.normalizedUid && (
                  <div className="text-[11px]">Normalized UID: {testResult.normalizedUid}</div>
                )}
                {testResult.technologyStandard && (
                  <div className="text-[11px]">Technology: {testResult.technologyStandard}</div>
                )}
                {testResult.details && (
                  <div className="text-[10px] text-slate-500">{testResult.details}</div>
                )}
                {testResult.cardDetails && (
                  <div className="mt-1 pt-1 border-t border-emerald-200 dark:border-emerald-800 text-[10px] text-slate-600 dark:text-slate-300">
                    Holder: {testResult.cardDetails.employee?.name} (
                    {testResult.cardDetails.employee?.code})
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pair Kiosk Modal */}
      {pairModalOpen && selectedReader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Pair Reader with Kiosk
            </h3>
            <p className="text-xs text-slate-500">
              Bind hardware {selectedReader.name} to a physical attendance or asset custody kiosk station.
            </p>
            <form onSubmit={handlePairKiosk} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kiosk Identifier
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KIOSK-GATE-A"
                  value={pairKioskInput}
                  onChange={(e) => setPairKioskInput(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase"
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPairModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pairLoading}
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow"
                >
                  Save Pairing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Reader Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Register Universal NFC Reader
              </h3>
              <button
                onClick={() => setAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddReader} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reader Identifier (Unique Code) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. KIOSK-GATE-B"
                  value={newReader.readerIdentifier}
                  onChange={(e) =>
                    setNewReader({ ...newReader, readerIdentifier: e.target.value.toUpperCase() })
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reader Friendly Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Loading Dock Gate Reader"
                  value={newReader.name}
                  onChange={(e) => setNewReader({ ...newReader, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Physical Location *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Building 2 - Loading Bay North"
                  value={newReader.location}
                  onChange={(e) => setNewReader({ ...newReader, location: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Connection Mode
                  </label>
                  <select
                    value={newReader.connectionMode}
                    onChange={(e) =>
                      setNewReader({ ...newReader, connectionMode: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                  >
                    <option value="MODE_A_KEYBOARD_WEDGE">Mode A (Keyboard Wedge)</option>
                    <option value="MODE_B_PCSC">Mode B (PC/SC CCID)</option>
                    <option value="MODE_C_RAW_HID">Mode C (Raw HID)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reader Type
                  </label>
                  <select
                    value={newReader.readerType}
                    onChange={(e) => setNewReader({ ...newReader, readerType: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl"
                  >
                    <option value="KIOSK">KIOSK</option>
                    <option value="DESKTOP">DESKTOP</option>
                    <option value="MOBILE">MOBILE</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    USB VID
                  </label>
                  <input
                    type="text"
                    value={newReader.vendorId}
                    onChange={(e) => setNewReader({ ...newReader, vendorId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    USB PID
                  </label>
                  <input
                    type="text"
                    value={newReader.productId}
                    onChange={(e) => setNewReader({ ...newReader, productId: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono uppercase"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow"
                >
                  Register Reader
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
