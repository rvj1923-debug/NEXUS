"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Menu,
  Moon,
  Sun,
  Search,
  LogOut,
  Shield,
  Activity,
  CheckCircle2,
} from "lucide-react";
import { SessionUser } from "@/lib/auth";
import { ROLES } from "@/lib/rbac";
import { useTheme } from "./theme-provider";
import { NotificationBell } from "./notification-bell";
import { ChangePasswordModal } from "./users/change-password-modal";

interface HeaderProps {
  user: SessionUser | null;
  onOpenSidebar: () => void;
}

export function Header({ user, onOpenSidebar }: HeaderProps) {
  const router = useRouter();
  const { theme, toggleTheme, mounted } = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  const roleMeta = user ? ROLES[user.roleCode] : null;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors">
      {/* Left: Mobile hamburger & search */}
      <div className="flex items-center space-x-3 md:space-x-4">
        <button
          onClick={onOpenSidebar}
          aria-label="Open navigation menu"
          className="p-2 -ml-1 text-slate-500 rounded-lg lg:hidden hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Global Search Bar */}
        <div className="relative hidden md:block w-64 lg:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search phones, NFC UID, employees..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-100 dark:bg-slate-800/80 border border-transparent dark:border-slate-700/60 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-all text-slate-800 dark:text-slate-200"
          />
        </div>
      </div>

      {/* Right: System status, Theme toggle, User badge, Change Password, Logout */}
      <div className="flex items-center space-x-2 md:space-x-4">
        {/* System Status Indicator */}
        <div className="hidden sm:flex items-center space-x-2 px-2.5 py-1 text-xs rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="font-medium text-[11px]">System Online (PostgreSQL)</span>
        </div>

        {/* Notification Bell Dropdown */}
        <NotificationBell />

        {/* Dark/Light mode toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle color theme"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          {mounted ? (
            theme === "dark" ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            )
          ) : (
            <span className="w-4 h-4 inline-block" />
          )}
        </button>

        {/* User Identity Details */}
        {user && (
          <div className="flex items-center space-x-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="hidden md:flex flex-col items-end pr-1">
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-tight">
                  {user.fullName}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 mt-0.5">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors ${
                    user.roleCode === "SYSTEM_ADMIN"
                      ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800"
                      : user.roleCode === "HR_ADMIN"
                      ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                      : roleMeta?.badgeColor ||
                        "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                  }`}
                >
                  {roleMeta?.name || user.roleCode}
                </span>
                {user.departmentName && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    • {user.departmentName}
                  </span>
                )}
              </div>
            </div>

            {/* Change Password button */}
            <ChangePasswordModal
              targetUserId={user.userId}
              targetEmail={user.email}
              targetFullName={user.fullName}
              isSelf={true}
              buttonLabel="Password"
              compact={true}
            />

            {/* Logout button */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Sign out of session"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
