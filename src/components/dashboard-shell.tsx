"use client";

import React, { useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SessionUser } from "@/lib/auth";

interface DashboardShellProps {
  user: SessionUser | null;
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Left Navigation Sidebar */}
      <Sidebar
        user={user}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 lg:pl-72">
        <Header
          user={user}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <span className="font-bold text-slate-800 dark:text-slate-200">NEXUS</span> • NFC-Enabled Exchange &amp; Usage System
          </div>
          <div className="flex items-center space-x-4">
            <span>PostgreSQL Connection: Active</span>
            <span>All rights reserved 2026 @ PBI Dev Team</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
