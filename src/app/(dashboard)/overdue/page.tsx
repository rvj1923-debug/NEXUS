"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ClockAlert,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Check,
  XCircle,
  Smartphone,
  User,
  Mail,
  FileCheck2,
  Send,
  AlertCircle,
  Building2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Printer,
  Camera,
  Image as ImageIcon,
  FolderOpen,
  Eye,
  Upload,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { parseSupervisors } from "@/lib/supervisors";

interface OverdueCaseItem {
  id: string;
  caseNumber: string;
  status: string;
  minutesOverdue: number;
  detectedAt: string;
  resolvedAt?: string | null;
  resolutionType?: string | null;
  resolutionNotes?: string | null;
  supervisorEmail?: string | null;
  supervisorNotifiedAt?: string | null;
  overtimeApprovalStatus: "PENDING" | "APPROVED" | "NOT_APPROVED";
  supervisorReviewedBy?: string | null;
  supervisorReviewedAt?: string | null;
  supervisorRemarks?: string | null;
  hrEmail?: string | null;
  hrEmailSentAt?: string | null;
  incidentReportStatus?: "PENDING_SUPERVISOR" | "NO_NEED_TO_SERVE" | "OPEN" | "CLOSED";
  requiresServingReport?: boolean;
  incidentReportIssued?: boolean;
  incidentRemovedByHr?: boolean;
  incidentStatusLabel?: string;
  hrClearedBy?: string | null;
  hrClearedAt?: string | null;
  hrClearanceRemarks?: string | null;
  proofImageUrl?: string | null;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department?: {
      name: string;
      supervisorName?: string | null;
      supervisorEmail?: string | null;
    } | null;
    supervisor?: {
      firstName: string;
      lastName: string;
      email?: string | null;
    } | null;
  } | null;
  phoneAsset?: {
    id: string;
    assetTag: string;
    brand: string;
    model: string;
    imei?: string | null;
  } | null;
  custodyTransaction: {
    id: string;
    transactionCode: string;
    timestamp: string;
    returnDeadlineAt?: string | null;
    nfcCard?: {
      cardUid: string;
      cardNumber?: string | null;
    } | null;
  };
}

function formatOverdueDuration(minutesOverdue: number, timeInTimestamp?: string): string {
  if (timeInTimestamp) {
    const elapsedMs = Date.now() - new Date(timeInTimestamp).getTime();
    const totalHours = Math.max(24, Math.floor(elapsedMs / (1000 * 60 * 60)));
    const remMins = Math.max(0, Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60)));
    return `${totalHours}h ${remMins}m elapsed (+${minutesOverdue}m past 24h)`;
  }
  const h = Math.floor(minutesOverdue / 60);
  const m = minutesOverdue % 60;
  return h > 0 ? `+${h}h ${m}m past 24h` : `+${m}m past 24h`;
}

function OverdueMonitoringContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reviewCaseIdParam = searchParams.get("reviewCaseId");
  const hrCaseIdParam =
    searchParams.get("hrCaseId") || searchParams.get("hrClearCaseId");
  const handledUrlParamRef = useRef<string | null>(null);

  const clearUrlCaseParams = () => {
    if (typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      if (
        url.searchParams.has("hrCaseId") ||
        url.searchParams.has("hrClearCaseId") ||
        url.searchParams.has("reviewCaseId")
      ) {
        url.searchParams.delete("hrCaseId");
        url.searchParams.delete("hrClearCaseId");
        url.searchParams.delete("reviewCaseId");
        const cleanUrl = url.pathname + (url.search ? url.search : "");
        window.history.replaceState(null, "", cleanUrl);
        router.replace(cleanUrl, { scroll: false });
      }
    }
  };

  const [cases, setCases] = useState<OverdueCaseItem[]>([]);
  const [defaultHrEmail, setDefaultHrEmail] = useState("hr@company.com");
  const [summary, setSummary] = useState({
    open: 0,
    active: 0,
    resolved: 0,
    pendingSupervisorForm: 0,
    overtimeApproved: 0,
    overtimeNotApproved: 0,
    incidentReportIssued: 0,
    incidentRemovedByHr: 0,
  });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState<
    | "ALL"
    | "OVERDUE_REPORT"
    | "INCIDENT_OPEN"
    | "PENDING_SUPERVISOR"
    | "APPROVED_NO_SERVE"
    | "INCIDENT_CLOSED_HR"
  >("ALL");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // SMTP Email Configuration State
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [isSmtpModalOpen, setIsSmtpModalOpen] = useState(false);
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpHasPassword, setSmtpHasPassword] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [resendingCaseId, setResendingCaseId] = useState<string | null>(null);

  // Current Logged-in User (for pre-filling supervisor/HR name/email if applicable)
  const [currentUser, setCurrentUser] = useState<{ fullName?: string; email?: string } | null>(null);

  // Modal / Form State
  const [selectedCase, setSelectedCase] = useState<OverdueCaseItem | null>(null);
  const [modalMode, setModalMode] = useState<"SUPERVISOR_FORM" | "RESOLVE" | "HR_REMOVE_INCIDENT" | null>(null);
  const [viewingProofCase, setViewingProofCase] = useState<OverdueCaseItem | null>(null);

  // Supervisor Overtime Form State
  const [overtimeDecision, setOvertimeDecision] = useState<"APPROVED" | "NOT_APPROVED">("APPROVED");
  const [supervisorName, setSupervisorName] = useState("");
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisorRemarks, setSupervisorRemarks] = useState("");
  const [hrEmail, setHrEmail] = useState("hr@company.com");

  // HR Department Open / Close Incident Report State
  const [hrAction, setHrAction] = useState<"CLOSE" | "OPEN">("CLOSE");
  const [hrProofImage, setHrProofImage] = useState<string | null>(null);
  const [hrProofFileName, setHrProofFileName] = useState<string>("");
  const [uploadingProof, setUploadingProof] = useState(false);
  const [hrOfficerName, setHrOfficerName] = useState("HR Department Admin");
  const [hrOfficerEmail, setHrOfficerEmail] = useState("hr@company.com");
  const [hrClearanceRemarks, setHrClearanceRemarks] = useState("");
  const [hrAlsoResolveCase, setHrAlsoResolveCase] = useState(false);

  // Administrative Resolve State
  const [resolutionType, setResolutionType] = useState<"SURRENDERED" | "REPORTED_LOST" | "EXCUSED" | "ESCALATED_HR">("SURRENDERED");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  const openHrRemoveIncidentModal = (c: OverdueCaseItem, defaultHr = defaultHrEmail) => {
    setSelectedCase(c);
    setModalMode("HR_REMOVE_INCIDENT");
    setActionError(null);
    setHrAction(c.incidentReportStatus === "CLOSED" ? "OPEN" : "CLOSE");
    setHrProofImage(c.proofImageUrl || null);
    setHrProofFileName(c.proofImageUrl ? "Existing served proof photo" : "");
    setHrOfficerName(currentUser?.fullName || "HR Department Admin");
    setHrOfficerEmail(c.hrEmail || currentUser?.email || defaultHr || "hr@company.com");
    setHrClearanceRemarks(
      c.hrClearanceRemarks ||
        (c.overtimeApprovalStatus === "APPROVED"
          ? "Supervisor approved overdue phone — No need to serve Incident Report."
          : "Incident Report printed and served to employee with attached photo proof.")
    );
    setHrAlsoResolveCase(false);
  };

  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    setHrProofFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setHrProofImage(reader.result);
        setActionError(null);
      }
      setUploadingProof(false);
    };
    reader.onerror = () => {
      setUploadingProof(false);
    };
    reader.readAsDataURL(file);
  };

  const openSupervisorFormModal = (c: OverdueCaseItem, defaultHr = defaultHrEmail) => {
    setSelectedCase(c);
    setModalMode("SUPERVISOR_FORM");
    setActionError(null);

    const existingDecision =
      c.overtimeApprovalStatus === "NOT_APPROVED" ? "NOT_APPROVED" : "APPROVED";
    setOvertimeDecision(existingDecision);

    const deptSupName =
      c.supervisorReviewedBy ||
      c.employee?.department?.supervisorName ||
      (c.employee?.supervisor
        ? `${c.employee.supervisor.firstName} ${c.employee.supervisor.lastName}`.trim()
        : "") ||
      currentUser?.fullName ||
      `${c.employee?.department?.name || "Department"} Supervisor`;

    const deptSupEmail =
      c.supervisorEmail ||
      c.employee?.department?.supervisorEmail ||
      c.employee?.supervisor?.email ||
      currentUser?.email ||
      "supervisor@company.com";

    setSupervisorName(deptSupName);
    setSupervisorEmail(deptSupEmail);
    setSupervisorRemarks(c.supervisorRemarks || "");
    const effectiveHr =
      c.hrEmail && c.hrEmail !== "hr@company.com"
        ? c.hrEmail
        : defaultHr || "hr@company.com";
    setHrEmail(effectiveHr);
  };

  const fetchSmtpConfig = async () => {
    try {
      const res = await fetch("/api/overdue/email-config");
      if (res.ok) {
        const data = await res.json();
        setSmtpConfigured(Boolean(data.isConfigured));
        setSmtpHost(data.smtpHost || "smtp.gmail.com");
        setSmtpPort(data.smtpPort || "587");
        setSmtpUser(data.smtpUser || "");
        setSmtpHasPassword(Boolean(data.hasPassword));
        if (data.hrEmail) {
          setDefaultHrEmail(data.hrEmail);
        }
      }
    } catch {
      // ignore
    }
  };

  const fetchCases = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/overdue?status=ALL&limit=200`);
      if (res.ok) {
        const data = await res.json();
        const loadedCases: OverdueCaseItem[] = data.cases || [];
        setCases(loadedCases);
        if (data.defaultHrEmail) {
          setDefaultHrEmail(data.defaultHrEmail);
        }
        setSummary(
          data.summary || {
            open: 0,
            active: 0,
            resolved: 0,
            pendingSupervisorForm: 0,
            overtimeApproved: 0,
            overtimeNotApproved: 0,
            incidentReportIssued: 0,
            incidentRemovedByHr: 0,
          }
        );

        // If URL has ?hrCaseId=... or ?hrClearCaseId=..., automatically open the HR Incident Report modal ONCE
        if (hrCaseIdParam && handledUrlParamRef.current !== `hr:${hrCaseIdParam}`) {
          handledUrlParamRef.current = `hr:${hrCaseIdParam}`;
          clearUrlCaseParams();
          const target = loadedCases.find(
            (item) => item.id === hrCaseIdParam || item.caseNumber === hrCaseIdParam
          );
          if (target && target.incidentReportStatus !== "CLOSED" && !target.incidentRemovedByHr) {
            openHrRemoveIncidentModal(target, data.defaultHrEmail || "hr@company.com");
          }
        } else if (reviewCaseIdParam && handledUrlParamRef.current !== `rev:${reviewCaseIdParam}`) {
          // If URL has ?reviewCaseId=..., automatically open the Supervisor Overtime Form modal ONCE
          handledUrlParamRef.current = `rev:${reviewCaseIdParam}`;
          clearUrlCaseParams();
          const target = loadedCases.find(
            (item) => item.id === reviewCaseIdParam || item.caseNumber === reviewCaseIdParam
          );
          if (target && target.status !== "RESOLVED") {
            openSupervisorFormModal(target, data.defaultHrEmail || "hr@company.com");
          }
        }
      }
    } catch (err) {
      console.error("Failed to load overdue cases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setCurrentUser(d.user);
      })
      .catch(() => null);
    fetchSmtpConfig();
  }, []);

  useEffect(() => {
    fetchCases();
  }, [reviewCaseIdParam, hrCaseIdParam]);

  const handleSaveSmtpConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setSavingSmtp(true);
    try {
      const res = await fetch("/api/overdue/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SAVE_AND_TEST",
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          hrEmail: defaultHrEmail,
          testRecipient: smtpUser,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to save SMTP configuration.");
        return;
      }
      setSmtpConfigured(true);
      setSmtpHasPassword(true);
      setSmtpPass("");
      setIsSmtpModalOpen(false);
      setActionMessage(data.message || "SMTP Email configured and verified!");
      await fetchSmtpConfig();
    } catch (err: any) {
      setActionError(err.message || "Failed to save SMTP configuration.");
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleResendSupervisorEmail = async (c: OverdueCaseItem) => {
    setActionError(null);
    setActionMessage(null);
    setResendingCaseId(c.id);
    try {
      const res = await fetch("/api/overdue/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RESEND_SUPERVISOR",
          caseId: c.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(
          data.error ||
            "Failed to send email to supervisor. Please check your SMTP Email settings."
        );
        return;
      }
      if (data.simulated) {
        setActionError(
          `Simulated Only (Not delivered to real inbox): Please click "Configure Email (SMTP)" in the top right and enter your Sender Gmail + 16-char Google App Password so real emails can be sent to ${data.recipientEmail}.`
        );
      } else {
        setActionMessage(
          `✅ Live Email Delivered to Supervisor (${data.recipientEmail}) for Case ${c.caseNumber}!`
        );
      }
      await fetchCases();
    } catch (err: any) {
      setActionError(err.message || "Failed to resend supervisor email.");
    } finally {
      setResendingCaseId(null);
    }
  };

  const handleScanNow = async () => {
    try {
      setScanning(true);
      setActionMessage(null);
      setActionError(null);
      const res = await fetch("/api/overdue/scan", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setActionMessage(data.message || "24-hour overdue scan executed.");
        await fetchCases();
      } else {
        setActionError("Overdue scan failed.");
      }
    } catch (err: any) {
      setActionError(`Error: ${err.message}`);
    } finally {
      setScanning(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  const handleSubmitSupervisorForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setActionError(null);

    try {
      setSubmittingAction(true);
      const res = await fetch("/api/overdue/supervisor-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          decision: overtimeDecision,
          supervisorName: supervisorName.trim() || undefined,
          supervisorEmail: supervisorEmail.trim() || undefined,
          supervisorRemarks: supervisorRemarks.trim(),
          hrEmail:
            hrEmail.trim() && hrEmail.trim() !== "hr@company.com"
              ? hrEmail.trim()
              : defaultHrEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to submit supervisor overdue form.");
        return;
      }

      const targetHrEmail =
        data.case?.hrEmail ||
        (hrEmail.trim() && hrEmail.trim() !== "hr@company.com"
          ? hrEmail.trim()
          : defaultHrEmail);

      if (data.emailResult?.simulated) {
        setActionError(
          `Supervisor decision saved (${overtimeDecision}), but the email to HR (${targetHrEmail}) was SIMULATED because no Sender SMTP Email is configured yet. Click "Configure Email (SMTP)" at the top right to enable live Gmail/SMTP delivery.`
        );
      } else if (data.emailResult && !data.emailResult.success) {
        setActionError(
          `Supervisor decision saved, but SMTP delivery to HR (${targetHrEmail}) failed: ${data.emailResult.error}`
        );
      } else {
        setActionMessage(
          overtimeDecision === "APPROVED"
            ? `✅ Supervisor APPROVED overdue phone (No need to serve Incident Report) and sent email to HR (${targetHrEmail})!`
            : `✅ Supervisor DISAPPROVED overdue phone (Incident Report is now OPEN for HR to print & serve) and sent email to HR (${targetHrEmail})!`
        );
      }
      clearUrlCaseParams();
      setSelectedCase(null);
      setModalMode(null);
      await fetchCases();
    } catch (err: any) {
      setActionError(err.message || "Failed to submit form.");
    } finally {
      setSubmittingAction(false);
      setTimeout(() => setActionMessage(null), 9000);
    }
  };

  const handleExecuteResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setActionError(null);

    try {
      setSubmittingAction(true);
      const res = await fetch("/api/overdue/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          resolutionType,
          resolutionNotes: resolutionNotes.trim() || `Resolved via ${resolutionType}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Failed to resolve case.");
        return;
      }

      setActionMessage(`Overdue case ${selectedCase.caseNumber} resolved via ${resolutionType}.`);
      clearUrlCaseParams();
      setSelectedCase(null);
      setModalMode(null);
      setResolutionNotes("");
      await fetchCases();
    } catch (err: any) {
      setActionError(`Action failed: ${err.message}`);
    } finally {
      setSubmittingAction(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  const handleHrRemoveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setActionError(null);

    const isSupervisorApproved = selectedCase.overtimeApprovalStatus === "APPROVED";
    if (hrAction === "CLOSE" && !isSupervisorApproved && !hrProofImage) {
      setActionError(
        "Because the Supervisor DISAPPROVED this overdue report, you must upload/present a picture proving that you served the Incident Report to the employee before closing."
      );
      return;
    }

    try {
      setSubmittingAction(true);
      const res = await fetch("/api/overdue/hr-remove-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: selectedCase.id,
          action: hrAction,
          proofImage: hrAction === "CLOSE" ? hrProofImage : null,
          hrOfficerName: hrOfficerName.trim() || "HR Department Admin",
          hrOfficerEmail: hrOfficerEmail.trim() || defaultHrEmail || "hr@company.com",
          hrRemarks:
            hrClearanceRemarks.trim() ||
            (hrAction === "OPEN"
              ? "Incident Report opened by HR Department."
              : "Incident Report served to employee and closed by HR."),
          alsoResolveCase: hrAction === "CLOSE" ? hrAlsoResolveCase : false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error || "Failed to update Incident Report status.");
        return;
      }

      setActionMessage(
        data.message ||
          `✅ Incident Report ${hrAction === "OPEN" ? "OPENED" : "CLOSED"} by HR Department for ${
            selectedCase.employee
              ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
              : selectedCase.caseNumber
          }.`
      );
      clearUrlCaseParams();
      setSelectedCase(null);
      setModalMode(null);
      await fetchCases();
    } catch (err: any) {
      setActionError(err.message || "Failed to update incident report.");
    } finally {
      setSubmittingAction(false);
      setTimeout(() => setActionMessage(null), 8000);
    }
  };

  const filteredCases = cases.filter((c) => {
    // Status filter
    if (statusFilter === "OPEN" && c.status === "RESOLVED") return false;
    if (statusFilter === "RESOLVED" && c.status !== "RESOLVED") return false;

    // KPI Category filter
    if (categoryFilter === "OVERDUE_REPORT") {
      if (c.status === "RESOLVED" || c.overtimeApprovalStatus === "APPROVED") return false;
    } else if (categoryFilter === "INCIDENT_OPEN") {
      if (!c.incidentReportIssued && c.incidentReportStatus !== "OPEN") return false;
    } else if (categoryFilter === "PENDING_SUPERVISOR") {
      if (c.overtimeApprovalStatus !== "PENDING") return false;
    } else if (categoryFilter === "APPROVED_NO_SERVE") {
      if (c.overtimeApprovalStatus !== "APPROVED") return false;
    } else if (categoryFilter === "INCIDENT_CLOSED_HR") {
      if (!c.incidentRemovedByHr && c.incidentReportStatus !== "CLOSED") return false;
    }

    const query = searchQuery.toLowerCase();
    const empName = c.employee
      ? `${c.employee.firstName} ${c.employee.lastName}`.toLowerCase()
      : "";
    const empCode = (c.employee?.employeeCode || "").toLowerCase();
    const deptName = (c.employee?.department?.name || "").toLowerCase();
    const tag = (
      c.phoneAsset?.assetTag ||
      c.custodyTransaction?.nfcCard?.cardNumber ||
      c.custodyTransaction?.nfcCard?.cardUid ||
      ""
    ).toLowerCase();
    const caseNum = c.caseNumber.toLowerCase();
    return (
      empName.includes(query) ||
      empCode.includes(query) ||
      deptName.includes(query) ||
      tag.includes(query) ||
      caseNum.includes(query)
    );
  });

  const getApprovalBadge = (c: OverdueCaseItem) => {
    if (c.overtimeApprovalStatus === "APPROVED") {
      return {
        label: "OVERTIME APPROVED",
        sub: c.hrEmailSentAt ? `Sent to HR (${c.hrEmail || "hr@company.com"})` : "Approved by Supervisor",
        className:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
      };
    }
    if (c.overtimeApprovalStatus === "NOT_APPROVED") {
      return {
        label: "NOT APPROVED",
        sub: c.hrEmailSentAt ? `Reported to HR (${c.hrEmail || "hr@company.com"})` : "Disapproved by Supervisor",
        className:
          "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800",
      };
    }
    return {
      label: "PENDING SUPERVISOR FORM",
      sub: `Awaiting ${c.supervisorEmail || "Department Supervisor"}`,
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800",
    };
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Overdue Reports — Supervisor Review &amp; HR Incident Report Management
            </h1>
            <span
              className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${
                summary.active > 0
                  ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              }`}
            >
              {summary.active} Active Overdue (&gt;24h)
            </span>
            {summary.incidentReportIssued > 0 && (
              <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-rose-600 text-white shadow-sm">
                🚨 {summary.incidentReportIssued} INCIDENT REPORT OPEN (Must Be Served)
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setActionError(null);
              setIsSmtpModalOpen(true);
            }}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-xl border shadow-sm transition-colors ${
              smtpConfigured
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                : "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>{smtpConfigured ? `SMTP Active (${smtpUser})` : "Configure Email (SMTP)"}</span>
          </button>

          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
            <span>{scanning ? "Checking >24h Checkouts..." : "Check 24-Hour Overdue Now"}</span>
          </button>
        </div>
      </div>

      {!smtpConfigured && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Sender Email (SMTP) Not Configured Yet:</span> Emails to Department Supervisors (e.g. <span className="font-mono">rvj1923@gmail.com</span>) and HR are currently running in <strong>Simulated Mode</strong> because no sender email account / Gmail App Password has been set.
            </div>
          </div>
          <button
            onClick={() => setIsSmtpModalOpen(true)}
            className="shrink-0 inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Set Up Sender Email Now</span>
          </button>
        </div>
      )}

      {actionMessage && (
        <div className="p-3.5 rounded-xl text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {actionError && !selectedCase && !isSmtpModalOpen && (
        <div className="p-3.5 rounded-xl text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Clickable KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setCategoryFilter((prev) => (prev === "OVERDUE_REPORT" ? "ALL" : "OVERDUE_REPORT"));
          }}
          className="text-left focus:outline-none group"
        >
          <Card
            className={`border-l-4 border-l-red-500 transition-all cursor-pointer h-full ${
              categoryFilter === "OVERDUE_REPORT"
                ? "ring-2 ring-red-500 bg-red-50/60 dark:bg-red-950/30 shadow-md"
                : "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                  Overdue Report
                </div>
                {categoryFilter === "OVERDUE_REPORT" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white uppercase">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 font-mono">
                {summary.active}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Unreturned past 24 hours
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setCategoryFilter((prev) => (prev === "INCIDENT_OPEN" ? "ALL" : "INCIDENT_OPEN"));
          }}
          className="text-left focus:outline-none group"
        >
          <Card
            className={`border-l-4 border-l-rose-600 transition-all cursor-pointer h-full ${
              categoryFilter === "INCIDENT_OPEN"
                ? "ring-2 ring-rose-600 bg-rose-50/60 dark:bg-rose-950/30 shadow-md"
                : "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                  Incident Report Open
                </div>
                {categoryFilter === "INCIDENT_OPEN" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white uppercase">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 font-mono">
                {summary.incidentReportIssued}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Must be printed &amp; served by HR
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setCategoryFilter((prev) =>
              prev === "PENDING_SUPERVISOR" ? "ALL" : "PENDING_SUPERVISOR"
            );
          }}
          className="text-left focus:outline-none group"
        >
          <Card
            className={`border-l-4 border-l-amber-500 transition-all cursor-pointer h-full ${
              categoryFilter === "PENDING_SUPERVISOR"
                ? "ring-2 ring-amber-500 bg-amber-50/60 dark:bg-amber-950/30 shadow-md"
                : "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                  Pending Supervisor Notice
                </div>
                {categoryFilter === "PENDING_SUPERVISOR" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white uppercase">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 font-mono">
                {summary.pendingSupervisorForm}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Awaiting supervisor explanation
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setCategoryFilter((prev) =>
              prev === "APPROVED_NO_SERVE" ? "ALL" : "APPROVED_NO_SERVE"
            );
          }}
          className="text-left focus:outline-none group"
        >
          <Card
            className={`border-l-4 border-l-emerald-500 transition-all cursor-pointer h-full ${
              categoryFilter === "APPROVED_NO_SERVE"
                ? "ring-2 ring-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 shadow-md"
                : "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                  Approved (No Need to Serve)
                </div>
                {categoryFilter === "APPROVED_NO_SERVE" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white uppercase">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                {summary.overtimeApproved}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Supervisor approved overdue phone
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter("ALL");
            setCategoryFilter((prev) =>
              prev === "INCIDENT_CLOSED_HR" ? "ALL" : "INCIDENT_CLOSED_HR"
            );
          }}
          className="text-left focus:outline-none group"
        >
          <Card
            className={`border-l-4 border-l-teal-500 transition-all cursor-pointer h-full ${
              categoryFilter === "INCIDENT_CLOSED_HR"
                ? "ring-2 ring-teal-500 bg-teal-50/60 dark:bg-teal-950/30 shadow-md"
                : "hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase">
                  Incident Report Closed (HR)
                </div>
                {categoryFilter === "INCIDENT_CLOSED_HR" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-600 text-white uppercase">
                    Selected
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-teal-600 dark:text-teal-400 mt-1 font-mono">
                {summary.incidentRemovedByHr}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Served with proof / closed by HR
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search employee, department, asset tag, case #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {categoryFilter !== "ALL" && (
            <button
              type="button"
              onClick={() => setCategoryFilter("ALL")}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
            >
              ✕ Clear Card Filter (Show All)
            </button>
          )}
          <div className="flex items-center space-x-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Status:</span>
            {["ALL", "OPEN", "RESOLVED"].map((st) => (
              <button
                key={st}
                onClick={() => {
                  setStatusFilter(st);
                  if (st !== "ALL") setCategoryFilter("ALL");
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  statusFilter === st && categoryFilter === "ALL"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {st === "OPEN" ? "ACTIVE (>24H)" : st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue Report Table */}
      {loading ? (
        <Card className="p-12 text-center text-xs text-slate-400">
          Loading 24-hour overdue phone reports...
        </Card>
      ) : filteredCases.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No Overdue Phones (>24 Hours)"
          description="All company-issued phones have been timed out or surrendered within 24 hours."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-4">Case #</th>
                  <th className="p-4">Employee &amp; Incident Report Status</th>
                  <th className="p-4">Company Phone</th>
                  <th className="p-4">Time In &amp; Duration (&gt;24h)</th>
                  <th className="p-4">Supervisor Notice</th>
                  <th className="p-4">Supervisor Explanation &amp; Decision</th>
                  <th className="p-4 text-right">Actions (Print, Supervisor &amp; HR Open/Close)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCases.map((c) => {
                  const approvalBadge = getApprovalBadge(c);
                  const assetLabel =
                    c.phoneAsset?.assetTag ||
                    c.custodyTransaction?.nfcCard?.cardNumber ||
                    c.custodyTransaction?.nfcCard?.cardUid ||
                    "Company Phone";
                  const deptName = c.employee?.department?.name || "Operations";
                  const supEmail =
                    c.supervisorEmail ||
                    c.employee?.department?.supervisorEmail ||
                    c.employee?.supervisor?.email ||
                    "supervisor@company.com";

                  return (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                      <td className="p-4">
                        <div className="font-mono font-bold text-red-600 dark:text-red-400">
                          {c.caseNumber}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {c.overtimeApprovalStatus === "APPROVED" ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                              AUTO-CLOSED (APPROVED)
                            </span>
                          ) : c.status === "RESOLVED" ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              RETURNED / CLOSED
                            </span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 font-semibold">
                              &gt;24H UNRETURNED
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {c.employee
                            ? `${c.employee.firstName} ${c.employee.lastName}`
                            : "Assigned Employee"}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-1.5 mt-0.5">
                          <span className="font-medium text-indigo-600 dark:text-indigo-400">
                            {deptName}
                          </span>
                          {c.employee?.employeeCode && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{c.employee.employeeCode}</span>
                            </>
                          )}
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {c.overtimeApprovalStatus === "APPROVED" && c.incidentReportStatus !== "OPEN" ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>CASE AUTO-CLOSED (Supervisor Approved — No Printing / Serving Needed)</span>
                            </span>
                          ) : c.incidentReportIssued || c.incidentReportStatus === "OPEN" ? (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border border-rose-300 dark:border-rose-800">
                              <ShieldAlert className="w-3 h-3 text-rose-600 shrink-0" />
                              <span>INCIDENT REPORT OPEN (Must Be Printed &amp; Served)</span>
                            </span>
                          ) : c.incidentRemovedByHr || c.incidentReportStatus === "CLOSED" ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/80 dark:text-teal-200 border border-teal-300 dark:border-teal-800">
                                <ShieldCheck className="w-3 h-3 text-teal-600 shrink-0" />
                                <span>INCIDENT REPORT CLOSED (Served by HR)</span>
                              </span>
                              {c.hrClearedBy && (
                                <div className="text-[10px] text-slate-400">
                                  Closed by {c.hrClearedBy}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              <span>AWAITING SUPERVISOR DECISION</span>
                            </span>
                          )}

                          {c.proofImageUrl && (
                            <div>
                              <button
                                type="button"
                                onClick={() => setViewingProofCase(c)}
                                className="inline-flex items-center space-x-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <Eye className="w-3 h-3" />
                                <span>View Proof of Service Photo</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {assetLabel}
                        </div>
                        {c.phoneAsset?.model && (
                          <div className="text-[10px] text-slate-400">
                            {c.phoneAsset.brand} {c.phoneAsset.model}
                          </div>
                        )}
                      </td>

                      <td className="p-4">
                        <div className="font-mono text-slate-700 dark:text-slate-300">
                          Timed In:{" "}
                          {new Date(c.custodyTransaction.timestamp).toLocaleString([], {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="text-[11px] font-semibold text-red-600 dark:text-red-400 mt-0.5">
                          {formatOverdueDuration(c.minutesOverdue, c.custodyTransaction.timestamp)}
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="flex items-center space-x-1.5 text-slate-700 dark:text-slate-300 font-medium">
                          <Mail className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="font-mono text-[11px]">{supEmail}</span>
                        </div>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-[10px] text-slate-400">
                            {c.supervisorNotifiedAt
                              ? `Notified ${new Date(c.supervisorNotifiedAt).toLocaleString([], {
                                  month: "short",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Supervisor notified"}
                          </span>
                          <button
                            type="button"
                            disabled={resendingCaseId === c.id}
                            onClick={() => handleResendSupervisorEmail(c)}
                            className="inline-flex items-center space-x-1 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                          >
                            <Send className="w-2.5 h-2.5" />
                            <span>
                              {resendingCaseId === c.id ? "Sending..." : "Resend Notice"}
                            </span>
                          </button>
                        </div>
                      </td>

                      <td className="p-4">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${approvalBadge.className}`}
                        >
                          {approvalBadge.label}
                        </span>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                          {approvalBadge.sub}
                        </div>
                        {c.supervisorRemarks && (
                          <div className="text-[11px] text-slate-700 dark:text-slate-200 font-medium italic mt-1 max-w-xs" title={c.supervisorRemarks}>
                            Reason: &ldquo;{c.supervisorRemarks}&rdquo;
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* Only show Print Report & HR Serve/Close buttons when NOT approved by Supervisor */}
                          {c.overtimeApprovalStatus !== "APPROVED" && (
                            <a
                              href={`/overdue/print-report?caseId=${encodeURIComponent(c.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Print Official Incident Report"
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Print Report</span>
                            </a>
                          )}

                          {/* Supervisor Review Form */}
                          <button
                            onClick={() => openSupervisorFormModal(c)}
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg shadow-sm transition-colors ${
                              c.overtimeApprovalStatus === "PENDING"
                                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                : "bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                            }`}
                          >
                            <FileCheck2 className="w-3.5 h-3.5" />
                            <span>
                              {c.overtimeApprovalStatus === "PENDING"
                                ? "Supervisor Review"
                                : "Edit Supervisor Review"}
                            </span>
                          </button>

                          {/* HR Department: Open / Close Incident Report (only needed when NOT approved by Supervisor) */}
                          {c.overtimeApprovalStatus !== "APPROVED" && (
                            <button
                              onClick={() => openHrRemoveIncidentModal(c)}
                              title="HR Dept: Open or Close Incident Report (Upload proof photo when closing a disapproved report)"
                              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg shadow-sm transition-colors ${
                                c.incidentReportIssued || c.incidentReportStatus === "OPEN"
                                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                                  : "bg-teal-600 hover:bg-teal-700 text-white"
                              }`}
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>
                                {c.incidentReportIssued || c.incidentReportStatus === "OPEN"
                                  ? "HR: Close / Serve Report"
                                  : "HR: Open / Close Report"}
                              </span>
                            </button>
                          )}

                          {c.status !== "RESOLVED" && c.overtimeApprovalStatus !== "APPROVED" && (
                            <button
                              onClick={() => {
                                setSelectedCase(c);
                                setModalMode("RESOLVE");
                                setResolutionNotes("");
                                setActionError(null);
                              }}
                              title="Mark Phone Returned"
                              className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            >
                              Mark Returned
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* MODAL 1: Department Supervisor Notice & Review Form -> Sends Email to HR Dept */}
      {selectedCase && modalMode === "SUPERVISOR_FORM" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-[600px] w-full overflow-hidden">
            {/* Deep Crimson Header Banner matching Screenshot */}
            <div
              className="px-6 py-6 text-center text-white relative"
              style={{
                background: "linear-gradient(180deg, #9f1239 0%, #be123c 55%, #dc2626 100%)",
              }}
            >
              <div className="inline-block bg-rose-50 text-rose-800 text-[11px] font-extrabold uppercase tracking-wider px-4 py-1 rounded-full mb-3 shadow-sm">
                ⚠️ SUPERVISOR ACTION MANDATORY
              </div>
              <h3 className="text-xl font-black uppercase tracking-wide text-white leading-tight">
                24-HOUR OVERDUE PHONE INCIDENT
              </h3>
              <div className="mt-1.5 text-xs text-rose-100 font-medium">
                SecurePass NEXUS &bull; Incident Escalation &bull; Ref:{" "}
                {selectedCase.caseNumber.startsWith("INC-")
                  ? selectedCase.caseNumber
                  : `INC-${selectedCase.caseNumber}`}
              </div>
            </div>

            <form onSubmit={handleSubmitSupervisorForm}>
              <div className="p-6 space-y-4 text-xs max-h-[72vh] overflow-y-auto bg-white text-slate-900">
                {actionError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{actionError}</span>
                  </div>
                )}

                {/* Gray Rounded Details Card */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4">
                  <table className="w-full text-[13px] border-collapse">
                    <tbody>
                      <tr>
                        <td className="py-1.5 text-slate-500 w-[38%]">Incident Ref:</td>
                        <td className="py-1.5 font-mono font-extrabold text-rose-600">
                          {selectedCase.caseNumber.startsWith("INC-")
                            ? selectedCase.caseNumber
                            : `INC-${selectedCase.caseNumber}`}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Employee Name:</td>
                        <td className="py-1.5 font-black text-[14.5px] text-slate-900 uppercase">
                          {selectedCase.employee
                            ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
                            : "Assigned Employee"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Employee Pass / ID:</td>
                        <td className="py-1.5 font-mono font-extrabold text-sky-600">
                          {selectedCase.employee?.employeeCode || "N/A"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Company Phone:</td>
                        <td className="py-1.5 font-extrabold text-slate-900">
                          {selectedCase.phoneAsset?.assetTag ||
                            selectedCase.custodyTransaction?.nfcCard?.cardNumber ||
                            selectedCase.custodyTransaction?.nfcCard?.cardUid ||
                            "Company Phone"}
                          {selectedCase.phoneAsset
                            ? ` (${selectedCase.phoneAsset.brand} ${selectedCase.phoneAsset.model})`
                            : ""}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Assigned Dept:</td>
                        <td className="py-1.5 font-extrabold text-slate-900">
                          {selectedCase.employee?.department?.name || "Operations"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Dept Supervisor:</td>
                        <td className="py-1.5 font-medium text-slate-600">
                          {supervisorName || "Department Supervisor"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Check-In / Time-In:</td>
                        <td className="py-1.5 font-extrabold text-amber-700">
                          {new Date(selectedCase.custodyTransaction.timestamp).toLocaleString()}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-slate-500">Time Overdue:</td>
                        <td className="py-1.5 font-extrabold text-[14px] text-rose-600">
                          {Math.max(24, Math.floor((selectedCase.minutesOverdue || 0) / 60) + 24)} Hours (Limit: 24h)
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* CHOOSE SUPERVISOR CLASSIFICATION */}
                <div className="text-center space-y-2.5 pt-1">
                  <div className="text-[12.5px] font-black uppercase tracking-wider text-slate-900">
                    CHOOSE SUPERVISOR CLASSIFICATION:
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setOvertimeDecision("APPROVED")}
                      className={`min-w-[155px] px-6 py-3 rounded-xl font-extrabold text-xs tracking-wide transition shadow-sm flex items-center justify-center space-x-2 ${
                        overtimeDecision === "APPROVED"
                          ? "bg-emerald-600 text-white ring-4 ring-emerald-600/25"
                          : "bg-emerald-600/80 hover:bg-emerald-600 text-white opacity-60 hover:opacity-100"
                      }`}
                    >
                      <span>&#10004;</span>
                      <span>EXCUSED</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOvertimeDecision("NOT_APPROVED")}
                      className={`min-w-[155px] px-6 py-3 rounded-xl font-extrabold text-xs tracking-wide transition shadow-sm flex items-center justify-center space-x-2 ${
                        overtimeDecision === "NOT_APPROVED"
                          ? "bg-rose-700 text-white ring-4 ring-rose-700/25"
                          : "bg-rose-700/80 hover:bg-rose-700 text-white opacity-60 hover:opacity-100"
                      }`}
                    >
                      <span>&#10006;</span>
                      <span>UNEXCUSED</span>
                    </button>
                  </div>

                  <div className="text-[11px] text-slate-500">
                    {overtimeDecision === "APPROVED" ? (
                      <span className="text-emerald-700 font-semibold">
                        EXCUSED (Approved) — Case will be automatically closed (No need for printing or serving of the report)
                      </span>
                    ) : (
                      <span className="text-rose-700 font-semibold">
                        UNEXCUSED (Disapproved) — HR must print &amp; serve Incident Report with photo proof
                      </span>
                    )}
                  </div>
                </div>

                {/* Supervisor Explanation */}
                <div
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 text-slate-900"
                  style={{ colorScheme: "light" }}
                >
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-900">
                      Why Was the Company Phone Overdue? (Supervisor Explanation){" "}
                      <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      rows={2}
                      required
                      value={supervisorRemarks}
                      onChange={(e) => setSupervisorRemarks(e.target.value)}
                      placeholder="Provide the reason why the company-issued phone was not returned within 24 hours..."
                      style={{ color: "#0f172a", backgroundColor: "#ffffff", colorScheme: "light" }}
                      className="w-full p-2.5 font-medium text-slate-900 placeholder:text-slate-400 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 [&:-webkit-autofill]:[-webkit-text-fill-color:#0f172a] [&:-webkit-autofill]:[box-shadow:0_0_0px_1000px_#ffffff_inset]"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-[10.5px] text-slate-500">
                  Pampanga&apos;s Best &bull; SecurePass NEXUS &bull; Incident Workflow
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearUrlCaseParams();
                      setSelectedCase(null);
                      setModalMode(null);
                      setActionError(null);
                    }}
                    disabled={submittingAction}
                    className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-200/70 hover:bg-slate-200 text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingAction}
                    className={`inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-extrabold rounded-xl text-white shadow-sm disabled:opacity-50 ${
                      overtimeDecision === "APPROVED"
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-rose-700 hover:bg-rose-800"
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {submittingAction
                        ? "Sending Report to HR..."
                        : `Confirm ${overtimeDecision === "APPROVED" ? "EXCUSED" : "UNEXCUSED"} & Send to HR`}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1B: HR Department — Print & Open / Close Incident Report (with Proof Photo if Disapproved) */}
      {selectedCase && modalMode === "HR_REMOVE_INCIDENT" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 bg-rose-50 dark:bg-rose-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-rose-600 text-white">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    HR Department — Open or Close Incident Report
                  </h3>
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium mt-0.5">
                    Overdue Case {selectedCase.caseNumber} • Print Report &amp; Manage Incident Status
                  </p>
                </div>
              </div>

              <a
                href={`/overdue/print-report?caseId=${encodeURIComponent(selectedCase.id)}&autoprint=1`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Incident Report</span>
              </a>
            </div>

            <form onSubmit={handleHrRemoveIncident}>
              <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
                {actionError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                {/* Employee & Supervisor Decision Summary */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Employee:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {selectedCase.employee
                        ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName} (${selectedCase.employee.employeeCode})`
                        : "Assigned Employee"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Department:</span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      {selectedCase.employee?.department?.name || "Operations"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Overdue Company Phone:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {selectedCase.phoneAsset?.assetTag ||
                        selectedCase.custodyTransaction?.nfcCard?.cardNumber ||
                        selectedCase.custodyTransaction?.nfcCard?.cardUid ||
                        "Company Phone"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Supervisor Decision:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        selectedCase.overtimeApprovalStatus === "APPROVED"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                          : selectedCase.overtimeApprovalStatus === "NOT_APPROVED"
                          ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      }`}
                    >
                      {selectedCase.overtimeApprovalStatus === "APPROVED"
                        ? "✅ APPROVED BY SUPERVISOR (No Need to Serve Report)"
                        : selectedCase.overtimeApprovalStatus === "NOT_APPROVED"
                        ? "❌ DISAPPROVED BY SUPERVISOR (Must Serve Report)"
                        : "⏳ PENDING SUPERVISOR"}
                    </span>
                  </div>
                  {selectedCase.supervisorRemarks && (
                    <div className="pt-1 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300">
                      <span className="text-slate-500 font-semibold">Supervisor Reason: </span>
                      <span className="italic">&ldquo;{selectedCase.supervisorRemarks}&rdquo;</span>
                    </div>
                  )}
                </div>

                {/* Action Selector: OPEN vs CLOSE Incident Report */}
                <div className="space-y-2">
                  <label className="block font-bold text-slate-800 dark:text-slate-200">
                    Select HR Incident Report Action <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setHrAction("CLOSE")}
                      className={`p-3 rounded-xl border text-left transition-all flex items-start space-x-2.5 ${
                        hrAction === "CLOSE"
                          ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/30"
                          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          hrAction === "CLOSE" ? "text-emerald-600" : "text-slate-400"
                        }`}
                      />
                      <div>
                        <div className="font-bold">CLOSE INCIDENT REPORT</div>
                        <div className="text-[10px] opacity-80 mt-0.5">
                          Mark the Incident Report as Served / Closed and clear the employee
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setHrAction("OPEN")}
                      className={`p-3 rounded-xl border text-left transition-all flex items-start space-x-2.5 ${
                        hrAction === "OPEN"
                          ? "border-rose-500 bg-rose-50/70 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 ring-2 ring-rose-500/30"
                          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <FolderOpen
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          hrAction === "OPEN" ? "text-rose-600" : "text-slate-400"
                        }`}
                      />
                      <div>
                        <div className="font-bold">OPEN INCIDENT REPORT</div>
                        <div className="text-[10px] opacity-80 mt-0.5">
                          Open / re-open the Incident Report so it remains active for serving
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Conditional Proof Photo Requirement when Closing */}
                {hrAction === "CLOSE" && (
                  <div>
                    {selectedCase.overtimeApprovalStatus === "APPROVED" ? (
                      <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-start space-x-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">
                            Supervisor Approved This Overdue Report — No Need to Serve Report
                          </div>
                          <div className="text-[11px] mt-0.5 opacity-90">
                            Because the Department Supervisor approved the overdue phone usage, HR does not need to serve the physical Incident Report or upload a proof picture.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-800 space-y-3">
                        <div className="flex items-start space-x-2">
                          <Camera className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold text-amber-950 dark:text-amber-200">
                              Proof Picture Required (Prove Incident Report Was Served){" "}
                              <span className="text-rose-600">*</span>
                            </div>
                            <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                              Because the Supervisor <strong>DISAPPROVED</strong> this overdue phone incident, you must upload or take a picture proving that HR served the printed Incident Report to the employee before closing.
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                          <label className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-bold cursor-pointer hover:bg-amber-100/60 transition shadow-sm">
                            <Upload className="w-4 h-4 text-amber-600" />
                            <span>
                              {uploadingProof
                                ? "Loading Picture..."
                                : hrProofImage
                                ? "Change Proof Picture"
                                : "Upload / Take Picture of Served Report"}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handleProofFileChange}
                              className="hidden"
                            />
                          </label>
                          {hrProofFileName && (
                            <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                              ✓ {hrProofFileName}
                            </span>
                          )}
                        </div>

                        {hrProofImage && (
                          <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="text-[10px] font-bold text-slate-500 mb-1">
                              Proof of Service Picture Preview:
                            </div>
                            <img
                              src={hrProofImage}
                              alt="Proof that Incident Report was served"
                              className="max-h-48 rounded-lg object-contain border border-slate-200 dark:border-slate-800"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      HR Officer / Admin Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={hrOfficerName}
                      onChange={(e) => setHrOfficerName(e.target.value)}
                      placeholder="e.g. HR Department Admin"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      HR Department Email <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={hrOfficerEmail}
                      onChange={(e) => setHrOfficerEmail(e.target.value)}
                      placeholder="hr@company.com"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-rose-500 font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    HR Remarks / Notes <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={hrClearanceRemarks}
                    onChange={(e) => setHrClearanceRemarks(e.target.value)}
                    placeholder="Enter HR notes regarding serving or closing this Incident Report..."
                    className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-rose-500"
                  />
                </div>

                {hrAction === "CLOSE" && (
                  <label className="flex items-start space-x-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hrAlsoResolveCase}
                      onChange={(e) => setHrAlsoResolveCase(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">
                        Also mark this overdue case ({selectedCase.caseNumber}) as Resolved
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Leave unchecked if you want to close the HR Incident Report while keeping the phone checkout tracked until physical surrender.
                      </div>
                    </div>
                  </label>
                )}
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    clearUrlCaseParams();
                    setSelectedCase(null);
                    setModalMode(null);
                    setActionError(null);
                  }}
                  disabled={submittingAction}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className={`inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold rounded-xl text-white shadow-sm disabled:opacity-50 ${
                    hrAction === "OPEN"
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {submittingAction
                      ? "Saving..."
                      : hrAction === "OPEN"
                      ? "Open Incident Report"
                      : "Close Incident Report"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Mark Returned / Close Overdue Case */}
      {selectedCase && modalMode === "RESOLVE" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Close Overdue Case: {selectedCase.caseNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Device:{" "}
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                  {selectedCase.phoneAsset?.assetTag || "Company Phone"}
                </span>{" "}
                • Holder:{" "}
                {selectedCase.employee
                  ? `${selectedCase.employee.firstName} ${selectedCase.employee.lastName}`
                  : "Assigned Employee"}
              </p>
            </div>

            <form onSubmit={handleExecuteResolve}>
              <div className="p-4 space-y-3 text-xs">
                {actionError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                    {actionError}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Resolution Classification:
                  </label>
                  <select
                    value={resolutionType}
                    onChange={(e) => setResolutionType(e.target.value as any)}
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500 font-semibold"
                  >
                    <option value="SURRENDERED">SURRENDERED (Physical return recorded)</option>
                    <option value="EXCUSED">EXCUSED (Authorized Exception)</option>
                    <option value="ESCALATED_HR">ESCALATED_HR (Forwarded to HR)</option>
                    <option value="REPORTED_LOST">REPORTED_LOST (Quarantine asset &amp; report)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Resolution Audit Notes:
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Enter notes detailing return or resolution..."
                    className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    clearUrlCaseParams();
                    setSelectedCase(null);
                    setModalMode(null);
                  }}
                  disabled={submittingAction}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                >
                  {submittingAction ? "Saving..." : "Confirm Resolution"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Configure Sender Email (SMTP) & Default HR Email */}
      {isSmtpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Configure Live Email Delivery (Gmail / SMTP)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Required to deliver real emails to Department Supervisors and the HR Department
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveSmtpConfig}>
              <div className="p-5 space-y-4 text-xs">
                {actionError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-[11px] text-indigo-900 dark:text-indigo-200 space-y-1">
                  <div className="font-bold">How to use Gmail to send real emails:</div>
                  <div>
                    1. Enter your sender Gmail address below (e.g. <span className="font-mono">yourname@gmail.com</span>).
                  </div>
                  <div>
                    2. In Google Account → Security → 2-Step Verification → <strong>App Passwords</strong>, generate a <strong>16-character App Password</strong> and paste it below.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      SMTP Server Host <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block font-semibold text-slate-700 dark:text-slate-300">
                      Port <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      placeholder="587"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Sender Email Address (SMTP Username) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="e.g. rvj1923@gmail.com"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    16-Character Gmail App Password / SMTP Password{" "}
                    {smtpHasPassword ? (
                      <span className="text-emerald-600 font-normal">(Saved — leave blank to keep current)</span>
                    ) : (
                      <span className="text-rose-500">*</span>
                    )}
                  </label>
                  <input
                    type="password"
                    required={!smtpHasPassword}
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                  />
                </div>

                <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Default HR Department Recipient Email <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={defaultHrEmail}
                    onChange={(e) => setDefaultHrEmail(e.target.value)}
                    placeholder="hr@company.com"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono"
                  />
                  <p className="text-[10px] text-slate-400">
                    When a supervisor submits the Overtime Usage Approval Form, the decision report is sent to this HR email address.
                  </p>
                </div>
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsSmtpModalOpen(false);
                    setActionError(null);
                  }}
                  disabled={savingSmtp}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSmtp}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{savingSmtp ? "Verifying & Sending Test Email..." : "Save & Send Test Email"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: View HR Proof of Service Picture */}
      {viewingProofCase && viewingProofCase.proofImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Proof of Service — Incident Report {viewingProofCase.caseNumber}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Employee:{" "}
                  {viewingProofCase.employee
                    ? `${viewingProofCase.employee.firstName} ${viewingProofCase.employee.lastName}`
                    : "Employee"}{" "}
                  • Closed by {viewingProofCase.hrClearedBy || "HR Department"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingProofCase(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="p-5 flex flex-col items-center space-y-3">
              <img
                src={viewingProofCase.proofImageUrl}
                alt="Served Incident Report Proof"
                className="max-h-[65vh] w-auto rounded-xl border border-slate-200 dark:border-slate-700 object-contain"
              />
              {viewingProofCase.hrClearanceRemarks && (
                <div className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-bold">HR Remarks: </span>
                  {viewingProofCase.hrClearanceRemarks}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverduePage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-xs text-slate-400">
          Loading 24-Hour Overdue Phone Report...
        </div>
      }
    >
      <OverdueMonitoringContent />
    </Suspense>
  );
}
