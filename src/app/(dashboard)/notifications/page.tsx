"use client";

import React, { useState, useEffect } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Filter,
  Send,
  ExternalLink,
  AlertTriangle,
  ClockAlert,
  ShieldAlert,
  Info,
  Smartphone,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  isRead: boolean;
  readAt?: string | null;
  linkUrl?: string | null;
  createdAt: string;
  employee?: { firstName: string; lastName: string; employeeCode: string } | null;
  phoneAsset?: { assetTag: string; brand: string; model: string } | null;
  overdueCase?: { caseNumber: string; status: string; minutesOverdue: number } | null;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"ALL" | "UNREAD" | "CRITICAL">("ALL");
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications?limit=50");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendTestAlert = async () => {
    try {
      setSendingTest(true);
      setStatusMessage(null);
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "OPERATOR TEST: Overdue Escalation Channel",
          message: `Manual notification channel verification executed at ${new Date().toLocaleTimeString()}. SMTP and in-app feeds active.`,
        }),
      });
      if (res.ok) {
        setStatusMessage("Test alert dispatched! Email queued and feed updated.");
        await fetchNotifications();
      } else {
        setStatusMessage("Failed to send test alert.");
      }
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setSendingTest(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const filtered = notifications.filter((n) => {
    if (activeTab === "UNREAD") return !n.isRead;
    if (activeTab === "CRITICAL") return n.severity === "CRITICAL" || n.severity === "HIGH";
    return true;
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300";
      case "HIGH":
        return "bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-300";
      case "MEDIUM":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300";
      default:
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-300";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Notification & Alert Center
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Live Alert Feed
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time audit alerts, return deadline escalations, and custodian dispatch notifications
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleSendTestAlert}
            disabled={sendingTest}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sendingTest ? "Dispatching..." : "Send Test Alert"}</span>
          </button>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark All Read</span>
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 rounded-lg text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          {statusMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("ALL")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === "ALL"
              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setActiveTab("UNREAD")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1 ${
            activeTab === "UNREAD"
              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <span>Unread</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-red-600 text-white">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("CRITICAL")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === "CRITICAL"
              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          Critical / High
        </button>
      </div>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No Notifications Found"
          description="Your alert stream is completely caught up. All devices and custody deadlines are normal."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => (
            <Card
              key={n.id}
              className={`transition-all hover:border-slate-300 dark:hover:border-slate-700 ${
                !n.isRead
                  ? "border-l-4 border-l-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/10"
                  : ""
              }`}
            >
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${getSeverityBadge(
                          n.severity
                        )}`}
                      >
                        {n.severity}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {n.title}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        • {new Date(n.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300">{n.message}</p>

                    {/* Metadata tags */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-500">
                      {n.employee && (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>
                            {n.employee.firstName} {n.employee.lastName} ({n.employee.employeeCode})
                          </span>
                        </span>
                      )}
                      {n.phoneAsset && (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          <Smartphone className="w-3 h-3 text-slate-400" />
                          <span>
                            {n.phoneAsset.assetTag}
                          </span>
                        </span>
                      )}
                      {n.overdueCase && (
                        <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 font-mono">
                          Case {n.overdueCase.caseNumber} ({n.overdueCase.status})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 pt-2 sm:pt-0 self-end sm:self-start">
                    {n.linkUrl && (
                      <a
                        href={n.linkUrl}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 transition-colors"
                      >
                        <span>View</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!n.isRead && (
                      <button
                        onClick={() => handleMarkAsRead(n.id)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        <span>Acknowledge</span>
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
