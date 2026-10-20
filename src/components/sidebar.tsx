"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Tablet,
  AlertTriangle,
  FileSpreadsheet,
  ScrollText,
  UserCog,
  Settings,
  Radio,
  Lock,
  Bell,
} from "lucide-react";
import { SessionUser } from "@/lib/auth";
import { canAccessPath } from "@/lib/rbac";
import { PhonixEmblem } from "./phonix-logo";

interface SidebarProps {
  user: SessionUser | null;
  isOpen?: boolean;
  onClose?: () => void;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isPlaceholder?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Assets & Identity",
    items: [
      { name: "Employees", href: "/employees", icon: Users },
      { name: "NFC Cards", href: "/nfc-cards", icon: CreditCard },
    ],
  },
  {
    title: "Custody Operations",
    items: [
      { name: "Live Time In / Out", href: "/custody/live-monitor", icon: Radio, badge: "Live" },
      { name: "NFC Kiosk", href: "/kiosk", icon: Tablet, badge: "Kiosk" },
    ],
  },
  {
    title: "Monitoring & Exceptions",
    items: [
      { name: "Overdue Monitoring", href: "/overdue", icon: AlertTriangle },
      { name: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "Governance & Audit",
    items: [
      { name: "Reports & Exports", href: "/reports", icon: FileSpreadsheet },
      { name: "Audit Logs", href: "/audit-logs", icon: ScrollText },
    ],
  },
  {
    title: "Administration",
    items: [
      { name: "Kiosk Management", href: "/admin/kiosks", icon: Tablet, badge: "Kiosk" },
      { name: "NFC Readers", href: "/readers", icon: Radio, badge: "USB" },
      { name: "User Management", href: "/users", icon: UserCog },
      { name: "System Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar({ user, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-200 dark:border-slate-800">
          <Link href="/dashboard" className="flex items-center space-x-3 group min-w-0">
            <PhonixEmblem size={38} className="group-hover:scale-105 transition-transform" />
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5">
                <span className="font-black text-slate-900 dark:text-white text-base leading-tight tracking-tight">
                  NEX<span className="bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 dark:from-violet-400 dark:via-pink-400 dark:to-amber-400 bg-clip-text text-transparent">US</span>
                </span>
                <span className="text-[9px] font-mono px-1 rounded font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  NFC
                </span>
              </div>
              <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate tracking-tight">
                NFC-Enabled Exchange &amp; Usage System
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <h3 className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {section.title}
              </h3>

              <div className="space-y-0.5 pt-1">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
                  const isPermitted = canAccessPath(user, item.href);
                  const Icon = item.icon;

                  if (!isPermitted) {
                    return (
                      <div
                        key={item.href}
                        title={`Restricted: Requires higher role permissions`}
                        className="flex items-center justify-between px-3 py-2 text-xs rounded-lg text-slate-300 dark:text-slate-600 cursor-not-allowed select-none"
                      >
                        <div className="flex items-center space-x-3">
                          <Icon className="w-4 h-4 opacity-40" />
                          <span>{item.name}</span>
                        </div>
                        <Lock className="w-3 h-3 opacity-60" />
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 shadow-sm"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <Icon
                          className={`w-4 h-4 ${
                            isActive
                              ? "text-indigo-600 dark:text-indigo-400"
                              : "text-slate-400 dark:text-slate-500"
                          }`}
                        />
                        <span>{item.name}</span>
                      </div>

                      {item.badge && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>


      </aside>
    </>
  );
}
