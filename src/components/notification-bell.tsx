"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Bell, Check, ExternalLink, ShieldAlert, AlertTriangle, Info } from "lucide-react";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: string;
  severity: string;
  isRead: boolean;
  linkUrl?: string | null;
  createdAt: string;
  employee?: { firstName: string; lastName: string };
  phoneAsset?: { assetTag: string };
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications?limit=8");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Ignore transient network errors during background polling
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000); // Polling every 15s
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Ignore transient network errors
    }
  };

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
    } catch {
      // Ignore transient network errors
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300";
      case "HIGH":
        return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border-orange-300";
      case "MEDIUM":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300";
      default:
        return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300";
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Open notifications"
        className="relative p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-600 rounded-full animate-pulse shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300 font-semibold">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center space-x-1"
              >
                <Check className="w-3 h-3" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No recent notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-3 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                    !n.isRead ? "bg-indigo-50/30 dark:bg-indigo-950/20" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-1.5 mb-1">
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${getSeverityBadge(
                            n.severity
                          )}`}
                        >
                          {n.severity}
                        </span>
                        <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 truncate">
                          {n.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                        {n.message}
                      </p>
                      <div className="flex items-center space-x-2 mt-1.5 text-[10px] text-slate-400">
                        <span>{new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {n.linkUrl && (
                          <Link
                            href={n.linkUrl}
                            onClick={() => {
                              handleMarkAsRead(n.id);
                              setIsOpen(false);
                            }}
                            className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center space-x-0.5"
                          >
                            <span>View</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </Link>
                        )}
                      </div>
                    </div>
                    {!n.isRead && (
                      <button
                        onClick={() => handleMarkAsRead(n.id)}
                        title="Mark as read"
                        className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850/60 text-center">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center space-x-1"
            >
              <span>View All In Notification Center</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
