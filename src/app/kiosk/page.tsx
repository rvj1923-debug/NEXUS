"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Smartphone,
  AlertTriangle,
  Clock,
  Calendar,
  WifiOff,
  ShieldAlert,
  Loader2,
  User,
  Sparkles,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Activity,
  Database,
  HardDrive,
  Server,
  Wrench,
  Lock,
  Maximize2,
  Minimize2,
  LogOut,
  Settings,
  X,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { PhonixEmblem } from "@/components/phonix-logo";
import { DeduplicateRawScan, normalizeNfcUid } from "@/lib/nfc/normalization";
import { COMPANY_TIMEZONE } from "@/lib/custody/timezone";

// Web Audio API Synthesizer (Singleton AudioContext for zero-latency chimes)
let sharedAudioCtx: AudioContext | null = null;

function playKioskChime(type: "tap" | "success" | "warning" | "complete") {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    if (type === "tap") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "success") {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain1.gain.setValueAtTime(0.15, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.15);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain2.gain.setValueAtTime(0.18, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.3);
    } else if (type === "complete") {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);
        gain.gain.setValueAtTime(0.14, ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.07 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.07);
        osc.stop(ctx.currentTime + idx * 0.07 + 0.22);
      });
    } else if (type === "warning") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(240, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch {
    // Autoplay restrictions
  }
}

// Translations Dictionary (English & Filipino)
const I18N = {
  EN: {
    systemTitle: "NEXUS",
    kioskSubtitle: "NFC-Enabled Exchange & Usage System",
    readyPrompt: "TAP PHONE NFC TAG TO SCAN",
    readyInstruction: "Hold the NFC tag against the reader to automatically Time In or Time Out",
    readerConnected: "Reader Ready",
    readerDisconnected: "NFC Reader Disconnected — Please Notify Custodian",
    readingCard: "Reading NFC Tag...",
    scanSuccess: "Tag Recognized",
    scanFailed: "Tag Not Recognized",
    timeInBtn: "TIME IN",
    timeInSub: "Pick up / Issue Phone",
    timeOutBtn: "TIME OUT",
    timeOutSub: "Surrender / Return Phone",
    overdueTimeOutSub: "Overdue Surrender (Immediate)",
    caseCOverdue: "YOUR COMPANY PHONE IS OVERDUE FOR SURRENDER",
    caseDNoPhone: "No active employee assigned to this company phone. Please contact IT or custodian.",
    caseENotRecognized: "Card not recognized. Please contact the assigned custodian.",
    awaitingDeskVerification: "Awaiting Custodian Verification",
    presentPhoneNotice: "Please present the phone to the authorized custodian for physical custody verification.",
    cancelBtn: "Cancel",
    doneBtn: "Done",
    phoneTimedInSuccess: "PHONE SUCCESSFULLY TIMED IN",
    phoneTimedOutSuccess: "PHONE SUCCESSFULLY TIMED OUT",
    refNumber: "Transaction Code",
    expectedReturn: "Expected Return Due",
    timestamp: "Timestamp",
    employeeLabel: "Employee",
    phoneLabel: "Phone Asset",
    conditionLabel: "Device Condition",
    attendedApprovalBtn: "Attendant Approval (Enter PIN / Password)",
    custodianLoginTitle: "Authorized Custodian Verification",
    custodianLoginPrompt: "Enter custodian credentials to physically inspect and confirm phone transfer",
    conditionGood: "Good / Pristine",
    conditionFair: "Fair / Minor Wear",
    conditionDamaged: "Damaged / Defective",
    confirmTransferBtn: "Confirm Custody Action",
    offlineNotice: "System temporarily unavailable.",
    pleaseTapAgain: "Please tap again",
    pleaseWaitAndTapAgain: "Please wait and tap again",
    offlineOverlayTitle: "Temporarily unavailable – please wait",
    offlineOverlaySubtitle: "Reconnecting to database and backend services automatically…",
    maintenanceLockTitle: "Kiosk under maintenance",
    maintenanceLockSubtitle: "This kiosk terminal is temporarily locked for maintenance by the administrator. Re-checking status automatically…",
    clockSkewWarning: "Clock drift >2m • Server time active",
    secondsRemaining: "Auto-resetting in",
    autoProcessingTimeIn: "AUTOMATIC TIME IN",
    autoProcessingTimeInSub: "Issuing company phone...",
    autoProcessingTimeOut: "AUTOMATIC TIME OUT",
    autoProcessingTimeOutSub: "Surrendering company phone...",
    doubleTapAlert: "ACCIDENTAL DOUBLE-TAP PREVENTED",
    doubleTapBlocked: "DOUBLE-TAP COOLDOWN ACTIVE",
    doubleTapDesc: "To prevent accidental double-taps on the reader, a 15-second interval is required between Time In and Time Out.",
    doubleTapElapsed: "Last action",
    doubleTapRemaining: "Cooldown remaining",
    doubleTapSafe: "Device state remains safe and unchanged.",
    dismissBtn: "Dismiss / Tap Again After Cooldown",
    recentActivity: "Recent Activity",
    recentLogsTitle: "Live Turnstile Activity",
    recentLogsSubtitle: "Recent Time In & Time Out logs",
    noRecentLogs: "No recent activity recorded yet today.",
    timeInAction: "TIME IN",
    timeOutAction: "TIME OUT",
    liveFeed: "LIVE",
    refreshLogs: "Refresh logs",
  },
  FIL: {
    systemTitle: "NEXUS",
    kioskSubtitle: "NFC-Enabled Exchange & Usage System",
    readyPrompt: "I-TAP ANG NFC TAG NG TELEPONO",
    readyInstruction: "Idikit ang NFC tag sa reader para awtomatikong mag-Time In o mag-Time Out",
    readerConnected: "Handa ang Reader",
    readerDisconnected: "Nawalan ng Koneksyon ang Reader — Tawagin ang Custodian",
    readingCard: "Binabasa ang NFC Tag...",
    scanSuccess: "Matagumpay na Nabasa",
    scanFailed: "Hindi Nakilala ang Tag",
    timeInBtn: "TIME IN",
    timeInSub: "Kunin ang Telepono",
    timeOutBtn: "TIME OUT",
    timeOutSub: "Isauli ang Telepono",
    overdueTimeOutSub: "Pagsasauli ng Lampas sa Oras",
    caseCOverdue: "ANG TELEPONO AY LAMPAS NA SA ORAS NG PAGSASAULI",
    caseDNoPhone: "Walang empleyadong nakatalaga sa teleponong ito. Makipag-ugnayan sa IT o Custodian.",
    caseENotRecognized: "Hindi nakilala ang card. Mangyaring makipag-ugnayan sa nakatalagang custodian.",
    awaitingDeskVerification: "Naghihintay ng Pagpapatunay ng Custodian",
    presentPhoneNotice: "Ipakita ang telepono sa custodian sa desk para sa pisikal na pagsusuri.",
    cancelBtn: "Kanselahin",
    doneBtn: "Tapos Na",
    phoneTimedInSuccess: "MATAGUMPAY NA NA-TIME IN ANG TELEPONO",
    phoneTimedOutSuccess: "MATAGUMPAY NA NA-TIME OUT ANG TELEPONO",
    refNumber: "Kodigo ng Transaksyon",
    expectedReturn: "Dapat Isauli Sa",
    timestamp: "Oras ng Transaksyon",
    employeeLabel: "Empleyado",
    phoneLabel: "Telepono ng Kumpanya",
    conditionLabel: "Kondisyon ng Telepono",
    attendedApprovalBtn: "Pagpapatunay ng Custodian (Ipasok ang PIN)",
    custodianLoginTitle: "Pagpapatunay ng Awtorisadong Custodian",
    custodianLoginPrompt: "Ipasok ang kredensyal ng custodian para sa pisikal na pagsusuri",
    conditionGood: "Maayos / Walang Sira",
    conditionFair: "May Kaunting Gasgas",
    conditionDamaged: "May Sira / Basag",
    confirmTransferBtn: "Kumpirmahin ang Transaksyon",
    offlineNotice: "Pansamantalang hindi magamit ang sistema.",
    pleaseTapAgain: "Mangyaring i-tap muli",
    pleaseWaitAndTapAgain: "Mangyaring maghintay at i-tap muli",
    offlineOverlayTitle: "Pansamantalang hindi magamit – mangyaring maghintay",
    offlineOverlaySubtitle: "Kusang kumokonekta muli sa database at sistema…",
    maintenanceLockTitle: "Kiosk ay nasa ilalim ng maintenance",
    maintenanceLockSubtitle: "Pansamantalang naka-lock ang terminal na ito para sa maintenance. Kusang sinusuri muli ang estado…",
    clockSkewWarning: "Magkaiba ang oras >2m • Gamit ang oras ng server",
    secondsRemaining: "Kukusang magre-reset sa loob ng",
    autoProcessingTimeIn: "AWTOMATIKONG TIME IN",
    autoProcessingTimeInSub: "Inilalabas ang telepono ng kumpanya...",
    autoProcessingTimeOut: "AWTOMATIKONG TIME OUT",
    autoProcessingTimeOutSub: "Isinasauli ang telepono sa depot...",
    doubleTapAlert: "NA-DETECT ANG DOBLE-TAP",
    doubleTapBlocked: "COOLDOWN NAKA-ENABLE — BAWAL ANG DOBLE TAP",
    doubleTapDesc: "Upang maiwasan ang aksidenteng pag-tap, may 15 segundong cooldown bago makapag-Time In o Time Out muli.",
    doubleTapElapsed: "Huling aksyon",
    doubleTapRemaining: "Natitirang cooldown",
    doubleTapSafe: "Ligtas at hindi nagbago ang estado ng telepono.",
    dismissBtn: "Isara / I-tap Uli Pagkatapos ng Cooldown",
    recentActivity: "Kamakailang Aktibidad",
    recentLogsTitle: "Live Turnstile Aktibidad",
    recentLogsSubtitle: "Mga huling Time In at Time Out",
    noRecentLogs: "Wala pang naitalang transaksyon ngayong araw.",
    timeInAction: "TIME IN",
    timeOutAction: "TIME OUT",
    liveFeed: "LIVE",
    refreshLogs: "I-refresh ang logs",
  },
};

interface RecentLogItem {
  id: string;
  transactionCode: string;
  action: "TIME_IN" | "TIME_OUT";
  status: string;
  timestamp: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  phoneAssetTag: string;
  phoneModel: string;
  custodyDurationMinutes: number | null;
  formattedDuration: string | null;
}

interface DiagnosticsInfo {
  readerStatus: string;
  agentStatus: string;
  dbStatus: string;
  healthStatus: string;
  lastBackupAt: string | null;
  appVersion: string;
  kioskCode: string;
  serverTime: string;
  queueLength: number;
}

function formatRelativeTime(dateString: string, isFil: boolean): string {
  try {
    const then = new Date(dateString).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 15) return isFil ? "Kani-kanina lang" : "Just now";
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(dateString).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatTimeOnly(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

type KioskStage =
  | "IDLE"
  | "READING"
  | "AUTO_PROCESSING"
  | "DOUBLE_TAP_PREVENTED"
  | "CONFIRMATION"
  | "ERROR"
  | "MAINTENANCE";

const MAX_PENDING_TAPS = 5; // Total tap capacity: 1 active + up to 4 waiting in queue

export default function KioskPage() {
  const [lang, setLang] = useState<"EN" | "FIL">("EN");
  const { setTheme } = useTheme();
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const soundEnabledRef = useRef<boolean>(true);
  const [kioskCode, setKioskCode] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>("1.0.0");

  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");

  const [stage, setStageState] = useState<KioskStage>("IDLE");
  const stageRef = useRef<KioskStage>("IDLE");
  const setStage = useCallback((next: KioskStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);

  const [readerStatus, setReaderStatus] = useState<"CONNECTED" | "READING" | "DISCONNECTED">("DISCONNECTED");
  const readerStatusRef = useRef<"CONNECTED" | "READING" | "DISCONNECTED">("DISCONNECTED");
  const [agentOnline, setAgentOnline] = useState<boolean>(false);
  const agentOnlineRef = useRef<boolean>(false);
  const [readerBanner, setReaderBanner] = useState<string | null>(null);

  // Resolution Payload
  const [resolvedData, setResolvedData] = useState<any>(null);
  const [genericErrorMessage, setGenericErrorMessage] = useState<string>("");

  // Automated Action & Accidental Double-Tap Prevention State
  const [autoAction, setAutoAction] = useState<"TIME_IN" | "TIME_OUT" | null>(null);
  const [doubleTapInfo, setDoubleTapInfo] = useState<{
    elapsedSeconds: number;
    remainingSeconds: number;
    actionAttempted?: "TIME_IN" | "TIME_OUT";
    currentStatus?: "TIMED_IN" | "TIMED_OUT";
    phoneAsset: string;
    ownerName?: string;
    message?: string;
  } | null>(null);

  // Final Confirmation Data
  const [confirmationData, setConfirmationData] = useState<any>(null);

  // Maintenance / Diagnostics Screen State (30s)
  const [diagnosticsInfo, setDiagnosticsInfo] = useState<DiagnosticsInfo | null>(null);
  const [maintenanceRemainingSec, setMaintenanceRemainingSec] = useState<number>(30);
  const activeMaintenanceCardKeyRef = useRef<string | null>(null);

  // Dropped Tap Warning Banner (when queue max 5 is full or overlay is active)
  const [droppedTapWarning, setDroppedTapWarning] = useState<string | null>(null);
  const [droppedTapCount, setDroppedTapCount] = useState<number>(0);
  const droppedTapTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Offline Overlay, Maintenance Lock, Clock Drift & Self-Heal State
  const [isOfflineOverlay, setIsOfflineOverlay] = useState<boolean>(false);
  const isOfflineOverlayRef = useRef<boolean>(false);
  const unhealthySinceRef = useRef<number | null>(null);

  const [isMaintenanceLocked, setIsMaintenanceLocked] = useState<boolean>(false);
  const isMaintenanceLockedRef = useRef<boolean>(false);

  const [isClockSkewed, setIsClockSkewed] = useState<boolean>(false);
  const [clockDriftMinutes, setClockDriftMinutes] = useState<number>(0);

  const errorOrOfflineSinceRef = useRef<number | null>(null);
  const selfHealThresholdMsRef = useRef<number>(10 * 60 * 1000);

  // Recent Turnstile Logs Sidebar State (always visible on wide screens, auto-hidden on narrow screens)
  const [recentLogs, setRecentLogs] = useState<RecentLogItem[]>([]);

  // Secret Kiosk Settings (5-second hold on Logo)
  const [isHoldingLogo, setIsHoldingLogo] = useState<boolean>(false);
  const [isSecretSettingsOpen, setIsSecretSettingsOpen] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);
  const logoHoldTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    setIsFullscreen(Boolean(document.fullscreenElement));
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const handleLogoHoldStart = useCallback(() => {
    if (logoHoldTimerRef.current) {
      clearTimeout(logoHoldTimerRef.current);
    }
    setIsHoldingLogo(true);
    logoHoldTimerRef.current = setTimeout(() => {
      setIsHoldingLogo(false);
      logoHoldTimerRef.current = null;
      if (soundEnabledRef.current) {
        playKioskChime("tap");
      }
      setIsSecretSettingsOpen(true);
    }, 5000);
  }, []);

  const handleLogoHoldEnd = useCallback(() => {
    if (logoHoldTimerRef.current) {
      clearTimeout(logoHoldTimerRef.current);
      logoHoldTimerRef.current = null;
    }
    setIsHoldingLogo(false);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Ignore fullscreen API restrictions
    }
  }, []);

  const handleKioskLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Redirect even if network call fails
    } finally {
      window.location.href = "/login";
    }
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    readerStatusRef.current = readerStatus;
  }, [readerStatus]);

  useEffect(() => {
    agentOnlineRef.current = agentOnline;
  }, [agentOnline]);

  useEffect(() => {
    isOfflineOverlayRef.current = isOfflineOverlay;
  }, [isOfflineOverlay]);

  useEffect(() => {
    isMaintenanceLockedRef.current = isMaintenanceLocked;
  }, [isMaintenanceLocked]);

  // Evaluate server vs client clock drift (warn if > 2 minutes)
  const evaluateClockDrift = useCallback((serverTimeIso?: string | null) => {
    if (!serverTimeIso) return;
    const serverMs = Date.parse(serverTimeIso);
    if (!Number.isFinite(serverMs)) return;
    const diffMs = Math.abs(Date.now() - serverMs);
    if (diffMs > 2 * 60 * 1000) {
      setIsClockSkewed(true);
      setClockDriftMinutes(Math.max(2, Math.round(diffMs / 60000)));
    } else {
      setIsClockSkewed(false);
      setClockDriftMinutes(0);
    }
  }, []);

  const keepKioskSessionAlive = useCallback(async () => {
    try {
      const res = await fetch("/api/kiosk/keepalive", {
        method: "POST",
      });

      if (res.status === 401 || res.status === 403) {
        window.location.href = "/api/kiosk/device-login";
        return;
      }

      if (res.ok) {
        if (isMaintenanceLockedRef.current) {
          isMaintenanceLockedRef.current = false;
          setIsMaintenanceLocked(false);
        }
      }
    } catch {
      // Ignore transient network errors; next heartbeat or online event will retry
    }
  }, []);

  // Fetch KioskDevice defaults (displayLanguage, soundEnabled, theme, kioskCode, appVersion, status, serverTime)
  const fetchKioskConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/kiosk/config");
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/api/kiosk/device-login";
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.displayLanguage === "EN" || data.displayLanguage === "FIL") {
        setLang((prev) => (prev === data.displayLanguage ? prev : data.displayLanguage));
      }
      if (typeof data.soundEnabled === "boolean") {
        setSoundEnabled((prev) => (prev === data.soundEnabled ? prev : data.soundEnabled));
        soundEnabledRef.current = data.soundEnabled;
      }
      if (data.theme === "light" || data.theme === "dark") {
        setTheme(data.theme);
      }
      if (data.kioskCode) {
        setKioskCode((prev) => (prev === data.kioskCode ? prev : data.kioskCode));
      }
      if (data.appVersion) {
        setAppVersion((prev) => (prev === data.appVersion ? prev : data.appVersion));
      }
      if (data.serverTime) {
        evaluateClockDrift(data.serverTime);
      }
      if (data.status === "ACTIVE" && isMaintenanceLockedRef.current) {
        isMaintenanceLockedRef.current = false;
        setIsMaintenanceLocked(false);
        void keepKioskSessionAlive();
      }
    } catch {
      // Ignore transient network errors
    }
  }, [setTheme, evaluateClockDrift, keepKioskSessionAlive]);

  const fetchRecentLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/kiosk/recent-logs?limit=15");
      if (res.status === 401) {
        window.location.href = "/api/kiosk/device-login";
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.logs)) {
          setRecentLogs(data.logs);
        }
      }
    } catch {
      // Ignore transient network errors during background polling
    }
  }, []);

  const isReloadingRef = useRef<boolean>(false);
  const lastSelfHealAttemptAtRef = useRef<number>(0);

  // Safe reload helper: fetches /api/health with a 3s timeout and ONLY reloads if the server responded (any HTTP status)
  const safeReload = useCallback(
    async (options?: { isSelfHeal?: boolean; delayBeforeReloadMs?: number }): Promise<boolean> => {
      if (isReloadingRef.current) return false;
      isReloadingRef.current = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res && typeof res.status === "number") {
          const data = await res.json().catch(() => null);
          if (res.ok && data?.checks?.database?.status === "UP") {
            unhealthySinceRef.current = null;
            if (isOfflineOverlayRef.current) {
              isOfflineOverlayRef.current = false;
              setIsOfflineOverlay(false);
            }
          }

          if (options?.isSelfHeal) {
            const delayMs = options.delayBeforeReloadMs ?? 800;
            if (delayMs > 0) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
            try {
              sessionStorage.setItem("cpt_kiosk_last_self_heal_reload_at", String(Date.now()));
            } catch {
              // Ignore sessionStorage errors in restricted kiosk environments
            }
            errorOrOfflineSinceRef.current = null;
          }

          window.location.reload();
          return true;
        }
        isReloadingRef.current = false;
        return false;
      } catch {
        clearTimeout(timeoutId);
        isReloadingRef.current = false;
        return false;
      }
    },
    []
  );

  // Poll /api/health every 10s for offline overlay (>=30s unhealthy) and clock check
  useEffect(() => {
    let isMounted = true;

    if (typeof window !== "undefined") {
      const isLocalOrDev =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        process.env.NODE_ENV !== "production";
      if (isLocalOrDev) {
        const rawSelfHeal = new URLSearchParams(window.location.search).get("selfHealMs");
        if (rawSelfHeal) {
          const parsedMs = Number(rawSelfHeal);
          if (Number.isFinite(parsedMs) && parsedMs >= 1000) {
            selfHealThresholdMsRef.current = parsedMs;
          }
        }
      }
    }

    const pollHealth = async () => {
      let isHealthy = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => null);
        if (data?.timestamp) {
          evaluateClockDrift(data.timestamp);
        }
        if (res.ok && data?.checks?.database?.status === "UP") {
          isHealthy = true;
        }
      } catch {
        isHealthy = false;
      }

      if (!isMounted) return;

      if (isHealthy) {
        unhealthySinceRef.current = null;
        if (isOfflineOverlayRef.current) {
          isOfflineOverlayRef.current = false;
          setIsOfflineOverlay(false);
        }
        if (
          stageRef.current !== "ERROR" &&
          (errorOrOfflineSinceRef.current === null ||
            Date.now() - errorOrOfflineSinceRef.current < selfHealThresholdMsRef.current)
        ) {
          errorOrOfflineSinceRef.current = null;
        }
      } else {
        if (unhealthySinceRef.current === null) {
          unhealthySinceRef.current = Date.now();
        }
        if (Date.now() - unhealthySinceRef.current >= 30000) {
          if (!isOfflineOverlayRef.current) {
            isOfflineOverlayRef.current = true;
            setIsOfflineOverlay(true);
          }
        }
      }
    };

    void pollHealth();
    const healthInterval = setInterval(pollHealth, 10000);

    // 1s ticker to show the offline overlay promptly at 30s and evaluate continuous error/offline self-heal
    const checkTicker = setInterval(() => {
      const now = Date.now();
      if (
        unhealthySinceRef.current !== null &&
        now - unhealthySinceRef.current >= 30000 &&
        !isOfflineOverlayRef.current
      ) {
        isOfflineOverlayRef.current = true;
        setIsOfflineOverlay(true);
      }

      const thresholdExceeded =
        errorOrOfflineSinceRef.current !== null &&
        now - errorOrOfflineSinceRef.current >= selfHealThresholdMsRef.current;

      const isInErrorOrOffline =
        unhealthySinceRef.current !== null ||
        isOfflineOverlayRef.current ||
        stageRef.current === "ERROR" ||
        thresholdExceeded;

      if (isInErrorOrOffline) {
        if (errorOrOfflineSinceRef.current === null) {
          errorOrOfflineSinceRef.current = unhealthySinceRef.current ?? now;
        }
        if (now - errorOrOfflineSinceRef.current >= selfHealThresholdMsRef.current) {
          const minReloadIntervalMs = 10 * 60 * 1000;
          let canReload = true;
          try {
            const lastReloadRaw = sessionStorage.getItem("cpt_kiosk_last_self_heal_reload_at");
            if (lastReloadRaw) {
              const lastReloadMs = Number(lastReloadRaw);
              if (Number.isFinite(lastReloadMs) && now - lastReloadMs < minReloadIntervalMs) {
                canReload = false;
              }
            }
          } catch {
            // Ignore sessionStorage errors in restricted kiosk environments
          }
          if (!canReload) {
            if (
              unhealthySinceRef.current === null &&
              !isOfflineOverlayRef.current &&
              stageRef.current !== "ERROR"
            ) {
              errorOrOfflineSinceRef.current = null;
            }
          } else if (
            !isReloadingRef.current &&
            now - lastSelfHealAttemptAtRef.current >= 3000
          ) {
            lastSelfHealAttemptAtRef.current = now;
            void safeReload({ isSelfHeal: true, delayBeforeReloadMs: 800 });
          }
        }
      } else {
        errorOrOfflineSinceRef.current = null;
      }
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(healthInterval);
      clearInterval(checkTicker);
    };
  }, [evaluateClockDrift, safeReload]);

  // While maintenance lock is shown, re-check every 30s through keepalive (and poll config status for fast recovery)
  useEffect(() => {
    if (!isMaintenanceLocked) return;
    const keepAliveTimer = setInterval(() => {
      void keepKioskSessionAlive();
    }, 30000);
    const configTimer = setInterval(() => {
      void fetchKioskConfig();
    }, 3000);
    return () => {
      clearInterval(keepAliveTimer);
      clearInterval(configTimer);
    };
  }, [isMaintenanceLocked, keepKioskSessionAlive, fetchKioskConfig]);

  // Poll kiosk config periodically so changes made by admin on /admin/kiosks take effect automatically
  useEffect(() => {
    fetchKioskConfig();
    const configInterval = setInterval(fetchKioskConfig, 30000);
    return () => clearInterval(configInterval);
  }, [fetchKioskConfig]);

  // Poll recent logs periodically (also refreshed immediately on every tap)
  useEffect(() => {
    fetchRecentLogs();
    const interval = setInterval(fetchRecentLogs, 15000);
    return () => clearInterval(interval);
  }, [fetchRecentLogs]);

  // Continuous 24/7 kiosk session keepalive & automatic network recovery
  useEffect(() => {
    keepKioskSessionAlive();
    const keepAliveInterval = setInterval(keepKioskSessionAlive, 5 * 60 * 1000);

    const handleOnline = () => {
      keepKioskSessionAlive();
      fetchKioskConfig();
      fetchRecentLogs();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        keepKioskSessionAlive();
        fetchKioskConfig();
        fetchRecentLogs();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(keepAliveInterval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [keepKioskSessionAlive, fetchKioskConfig, fetchRecentLogs]);

  // Kiosk Hardening: block contextmenu, selection, drag, pinch-zoom, link navigation, and history.back()
  useEffect(() => {
    const preventDefault = (e: Event) => {
      e.preventDefault();
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const handleClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (anchor) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Push guard history entries so history.back() / swipe-back never leaves /kiosk
    const pushKioskGuardState = () => {
      try {
        const baseState =
          typeof window.history.state === "object" && window.history.state !== null
            ? window.history.state
            : { __NA: true };
        window.history.pushState(
          { ...baseState, __NA: true, kioskGuard: Date.now() },
          "",
          `/kiosk${window.location.search || ""}`
        );
      } catch {
        // Ignore history API error
      }
    };

    pushKioskGuardState();
    pushKioskGuardState();

    const handlePopState = (e: PopStateEvent) => {
      e.stopImmediatePropagation();
      pushKioskGuardState();
    };

    window.addEventListener("contextmenu", preventDefault, { capture: true });
    window.addEventListener("selectstart", preventDefault, { capture: true });
    window.addEventListener("dragstart", preventDefault, { capture: true });
    window.addEventListener("gesturestart", preventDefault, { passive: false });
    window.addEventListener("gesturechange", preventDefault, { passive: false });
    window.addEventListener("gestureend", preventDefault, { passive: false });
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("click", handleClickCapture, true);
    document.addEventListener("auxclick", handleClickCapture, true);
    window.addEventListener("popstate", handlePopState, true);

    return () => {
      window.removeEventListener("contextmenu", preventDefault, { capture: true } as any);
      window.removeEventListener("selectstart", preventDefault, { capture: true } as any);
      window.removeEventListener("dragstart", preventDefault, { capture: true } as any);
      window.removeEventListener("gesturestart", preventDefault);
      window.removeEventListener("gesturechange", preventDefault);
      window.removeEventListener("gestureend", preventDefault);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("click", handleClickCapture, true);
      document.removeEventListener("auxclick", handleClickCapture, true);
      window.removeEventListener("popstate", handlePopState, true);
    };
  }, []);

  // Hardware wedge buffering & FIFO tap queue (max 5 total pending taps)
  const keyBufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
  const isReaderSpeedBurstRef = useRef<boolean>(true);
  const burstOverflowedRef = useRef<boolean>(false);
  const burstFinishTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingTapRef = useRef<boolean>(false);
  const activeTapCardKeyRef = useRef<string | null>(null);
  const recentCardTapMapRef = useRef<Map<string, number>>(new Map());
  const tapQueueRef = useRef<Array<{ cleanUid: string; normalizedKey: string }>>([]);
  const screenShownAtRef = useRef<number>(0);
  const processNextInQueueRef = useRef<() => void>(() => {});
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoResetTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTokenRef = useRef<string | null>(null);
  const wedgeInputRef = useRef<HTMLInputElement>(null);

  const [isDiagnosticMode, setIsDiagnosticMode] = useState<boolean>(false);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [confirmationDurationMs, setConfirmationDurationMs] = useState<number>(3500);

  const t = I18N[lang];

  // Parse time digits and meridiem indicator
  const timeParts = currentTime ? currentTime.split(/\s+/) : ["--:--:--", ""];
  const timeDigits = timeParts[0] || "--:--:--";
  const timeMeridiem = timeParts.slice(1).join(" ") || "";

  // Check ?diagnostic=1 and ?selfHealMs=<ms> query parameters on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setIsDiagnosticMode(params.get("diagnostic") === "1");
      const isLocalOrDev =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        process.env.NODE_ENV !== "production";
      if (isLocalOrDev) {
        const rawSelfHeal = params.get("selfHealMs");
        if (rawSelfHeal) {
          const parsedMs = Number(rawSelfHeal);
          if (Number.isFinite(parsedMs) && parsedMs >= 1000) {
            selfHealThresholdMsRef.current = parsedMs;
          }
        }
      }
    }
  }, []);

  // Helper to clear wedge buffer and displayed input value
  const clearWedgeBuffer = useCallback((forceClearActiveBurst = false) => {
    if (wedgeInputRef.current) {
      wedgeInputRef.current.value = "";
    }
    if (forceClearActiveBurst || Date.now() - lastKeyTimeRef.current > 120) {
      if (burstFinishTimerRef.current) {
        clearTimeout(burstFinishTimerRef.current);
        burstFinishTimerRef.current = null;
      }
      keyBufferRef.current = [];
      isReaderSpeedBurstRef.current = true;
      burstOverflowedRef.current = false;
    }
  }, []);

  // Clear the buffer (and the input's displayed value) whenever the stage changes
  useEffect(() => {
    clearWedgeBuffer(false);
  }, [stage, clearWedgeBuffer]);

  // Live Company Time Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const nextTime = now.toLocaleTimeString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const nextDate = now.toLocaleDateString("en-US", {
        timeZone: COMPANY_TIMEZONE,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      setCurrentTime((prev) => (prev === nextTime ? prev : nextTime));
      setCurrentDate((prev) => (prev === nextDate ? prev : nextDate));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Live double-tap cooldown countdown ticker
  const doubleTapRemainingSeconds = doubleTapInfo?.remainingSeconds ?? 0;
  useEffect(() => {
    if (stage === "DOUBLE_TAP_PREVENTED" && doubleTapRemainingSeconds > 0) {
      const interval = setInterval(() => {
        setDoubleTapInfo((prev) => {
          if (!prev || prev.remainingSeconds <= 0) return prev;
          return {
            ...prev,
            remainingSeconds: Math.max(0, prev.remainingSeconds - 1),
            elapsedSeconds: prev.elapsedSeconds + 1,
          };
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [stage, doubleTapRemainingSeconds]);

  // Maintenance screen 30s countdown ticker
  useEffect(() => {
    if (stage === "MAINTENANCE" && maintenanceRemainingSec > 0) {
      const interval = setInterval(() => {
        setMaintenanceRemainingSec((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [stage, maintenanceRemainingSec]);

  // Reset to Idle helper
  const resetToIdle = useCallback(async () => {
    if (activeTokenRef.current) {
      try {
        await fetch("/api/kiosk/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: activeTokenRef.current }),
        });
      } catch {
        // Ignore network cancellation errors on reset
      }
      activeTokenRef.current = null;
    }

    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);

    screenShownAtRef.current = 0;
    isProcessingTapRef.current = false;
    activeTapCardKeyRef.current = null;
    activeMaintenanceCardKeyRef.current = null;
    setQueuedCount(0);
    setStage("IDLE");
    setResolvedData(null);
    setGenericErrorMessage("");
    setConfirmationData(null);
    setDiagnosticsInfo(null);
    setAutoAction(null);
    setDoubleTapInfo(null);
  }, [setStage]);

  // Populate live diagnostics for 30s Maintenance screen
  const loadDiagnosticsTelemetry = useCallback(
    async (resolvePayload: any) => {
      const baseInfo: DiagnosticsInfo = {
        readerStatus: readerStatusRef.current,
        agentStatus: agentOnlineRef.current ? "ONLINE" : "OFFLINE (Wedge Mode)",
        dbStatus: "UP",
        healthStatus: "HEALTHY",
        lastBackupAt: null,
        appVersion: resolvePayload?.appVersion || appVersion || "1.0.0",
        kioskCode: resolvePayload?.kioskCode || kioskCode || "—",
        serverTime: resolvePayload?.serverTime || new Date().toISOString(),
        queueLength: tapQueueRef.current.length,
      };
      setDiagnosticsInfo(baseInfo);

      try {
        const [healthRes, agentRes] = await Promise.all([
          fetch("/api/health").catch(() => null),
          fetch("http://127.0.0.1:8002/api/agent/status").catch(() => null),
        ]);

        let updated = { ...baseInfo, queueLength: tapQueueRef.current.length };

        if (healthRes && healthRes.ok) {
          const h = await healthRes.json().catch(() => null);
          if (h) {
            updated = {
              ...updated,
              healthStatus: h.status || "HEALTHY",
              dbStatus: h.checks?.database?.status || "UP",
              lastBackupAt: h.lastBackupAt || null,
              serverTime: h.timestamp || updated.serverTime,
            };
          }
        }

        if (agentRes && agentRes.ok) {
          const a = await agentRes.json().catch(() => null);
          const detected = Boolean(a?.hardware?.detected);
          updated = {
            ...updated,
            agentStatus: "ONLINE",
            readerStatus: detected ? "CONNECTED" : "DISCONNECTED",
          };
        }

        setDiagnosticsInfo(updated);
      } catch {
        // Keep baseInfo if telemetry fetch fails
      }
    },
    [appVersion, kioskCode]
  );

  // Execute a single tap item from either immediate entry or the FIFO queue
  const executeTap = useCallback(
    async ({ cleanUid, normalizedKey }: { cleanUid: string; normalizedKey: string }) => {
      const wasInMaintenance = stageRef.current === "MAINTENANCE";
      isProcessingTapRef.current = true;
      activeTapCardKeyRef.current = normalizedKey;
      screenShownAtRef.current = 0;

      if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

      setStage("READING");
      if (soundEnabledRef.current) playKioskChime("tap");

      const scheduleNextOrReset = (normalDurationMs: number) => {
        const hasQueued = tapQueueRef.current.length > 0;
        const durationMs = hasQueued ? 2000 : normalDurationMs;
        setConfirmationDurationMs(durationMs);
        screenShownAtRef.current = Date.now();
        if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
        autoResetTimerRef.current = setTimeout(() => {
          processNextInQueueRef.current();
        }, durationMs);
      };

      try {
        const res = await fetch("/api/kiosk/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardUid: cleanUid,
          }),
        });

        if (res.status === 401 || res.status === 403) {
          window.location.href = "/api/kiosk/device-login";
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          if (soundEnabledRef.current) playKioskChime("warning");

          if (
            res.status === 503 &&
            (errData?.error === "KIOSK_MAINTENANCE" || errData?.caseType === "CASE_MAINTENANCE")
          ) {
            isMaintenanceLockedRef.current = true;
            setIsMaintenanceLocked(true);
            void resetToIdle();
            return;
          }

          setStage("ERROR");
          const errMsg =
            res.status >= 500
              ? t.pleaseTapAgain
              : errData?.message || errData?.error || t.offlineNotice;
          setGenericErrorMessage(errMsg);
          scheduleNextOrReset(5000);
          return;
        }

        const data = await res.json();

        // Maintenance Card Tap: Show 30s diagnostics screen (or reload if already in maintenance)
        if (data.maintenance) {
          if (wasInMaintenance) {
            void safeReload();
            return;
          }

          if (soundEnabledRef.current) playKioskChime("complete");
          activeMaintenanceCardKeyRef.current = normalizedKey;
          // Allow an immediate second tap of the maintenance card within 30s to trigger reload
          recentCardTapMapRef.current.delete(normalizedKey);
          isProcessingTapRef.current = false;
          activeTapCardKeyRef.current = null;
          setMaintenanceRemainingSec(30);
          setConfirmationDurationMs(30000);
          setStage("MAINTENANCE");
          void loadDiagnosticsTelemetry(data);

          if (autoResetTimerRef.current) clearTimeout(autoResetTimerRef.current);
          autoResetTimerRef.current = setTimeout(() => {
            activeMaintenanceCardKeyRef.current = null;
            processNextInQueueRef.current();
          }, 30000);
          return;
        }

        // Debounced duplicate tap from server
        if (data.debounced) {
          processNextInQueueRef.current();
          return;
        }

        // If error or accidental double-tap cooldown blocked
        if (!data.success) {
          if (data.cooldownBlocked) {
            if (soundEnabledRef.current) playKioskChime("warning");
            setDoubleTapInfo({
              elapsedSeconds: data.elapsedSeconds ?? 0,
              remainingSeconds: data.remainingSeconds ?? 15,
              actionAttempted: data.actionAttempted,
              currentStatus: data.currentStatus,
              phoneAsset: data.phoneName || `Card [${data.cardUid}]`,
              ownerName: data.ownerName || data.employee?.fullName,
              message: data.message,
            });
            setStage("DOUBLE_TAP_PREVENTED");
            scheduleNextOrReset(4000);
            return;
          }

          if (soundEnabledRef.current) playKioskChime("warning");
          setStage("ERROR");
          setGenericErrorMessage(data.message || t.caseENotRecognized);
          scheduleNextOrReset(4000);
          return;
        }

        setResolvedData(data);

        // ACTION 1: AUTOMATIC TIME IN
        if (data.action === "TIME_IN") {
          if (soundEnabledRef.current) playKioskChime("success");
          setConfirmationData({
            type: "TIME_IN",
            phoneName: data.phoneName,
            cardUid: data.cardUid,
            refCode: data.transactionCode,
            timestamp: data.timeDisplay || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            ownerName: data.ownerName || data.employee?.fullName || "Company Fleet Asset",
            employeeCode: data.employee?.employeeCode,
            department: data.employee?.department,
            designation: data.employee?.designation,
            avatarUrl: data.employee?.profilePhotoUrl,
          });
          setStage("CONFIRMATION");
          fetchRecentLogs();
          scheduleNextOrReset(3500);
          return;
        }

        // ACTION 2: AUTOMATIC TIME OUT
        if (data.action === "TIME_OUT") {
          if (soundEnabledRef.current) playKioskChime("complete");
          setConfirmationData({
            type: "TIME_OUT",
            phoneName: data.phoneName,
            cardUid: data.cardUid,
            refCode: data.transactionCode,
            timedIn: data.timedInDisplay,
            timedOut: data.timedOutDisplay || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            duration: data.durationFormatted,
            ownerName: data.ownerName || data.employee?.fullName || "Company Fleet Asset",
            employeeCode: data.employee?.employeeCode,
            department: data.employee?.department,
            designation: data.employee?.designation,
            avatarUrl: data.employee?.profilePhotoUrl,
          });
          setStage("CONFIRMATION");
          fetchRecentLogs();
          scheduleNextOrReset(3500);
          return;
        }
      } catch {
        if (soundEnabledRef.current) playKioskChime("warning");
        setStage("ERROR");
        setGenericErrorMessage(t.offlineNotice);
        scheduleNextOrReset(5000);
      }
    },
    [t, fetchRecentLogs, loadDiagnosticsTelemetry, resetToIdle, safeReload, setStage]
  );

  // Keep queue runner callback updated
  useEffect(() => {
    processNextInQueueRef.current = () => {
      if (autoResetTimerRef.current) {
        clearTimeout(autoResetTimerRef.current);
        autoResetTimerRef.current = null;
      }
      screenShownAtRef.current = 0;

      if (tapQueueRef.current.length > 0) {
        const nextTap = tapQueueRef.current.shift()!;
        setQueuedCount(tapQueueRef.current.length);
        void executeTap(nextTap);
      } else {
        void resetToIdle();
      }
    };
  }, [executeTap, resetToIdle]);

  // Show brief "Please wait and tap again" warning banner and chime when queue is full or overlay is active
  const triggerDroppedTapWarning = useCallback(() => {
    if (soundEnabledRef.current) {
      playKioskChime("warning");
    }
    setDroppedTapWarning(t.pleaseWaitAndTapAgain);
    setDroppedTapCount((c) => c + 1);
    if (droppedTapTimerRef.current) {
      clearTimeout(droppedTapTimerRef.current);
    }
    droppedTapTimerRef.current = setTimeout(() => {
      setDroppedTapWarning(null);
      setDroppedTapCount(0);
    }, 4000);
  }, [t.pleaseWaitAndTapAgain]);

  // Card Tap Handler: Per-card 4500ms sliding duplicate guard + FIFO Queue for different cards (max 5 total pending taps)
  const handleCardTap = useCallback(
    (rawUid: string) => {
      if (!rawUid || rawUid.trim().length === 0) return;

      // While offline overlay or maintenance lock is shown, play warning chime and show "Please wait and tap again"
      if (isOfflineOverlayRef.current || isMaintenanceLockedRef.current) {
        triggerDroppedTapWarning();
        return;
      }

      let cleanUid = DeduplicateRawScan(rawUid);
      // Deduplicate if scanner spammed 2x-6x into the input buffer before flushing
      for (let reps = 2; reps <= 6; reps++) {
        if (cleanUid.length >= reps * 8 && cleanUid.length % reps === 0) {
          const chunkLen = cleanUid.length / reps;
          const chunk = cleanUid.slice(0, chunkLen);
          if (chunk.repeat(reps) === cleanUid) {
            cleanUid = chunk;
            break;
          }
        }
      }
      if (/^\d{13,}$/.test(cleanUid)) {
        cleanUid = cleanUid.slice(0, 10);
      }
      if (!cleanUid) return;

      let normalizedKey = cleanUid.toUpperCase();
      try {
        normalizedKey = normalizeNfcUid(cleanUid).normalizedUid;
      } catch {
        normalizedKey = cleanUid.toUpperCase();
      }

      // If currently on the 30s Maintenance Diagnostics screen and the maintenance card is tapped again, reload immediately
      if (
        stageRef.current === "MAINTENANCE" &&
        activeMaintenanceCardKeyRef.current &&
        normalizedKey === activeMaintenanceCardKeyRef.current
      ) {
        void safeReload();
        return;
      }

      const nowMs = Date.now();
      for (const [k, ts] of recentCardTapMapRef.current.entries()) {
        if (nowMs - ts > 15000) {
          recentCardTapMapRef.current.delete(k);
        }
      }

      // Never re-trigger or queue the SAME card while its tap is currently in flight or displaying its confirmation screen
      if (isProcessingTapRef.current && activeTapCardKeyRef.current === normalizedKey) {
        recentCardTapMapRef.current.set(normalizedKey, nowMs);
        return;
      }

      // Per-card sliding duplicate guard: ignore repeated emissions of the SAME card within 4500ms
      const lastSeenMs = recentCardTapMapRef.current.get(normalizedKey);
      if (lastSeenMs !== undefined && nowMs - lastSeenMs < 4500) {
        recentCardTapMapRef.current.set(normalizedKey, nowMs);
        return;
      }
      if (tapQueueRef.current.some((item) => item.normalizedKey === normalizedKey)) {
        recentCardTapMapRef.current.set(normalizedKey, nowMs);
        return;
      }

      // If another card's tap is currently in flight or displaying its confirmation screen, queue FIFO (up to 5 total pending taps)
      if (isProcessingTapRef.current) {
        if (tapQueueRef.current.length < MAX_PENDING_TAPS - 1) {
          recentCardTapMapRef.current.set(normalizedKey, nowMs);
          tapQueueRef.current.push({ cleanUid, normalizedKey });
          setQueuedCount(tapQueueRef.current.length);

          // If the current tap is already showing its confirmation/result screen with >2s duration,
          // shorten it to ~2s total so the queued tap starts right after 2s.
          if (screenShownAtRef.current > 0 && autoResetTimerRef.current) {
            const elapsed = Date.now() - screenShownAtRef.current;
            const remainingFor2s = Math.max(80, 2000 - elapsed);
            setConfirmationDurationMs(2000);
            clearTimeout(autoResetTimerRef.current);
            autoResetTimerRef.current = setTimeout(() => {
              processNextInQueueRef.current();
            }, remainingFor2s);
          }
        } else {
          // Queue is full: do NOT ignore silently — play warning chime and show "Please wait and tap again" banner
          triggerDroppedTapWarning();
        }
        return;
      }

      recentCardTapMapRef.current.set(normalizedKey, nowMs);
      isProcessingTapRef.current = true;
      activeTapCardKeyRef.current = normalizedKey;
      void executeTap({ cleanUid, normalizedKey });
    },
    [executeTap, triggerDroppedTapWarning, safeReload]
  );

  const handleCardTapRef = useRef(handleCardTap);
  useEffect(() => {
    handleCardTapRef.current = handleCardTap;
  }, [handleCardTap]);

  // Connect to local agent SSE stream on port 8002 for card tap events
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;

    const connectAgent = () => {
      try {
        // The agent always runs on the kiosk PC itself and binds to loopback only,
        // even when this page is served from a remote server (e.g. Azure).
        es = new EventSource("http://127.0.0.1:8002/api/agent/scan/stream");

        es.onopen = () => {
          if (!isMounted) return;
          setAgentOnline(true);
        };

        const handleSseTapEvent = (event: MessageEvent) => {
          if (!isMounted) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload && payload.card && payload.card.normalizedUid) {
              handleCardTapRef.current(payload.card.normalizedUid);
            } else if (payload && payload.cardUid) {
              handleCardTapRef.current(payload.cardUid);
            }
          } catch (e) {
            console.error("SSE card_tap parse error:", e);
          }
        };

        es.addEventListener("card_tap", handleSseTapEvent);
        es.onmessage = handleSseTapEvent;

        es.onerror = () => {
          if (es) es.close();
          if (isMounted) {
            retryTimeout = setTimeout(connectAgent, 5000);
          }
        };
      } catch {
        if (isMounted) {
          retryTimeout = setTimeout(connectAgent, 5000);
        }
      }
    };

    connectAgent();

    return () => {
      isMounted = false;
      if (es) es.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  // Unified Window Keystroke Burst Listener (Single capture path for USB keyboard-wedge reader)
  useEffect(() => {
    const flushKeyBuffer = () => {
      if (burstFinishTimerRef.current) {
        clearTimeout(burstFinishTimerRef.current);
        burstFinishTimerRef.current = null;
      }
      const capturedUid = keyBufferRef.current.join("");
      keyBufferRef.current = [];
      isReaderSpeedBurstRef.current = true;
      burstOverflowedRef.current = false;
      if (wedgeInputRef.current) {
        wedgeInputRef.current.value = "";
      }
      if (capturedUid.length >= 4 && capturedUid.length <= 32) {
        setReaderStatus((prev) => (prev === "READING" ? "READING" : "CONNECTED"));
        setReaderBanner(null);
        handleCardTap(capturedUid);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block browser zoom shortcuts (Ctrl/Cmd + +/-/0)
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      const gap = lastKeyTimeRef.current > 0 ? now - lastKeyTimeRef.current : 0;

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (burstFinishTimerRef.current) {
          clearTimeout(burstFinishTimerRef.current);
          burstFinishTimerRef.current = null;
        }
        lastKeyTimeRef.current = now;

        if (burstOverflowedRef.current) {
          burstOverflowedRef.current = false;
          clearWedgeBuffer(true);
          return;
        }

        if (keyBufferRef.current.length > 0 && gap > 120) {
          clearWedgeBuffer(true);
          return;
        }

        if (keyBufferRef.current.length >= 4 && keyBufferRef.current.length <= 32) {
          flushKeyBuffer();
        } else {
          clearWedgeBuffer(true);
        }
        return;
      }

      if (e.key.length === 1) {
        if (gap > 120 && (keyBufferRef.current.length > 0 || burstOverflowedRef.current)) {
          if (burstFinishTimerRef.current) {
            clearTimeout(burstFinishTimerRef.current);
            burstFinishTimerRef.current = null;
          }
          keyBufferRef.current = [];
          isReaderSpeedBurstRef.current = true;
          burstOverflowedRef.current = false;
        } else if (keyBufferRef.current.length > 0) {
          if (gap >= 75) {
            isReaderSpeedBurstRef.current = false;
          }
        } else {
          isReaderSpeedBurstRef.current = true;
        }

        lastKeyTimeRef.current = now;

        if (burstOverflowedRef.current) {
          return;
        }

        keyBufferRef.current.push(e.key);

        // Discard anything over 32 characters
        if (keyBufferRef.current.length > 32) {
          burstOverflowedRef.current = true;
          keyBufferRef.current = [];
          if (burstFinishTimerRef.current) {
            clearTimeout(burstFinishTimerRef.current);
            burstFinishTimerRef.current = null;
          }
          if (wedgeInputRef.current) {
            wedgeInputRef.current.value = "";
          }
          return;
        }

        if (wedgeInputRef.current) {
          wedgeInputRef.current.value = keyBufferRef.current.join("");
        }

        if (burstFinishTimerRef.current) {
          clearTimeout(burstFinishTimerRef.current);
          burstFinishTimerRef.current = null;
        }

        // Auto-submit 150ms after the last key if buffer is 6+ characters typed at reader speed (gaps under 75ms)
        if (keyBufferRef.current.length >= 6 && isReaderSpeedBurstRef.current) {
          burstFinishTimerRef.current = setTimeout(() => {
            flushKeyBuffer();
          }, 150);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (burstFinishTimerRef.current) {
        clearTimeout(burstFinishTimerRef.current);
        burstFinishTimerRef.current = null;
      }
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCardTap, clearWedgeBuffer]);

  // Dev helper: window.__simulateWedge(uid, { enter, gapMs }) available only when NODE_ENV !== "production"
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const simulateWedge = (
      text: string,
      opts?: { enter?: boolean; gapMs?: number }
    ): Promise<void> => {
      const enter = opts?.enter ?? true;
      const gapMs = Math.max(1, opts?.gapMs ?? 10);
      const keys = Array.from(String(text));
      if (enter) {
        keys.push("Enter");
      }

      return new Promise((resolve) => {
        if (keys.length === 0) {
          resolve();
          return;
        }
        keys.forEach((k, idx) => {
          const fire = () => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: k,
                bubbles: true,
                cancelable: true,
              })
            );
            if (idx === keys.length - 1) {
              resolve();
            }
          };
          if (idx === 0) {
            fire();
          } else {
            setTimeout(fire, idx * gapMs);
          }
        });
      });
    };

    (window as any).__simulateWedge = simulateWedge;
    return () => {
      delete (window as any).__simulateWedge;
    };
  }, []);

  return (
    <div
      draggable={false}
      style={{ touchAction: "manipulation", WebkitUserSelect: "none", userSelect: "none" }}
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col select-none"
    >
      <style>{`
        html, body {
          touch-action: manipulation;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
          -webkit-user-drag: none;
          overscroll-behavior: none;
        }
        @keyframes autoResetProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
        @keyframes logoHoldProgress {
          from { width: 0%; }
          to { width: 100%; }
        }
      `}</style>
      {/* Kiosk Hero Top Bar */}
      <header className="px-6 py-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-sm">
        <div
          onPointerDown={handleLogoHoldStart}
          onPointerUp={handleLogoHoldEnd}
          onPointerLeave={handleLogoHoldEnd}
          onPointerCancel={handleLogoHoldEnd}
          data-testid="kiosk-logo-secret-trigger"
          className="relative flex items-center space-x-3.5 cursor-pointer select-none py-1 pr-2 rounded-2xl transition-transform active:scale-[0.99]"
          title="Hold logo for 5 seconds to open Kiosk Settings"
        >
          <div className={`relative rounded-2xl transition-all duration-300 ${isHoldingLogo ? "ring-4 ring-indigo-500/40 scale-95" : ""}`}>
            <PhonixEmblem size={46} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight flex items-center space-x-2">
              <span className="text-slate-900 dark:text-white">
                NEX<span className="bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 dark:from-violet-400 dark:via-pink-400 dark:to-amber-400 bg-clip-text text-transparent">US</span>
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 font-bold border border-cyan-300 dark:border-cyan-800">
                {kioskCode}
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {t.kioskSubtitle}
            </p>
          </div>

          {/* 5-Second Hold Progress Bar */}
          {isHoldingLogo && (
            <div className="absolute -bottom-1.5 left-0 right-2 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full"
                style={{ animation: "logoHoldProgress 5s linear forwards" }}
              />
            </div>
          )}
        </div>

        {/* Live Clock & Status Indicators */}
        <div className="flex items-center space-x-4">
          {stage !== "IDLE" && (
            <>
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-lg font-mono font-bold tracking-tight text-slate-800 dark:text-slate-200">
                  {currentTime}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {currentDate}
                </span>
              </div>
              {isClockSkewed && (
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
              )}
            </>
          )}

          {/* Clock Drift Informational Warning Badge (>2m difference between server and client clock) */}
          {isClockSkewed && (
            <div
              data-testid="kiosk-clock-skew-badge"
              title={`${t.clockSkewWarning} (~${clockDriftMinutes}m)`}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-100/90 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-xs font-semibold shadow-2xs"
            >
              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span>{t.clockSkewWarning}</span>
            </div>
          )}
        </div>
      </header>

      {/* Dropped Tap Warning Banner (when tap queue max 5 is full or overlay is active) */}
      {droppedTapWarning && (
        <div
          data-testid="kiosk-dropped-tap-banner"
          role="alert"
          className="relative z-[60] bg-amber-500 text-slate-950 px-6 py-3 text-center text-sm font-black flex items-center justify-center space-x-2.5 shadow-lg border-b border-amber-400 animate-bounce"
        >
          <AlertTriangle className="w-5 h-5 stroke-[2.5] flex-shrink-0" />
          <span>{droppedTapWarning}</span>
          {droppedTapCount > 1 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-950/15 text-xs font-mono">
              ({droppedTapCount})
            </span>
          )}
        </div>
      )}

      {/* Workspace: Main Scan Zone + Recent Turnstile Activity Sidebar (Always visible on lg+, auto-hidden on narrow screens) */}
      <div className="flex-1 flex flex-col lg:flex-row w-full overflow-hidden relative">
        {/* Main Interactive Stage */}
        <main
          className={`flex-1 flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto transition-all duration-500 ${
            stage === "CONFIRMATION" && confirmationData
              ? confirmationData.type === "TIME_IN"
                ? "bg-emerald-500/10 dark:bg-emerald-950/40"
                : "bg-red-500/10 dark:bg-red-950/40"
              : ""
          }`}
        >
          <div className="w-full max-w-3xl flex flex-col items-center justify-center my-auto">
            {/* STAGE 1: IDLE / WELCOME SCREEN */}
            {stage === "IDLE" && (
              <div className="w-full text-center flex flex-col items-center justify-center space-y-8 py-8 animate-in fade-in duration-300">
                {/* Real-time Hero Clock & Date Display */}
                <div className="relative w-full max-w-xl sm:max-w-2xl">
                  <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 rounded-3xl blur-2xl opacity-20 dark:opacity-30 transition duration-700" />
                  <div className="relative bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 rounded-3xl p-8 sm:p-10 shadow-2xl flex flex-col items-center justify-center space-y-4">
                    {/* Big Live Digital Clock with Meridiem right beside it */}
                    <div className="flex items-baseline justify-center gap-2 sm:gap-3.5 select-none py-1 whitespace-nowrap">
                      <span className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black font-mono tracking-tight text-slate-900 dark:text-white drop-shadow-sm">
                        {timeDigits}
                      </span>
                      {timeMeridiem && (
                        <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black font-mono text-blue-600 dark:text-blue-400 tracking-wider">
                          {timeMeridiem}
                        </span>
                      )}
                    </div>

                    {/* Live Date Display */}
                    <div className="text-lg sm:text-xl font-bold text-slate-700 dark:text-slate-200 flex items-center space-x-2.5">
                      <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      <span>{currentDate || "Loading date..."}</span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Philippine Standard Time (PST • GMT+8)
                    </div>
                  </div>
                </div>

                <div className="space-y-2 max-w-3xl w-full text-center px-4">
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
                    {t.readyPrompt}
                  </h2>
                  <p className="text-xs sm:text-sm md:text-base text-slate-600 dark:text-slate-400 font-medium whitespace-nowrap">
                    {t.readyInstruction}
                  </p>
                </div>

                {/* Diagnostic Display Input (Read-Only, Shown Only When ?diagnostic=1) */}
                {isDiagnosticMode && (
                  <div className="w-full max-w-md pt-2">
                    <div className="flex items-center space-x-2">
                      <div className="relative flex-1">
                        <input
                          ref={wedgeInputRef}
                          type="text"
                          readOnly
                          tabIndex={-1}
                          placeholder="Scanner wedge buffer (read-only diagnostic)..."
                          defaultValue=""
                          className="w-full px-4 py-2.5 rounded-xl border-2 border-blue-500/80 dark:border-blue-500/80 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none shadow-sm cursor-default"
                        />
                        <span
                          className="absolute right-3 top-1/2 -translate-y-1/2 flex h-2 w-2 pointer-events-none"
                          title="Wedge Reader Buffer Active"
                        >
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-2xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800 text-xs font-semibold text-cyan-800 dark:text-cyan-300">
                  <Sparkles className="w-4 h-4 text-cyan-500" />
                  <span>Dedicated Kiosk Turnstile Active • Automatic Time In &amp; Time Out Engine</span>
                </div>
              </div>
            )}

            {/* STAGE 2: READING NFC TAG STATE */}
            {stage === "READING" && (
              <div className="flex flex-col items-center justify-center space-y-6 py-20">
                <div className="w-28 h-28 rounded-full bg-blue-50 dark:bg-blue-950/60 border-4 border-blue-500 flex items-center justify-center">
                  <Loader2 className="w-14 h-14 text-blue-600 dark:text-blue-400 animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{t.readingCard}</h3>
                  <p className="text-sm text-slate-500">Hold phone steady against the reader...</p>
                </div>
              </div>
            )}

            {/* STAGE: AUTO-PROCESSING (Automatic Time In / Time Out) */}
            {stage === "AUTO_PROCESSING" && resolvedData && (
              <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
                <div
                  className={`w-20 h-20 rounded-full ${
                    autoAction === "TIME_IN"
                      ? "bg-emerald-100 dark:bg-emerald-950/60 border-emerald-500 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-100 dark:bg-red-950/60 border-red-500 text-red-600 dark:text-red-400"
                  } border-4 flex items-center justify-center mx-auto shadow-lg`}
                >
                  <Loader2 className="w-9 h-9 animate-spin" />
                </div>

                <div className="space-y-2">
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                      autoAction === "TIME_IN"
                        ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                        : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800"
                    }`}
                  >
                    {autoAction === "TIME_IN" ? t.autoProcessingTimeIn : t.autoProcessingTimeOut}
                  </span>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {autoAction === "TIME_IN" ? t.autoProcessingTimeInSub : t.autoProcessingTimeOutSub}
                  </h2>
                </div>

                <div className="p-5 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/60 border-2 border-indigo-200 dark:border-indigo-800/80 text-center space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {t.employeeLabel}
                  </span>
                  <div className="font-black text-xl sm:text-2xl text-slate-900 dark:text-white">
                    {resolvedData.employee?.fullName}
                  </div>
                </div>
              </div>
            )}

            {/* STAGE: ACCIDENTAL DOUBLE-TAP PREVENTED */}
            {stage === "DOUBLE_TAP_PREVENTED" && doubleTapInfo && (
              <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl border-2 border-amber-500/60 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-950/60 border-4 border-amber-500 flex items-center justify-center mx-auto text-amber-600 dark:text-amber-400 shadow-lg shadow-amber-500/20 animate-pulse">
                  <AlertTriangle className="w-10 h-10" />
                </div>

                <div className="space-y-1.5">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    {doubleTapInfo.actionAttempted === "TIME_OUT"
                      ? "TIME OUT BLOCKED — JUST TIMED IN"
                      : "TIME IN BLOCKED — JUST TIMED OUT"}
                  </span>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    {t.doubleTapAlert}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto pt-1 leading-relaxed">
                    {doubleTapInfo.message || t.doubleTapDesc}
                  </p>
                </div>

                {/* Differential Metrics Box */}
                <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-left space-y-2.5">
                  {doubleTapInfo.ownerName && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Employee:</span>
                      <span className="font-bold text-slate-900 dark:text-white text-sm">{doubleTapInfo.ownerName}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600 dark:text-slate-400">Current Status:</span>
                    <span
                      className={`font-bold font-mono text-xs ${
                        doubleTapInfo.currentStatus === "TIMED_IN"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {doubleTapInfo.currentStatus === "TIMED_IN" ? "ACTIVE / IN-USE (TIMED IN)" : "DEPOT / RETURNED (TIMED OUT)"}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-amber-200 dark:border-amber-900/60 flex justify-between items-center text-xs font-mono">
                    <span className="text-amber-800 dark:text-amber-300 font-semibold">{t.doubleTapElapsed}:</span>
                    <span className="font-bold text-amber-900 dark:text-amber-200">{doubleTapInfo.elapsedSeconds}s ago</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-amber-800 dark:text-amber-300 font-semibold">{t.doubleTapRemaining}:</span>
                    <span className="font-extrabold text-amber-600 dark:text-amber-400 text-sm">{doubleTapInfo.remainingSeconds}s</span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                  ✓ Device safely remains {doubleTapInfo.currentStatus === "TIMED_IN" ? "TIMED IN" : "TIMED OUT"}.
                </div>

                {/* Zero-Interaction Touchless Reset Indicator */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-center space-x-2 text-xs font-semibold text-slate-400">
                    <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                    <span>Zero-touch mode • Auto-resetting for next scan...</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ animation: "autoResetProgress 4s linear forwards" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 5: CONFIRMATION SCREEN */}
            {stage === "CONFIRMATION" && confirmationData && (
              <div className="relative w-full max-w-xl mx-auto animate-in fade-in zoom-in-95 duration-300">
                {/* Ambient Outer Halo */}
                <div
                  className={`absolute -inset-4 rounded-3xl blur-2xl opacity-60 animate-pulse ${
                    confirmationData.type === "TIME_IN" ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />

                {/* Whole Green (TIME IN) or Whole Red (TIME OUT) Card */}
                <div
                  className={`relative w-full rounded-3xl p-8 sm:p-10 shadow-2xl text-center space-y-6 text-white border-4 ${
                    confirmationData.type === "TIME_IN"
                      ? "bg-gradient-to-b from-emerald-600 via-emerald-600 to-emerald-700 border-emerald-300 ring-8 ring-emerald-500/30 shadow-emerald-950/50"
                      : "bg-gradient-to-b from-red-600 via-red-600 to-rose-700 border-red-300 ring-8 ring-red-500/30 shadow-red-950/50"
                  }`}
                >
                  {/* Massive Action Icon Badge */}
                  <div
                    className={`w-24 h-24 rounded-full bg-white shadow-2xl border-4 flex items-center justify-center mx-auto ${
                      confirmationData.type === "TIME_IN"
                        ? "border-emerald-200 text-emerald-600 shadow-emerald-950/40"
                        : "border-red-200 text-red-600 shadow-red-950/40"
                    }`}
                  >
                    {confirmationData.type === "TIME_IN" ? (
                      <ArrowUpRight className="w-14 h-14 stroke-[3]" />
                    ) : (
                      <ArrowDownLeft className="w-14 h-14 stroke-[3]" />
                    )}
                  </div>

                  {/* Status Banner & Large Headline */}
                  <div className="space-y-2">
                    <div className="inline-flex items-center space-x-2 px-5 py-1.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-xs font-black tracking-widest uppercase shadow-sm">
                      <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                      <span>
                        {confirmationData.type === "TIME_IN" ? "TIME IN CONFIRMED" : "TIME OUT CONFIRMED"}
                      </span>
                    </div>
                    <h2 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight drop-shadow-md">
                      {confirmationData.type === "TIME_IN" ? "PHONE TIMED IN" : "PHONE TIMED OUT"}
                    </h2>
                  </div>

                  {/* PROMINENT OWNER CARD */}
                  <div className="p-6 rounded-2xl bg-white/20 backdrop-blur-md border-2 border-white/40 flex items-center space-x-4 shadow-lg text-left text-white">
                    <div
                      className={`w-16 h-16 rounded-2xl bg-white flex items-center justify-center font-black text-3xl shadow-lg flex-shrink-0 ${
                        confirmationData.type === "TIME_IN" ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {confirmationData.ownerName && confirmationData.ownerName !== "Company Fleet Asset" ? (
                        confirmationData.ownerName.charAt(0).toUpperCase()
                      ) : (
                        <User className="w-8 h-8" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-white bg-black/25 px-2.5 py-0.5 rounded-full border border-white/25">
                        Employee Name
                      </span>
                      <h3 className="text-2xl sm:text-3xl font-black text-white truncate mt-1.5 drop-shadow-xs">
                        {confirmationData.ownerName || "Unassigned"}
                      </h3>
                      {confirmationData.department && (
                        <p className="text-xs text-white/95 font-bold truncate mt-1">
                          {confirmationData.department}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* DETAILS PANEL */}
                  <div className="p-4 rounded-2xl bg-black/20 backdrop-blur-md border border-white/20 text-left text-xs space-y-2.5 text-white">
                    {confirmationData.type === "TIME_IN" ? (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Time In Timestamp:</span>
                          <span className="font-mono font-black text-base text-white">{confirmationData.timestamp}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Device Custody Status:</span>
                          <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-white text-emerald-800 shadow-sm">
                            ACTIVE / TIMED IN
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Original Time In:</span>
                          <span className="font-mono font-semibold text-white/90">{confirmationData.timedIn}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Time Out Timestamp:</span>
                          <span className="font-mono font-black text-base text-white">{confirmationData.timedOut}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Shift Duration Elapsed:</span>
                          <span className="font-mono font-black text-sm text-white bg-white/20 px-2 py-0.5 rounded-md border border-white/20">
                            {confirmationData.duration}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-white/75">Device Custody Status:</span>
                          <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-white text-red-800 shadow-sm">
                            RETURNED / TIMED OUT
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Zero-Interaction Touchless Reset Indicator */}
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-center space-x-2 text-xs font-bold text-white/90">
                      <Sparkles className="w-4 h-4 text-white animate-pulse" />
                      <span>Zero-touch turnstile active • Ready for next scan automatically</span>
                    </div>
                    <div className="w-full bg-black/30 rounded-full h-2.5 overflow-hidden shadow-inner border border-white/20">
                      <div
                        key={`${confirmationData.refCode}-${confirmationDurationMs}`}
                        className="h-full bg-white rounded-full"
                        style={{
                          animation: `autoResetProgress ${confirmationDurationMs / 1000}s linear forwards`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 6: ERROR SCREEN (Case E / Unknown / Invalid) */}
            {stage === "ERROR" && (
              <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl border border-rose-200 dark:border-rose-900 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-rose-100 dark:bg-rose-950/60 border-4 border-rose-500 flex items-center justify-center mx-auto text-rose-600 dark:text-rose-400">
                  <ShieldAlert className="w-10 h-10" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white">
                    {t.scanFailed}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {genericErrorMessage}
                  </p>
                </div>

                {/* Zero-Touch Auto-Reset Indicator */}
                <div className="pt-2 space-y-2">
                  <div className="flex items-center justify-center space-x-2 text-xs font-semibold text-slate-400">
                    <Sparkles className="w-4 h-4 text-rose-500 animate-pulse" />
                    <span>Zero-touch mode • Auto-resetting for next scan...</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{ animation: `autoResetProgress ${confirmationDurationMs / 1000}s linear forwards` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STAGE 7: MAINTENANCE / DIAGNOSTICS SCREEN (30s) */}
            {stage === "MAINTENANCE" && diagnosticsInfo && (
              <div
                data-testid="kiosk-diagnostics-screen"
                className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl border-2 border-indigo-500/70 space-y-6 animate-in fade-in zoom-in-95 duration-200"
              >
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-300 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <Wrench className="w-6 h-6" />
                    </div>
                    <div className="text-left">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                        Maintenance Mode • NFC Diagnostics
                      </span>
                      <h2 className="text-xl font-black text-slate-900 dark:text-white mt-0.5">
                        Kiosk Station Telemetry
                      </h2>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs text-slate-400">Auto-closing in</div>
                    <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                      {maintenanceRemainingSec}s
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-xs">
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                      <Activity className="w-4 h-4 text-indigo-500" />
                      <span>Reader Status:</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-reader-status">
                      {diagnosticsInfo.readerStatus}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                      <Server className="w-4 h-4 text-indigo-500" />
                      <span>Agent Status:</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-agent-status">
                      {diagnosticsInfo.agentStatus}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                      <Database className="w-4 h-4 text-emerald-500" />
                      <span>DB / Health Status:</span>
                    </span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400" data-testid="diag-health-status">
                      {diagnosticsInfo.healthStatus} (DB: {diagnosticsInfo.dbStatus})
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                      <HardDrive className="w-4 h-4 text-blue-500" />
                      <span>Last Backup Time:</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-last-backup">
                      {diagnosticsInfo.lastBackupAt
                        ? new Date(diagnosticsInfo.lastBackupAt).toLocaleString()
                        : "Never"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">App Version:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-app-version">
                      v{diagnosticsInfo.appVersion}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">KIOSK_CODE:</span>
                    <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400" data-testid="diag-kiosk-code">
                      {diagnosticsInfo.kioskCode}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Server Time:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-server-time">
                      {diagnosticsInfo.serverTime}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Queue Length:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white" data-testid="diag-queue-length">
                      {queuedCount}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-indigo-900 dark:text-indigo-200 font-semibold text-center sm:text-left">
                    Tap the maintenance card again within {maintenanceRemainingSec}s to reload the kiosk page, or wait to return to idle.
                  </div>
                  <button
                    type="button"
                    data-testid="kiosk-maintenance-reload-btn"
                    onClick={() => void safeReload()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm flex-shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reload</span>
                  </button>
                </div>

                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ animation: "autoResetProgress 30s linear forwards" }}
                  />
                </div>
              </div>
            )}

            {/* Queued Tap Indicator */}
            {queuedCount > 0 && (
              <div
                data-testid="kiosk-queue-indicator"
                className="mt-5 inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-amber-500 text-slate-950 text-xs font-black tracking-wide shadow-lg border border-amber-300 animate-pulse"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  {queuedCount === 1
                    ? "Next: processing 1 more tap…"
                    : `Next: processing ${queuedCount} more taps…`}
                </span>
              </div>
            )}
          </div>
        </main>

        {/* Recent Turnstile Logs Sidebar (Always visible on desktop/kiosk screens, auto-hidden on narrow screens) */}
        <aside className="hidden lg:flex lg:w-96 border-l border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl flex-col flex-shrink-0 z-10 max-h-[calc(100vh-130px)]">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-sm">
                <History className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t.recentLogsTitle}
                  </h2>
                  <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{t.liveFeed}</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.recentLogsSubtitle}
                </p>
              </div>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {recentLogs.length === 0 ? (
              <div className="h-56 flex flex-col items-center justify-center text-center p-6 space-y-2 text-slate-400 dark:text-slate-500">
                <Clock className="w-8 h-8 opacity-40 animate-pulse" />
                <p className="text-xs font-medium">{t.noRecentLogs}</p>
              </div>
            ) : (
              recentLogs.map((log) => {
                const isTimeIn = log.action === "TIME_IN";
                return (
                  <div
                    key={log.id}
                    className={`p-3 rounded-2xl border transition shadow-sm ${
                      isTimeIn
                        ? "bg-emerald-50/50 dark:bg-emerald-950/25 border-emerald-200/90 dark:border-emerald-900/40 border-l-4 border-l-emerald-500"
                        : "bg-red-50/50 dark:bg-red-950/25 border-red-200/90 dark:border-red-900/40 border-l-4 border-l-red-500"
                    }`}
                  >
                    {/* Top Action & Time Header */}
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
                          isTimeIn
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800"
                            : "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-800"
                        }`}
                      >
                        {isTimeIn ? (
                          <ArrowUpRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3 text-red-600 dark:text-red-400 stroke-[2.5]" />
                        )}
                        <span>{isTimeIn ? t.timeInAction : t.timeOutAction}</span>
                      </span>

                      <span className="text-[11px] font-mono font-medium text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                        <span>{formatTimeOnly(log.timestamp)}</span>
                        <span className="text-slate-300 dark:text-slate-700">•</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {formatRelativeTime(log.timestamp, lang === "FIL")}
                        </span>
                      </span>
                    </div>

                    {/* Highlighted Employee Name & Department */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs max-w-full">
                          <User className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
                          <span className="text-sm font-black text-slate-900 dark:text-white truncate">
                            {log.employeeName}
                          </span>
                        </div>
                        {log.department && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium pl-1 pt-1 truncate">
                            {log.department}
                          </div>
                        )}
                      </div>

                      {/* Duration Pill for Time Out */}
                      {!isTimeIn && log.formattedDuration && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-red-100/90 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 shadow-2xs shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{log.formattedDuration}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sidebar Footer count */}
          <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/70 text-[10px] text-slate-400 dark:text-slate-500 font-mono flex items-center justify-between">
            <span>Showing last {recentLogs.length} events</span>
            <span className="text-emerald-500 font-semibold flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Auto-refreshing</span>
            </span>
          </div>
        </aside>
      </div>

      {/* Full-Screen Offline Overlay (when /api/health or DB is down for >= 30s) */}
      {isOfflineOverlay && (
        <div
          data-testid="kiosk-offline-overlay"
          role="alertdialog"
          aria-live="assertive"
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl text-white flex flex-col items-center justify-center p-8 text-center select-none animate-in fade-in duration-300"
        >
          <div className="w-full max-w-2xl rounded-3xl border border-amber-500/40 bg-slate-900/90 p-10 shadow-2xl flex flex-col items-center space-y-6">
            <div className="w-24 h-24 rounded-full bg-amber-500/15 border-2 border-amber-400/50 flex items-center justify-center text-amber-400 shadow-lg">
              <WifiOff className="w-12 h-12 animate-pulse" />
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                {t.offlineOverlayTitle}
              </h2>
              <p className="text-base sm:text-lg font-semibold text-amber-300/90">
                {lang === "EN" ? I18N.FIL.offlineOverlayTitle : I18N.EN.offlineOverlayTitle}
              </p>
            </div>

            <p className="text-sm sm:text-base text-slate-300 max-w-lg leading-relaxed">
              {t.offlineOverlaySubtitle}
            </p>

            <div className="inline-flex items-center space-x-2.5 px-4 py-2 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-mono text-amber-300">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>{t.pleaseWaitAndTapAgain}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Maintenance Lock Overlay (when resolve returns 503 KIOSK_MAINTENANCE) */}
      {isMaintenanceLocked && (
        <div
          data-testid="kiosk-maintenance-lock-overlay"
          role="alertdialog"
          aria-live="assertive"
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl text-white flex flex-col items-center justify-center p-8 text-center select-none animate-in fade-in duration-300"
        >
          <div className="w-full max-w-2xl rounded-3xl border border-indigo-500/40 bg-slate-900/90 p-10 shadow-2xl flex flex-col items-center space-y-6">
            <div className="w-24 h-24 rounded-full bg-indigo-500/15 border-2 border-indigo-400/50 flex items-center justify-center text-indigo-400 shadow-lg">
              <Lock className="w-12 h-12 animate-pulse" />
            </div>

            <div className="space-y-2">
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
                {t.maintenanceLockTitle}
              </h2>
              <p className="text-base sm:text-lg font-semibold text-indigo-300/90">
                {lang === "EN" ? I18N.FIL.maintenanceLockTitle : I18N.EN.maintenanceLockTitle}
              </p>
            </div>

            <p className="text-sm sm:text-base text-slate-300 max-w-lg leading-relaxed">
              {t.maintenanceLockSubtitle}
            </p>

            <div className="inline-flex items-center space-x-2.5 px-4 py-2 rounded-full bg-slate-800/90 border border-slate-700 text-xs font-mono text-indigo-300">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>
                {kioskCode} • Re-checking status automatically…
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Secret Kiosk Settings Modal (Unlocked by holding the NEXUS logo for 5 seconds) */}
      {isSecretSettingsOpen && (
        <div
          data-testid="kiosk-secret-settings-modal"
          className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                    Kiosk Terminal Controls
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Station {kioskCode || "KIOSK"} • Hidden Operator Menu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSecretSettingsOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Actions */}
            <div className="p-6 space-y-3.5">
              {/* Option 1: Full Screen Toggle */}
              <button
                type="button"
                onClick={() => void handleToggleFullscreen()}
                className="w-full p-4 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/70 dark:bg-indigo-950/40 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/50 text-left flex items-center justify-between transition-all group"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20 group-hover:scale-105 transition-transform">
                    {isFullscreen ? (
                      <Minimize2 className="w-5 h-5" />
                    ) : (
                      <Maximize2 className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">
                      {isFullscreen ? "Exit Full Screen" : "Full Screen Website"}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isFullscreen
                        ? "Restore standard browser window"
                        : "Expand kiosk to full screen display mode"}
                    </div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  {isFullscreen ? "Active" : "Enable"}
                </span>
              </button>

              {/* Option 2: Log Out */}
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={() => void handleKioskLogout()}
                className="w-full p-4 rounded-2xl border-2 border-rose-200 dark:border-rose-900/80 bg-rose-50/70 dark:bg-rose-950/40 hover:bg-rose-100/80 dark:hover:bg-rose-900/50 text-left flex items-center justify-between transition-all group disabled:opacity-60"
              >
                <div className="flex items-center space-x-3.5">
                  <div className="w-11 h-11 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-md shadow-rose-600/20 group-hover:scale-105 transition-transform">
                    {isLoggingOut ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <LogOut className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-black text-rose-950 dark:text-rose-200">
                      {isLoggingOut ? "Logging Out..." : "Log Out"}
                    </div>
                    <div className="text-xs text-rose-700/80 dark:text-rose-300/80">
                      End kiosk session and return to login screen
                    </div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                  Exit
                </span>
              </button>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
              <button
                type="button"
                onClick={() => setIsSecretSettingsOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-4 text-center text-xs text-slate-400 border-t border-slate-200 dark:border-slate-800/80 bg-white/40 dark:bg-slate-900/40">
        NEXUS • NFC-Enabled Exchange &amp; Usage System • All rights reserved 2026 @ PBI Dev Team
      </footer>
    </div>
  );
}
