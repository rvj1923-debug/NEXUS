import React from "react";
import Link from "next/link";
import {
  Smartphone,
  CheckCircle2,
  ClockAlert,
  ArrowUpRight,
  ArrowDownLeft,
  Tablet,
  Building2,
  AlertTriangle,
  Radio,
  PlusCircle,
  FileText,
  Activity,
  Calendar,
} from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";
export const revalidate = 0; // Fresh metrics

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (session.roleCode === "KIOSK") {
    redirect("/kiosk");
  }

  // Compute live start of today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 24-hour cutoff for overdue without timing out
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Live Database Queries
  const [
    accountsWithNfc,
    timedInPhones,
    returnedToday,
    overdueCount,
    recentIssuances,
    recentSurrenders,
    overdueTransactions,
    departments,
  ] = await Promise.all([
    // Total accounts registered with NFC tag
    db.employee.count({
      where: {
        isActive: true,
        nfcCards: { some: { status: "ACTIVE" } },
      },
    }),
    // Currently issued phones = the ones who are timed in
    db.custodyTransaction.count({
      where: {
        transactionType: { in: ["TIME_IN", "ISSUANCE"] },
        actualReturnAt: null,
        status: { in: ["ISSUED", "OVERDUE"] },
      },
    }),
    // Returned phones = the ones who are timed out
    db.custodyTransaction.count({
      where: {
        transactionType: { in: ["TIME_OUT", "SURRENDER"] },
        timestamp: { gte: todayStart },
      },
    }),
    // Overdue phones = not returned or did not timed out after 24 hrs of timing in
    db.custodyTransaction.count({
      where: {
        transactionType: { in: ["TIME_IN", "ISSUANCE"] },
        actualReturnAt: null,
        status: { in: ["ISSUED", "OVERDUE"] },
        timestamp: { lt: twentyFourHoursAgo },
      },
    }),
    // Recent Time-In / Issuance Activity
    db.custodyTransaction.findMany({
      where: { transactionType: { in: ["ISSUANCE", "TIME_IN"] } },
      orderBy: { timestamp: "desc" },
      take: 5,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        phoneAsset: { select: { assetTag: true, model: true } },
        nfcCard: { select: { cardUid: true, cardNumber: true } },
        nfcReader: { select: { name: true, location: true } },
      },
    }),
    // Recent Time-Out / Surrender Activity
    db.custodyTransaction.findMany({
      where: { transactionType: { in: ["SURRENDER", "TIME_OUT"] } },
      orderBy: { timestamp: "desc" },
      take: 5,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        phoneAsset: { select: { assetTag: true, model: true } },
        nfcCard: { select: { cardUid: true, cardNumber: true } },
        nfcReader: { select: { name: true, location: true } },
      },
    }),
    // Overdue Transactions (>24 hours without timing out)
    db.custodyTransaction.findMany({
      where: {
        transactionType: { in: ["TIME_IN", "ISSUANCE"] },
        actualReturnAt: null,
        status: { in: ["ISSUED", "OVERDUE"] },
        timestamp: { lt: twentyFourHoursAgo },
      },
      orderBy: { timestamp: "asc" },
      take: 5,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true, department: true } },
        phoneAsset: { select: { assetTag: true, model: true, imei: true } },
        nfcCard: { select: { cardUid: true, cardNumber: true } },
      },
    }),
    db.department.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { employees: true, phoneAssets: true },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Operational metrics cards
  const METRIC_CARDS = [
    {
      title: "Total Registered Phones",
      value: accountsWithNfc,
      label: "Accounts with NFC tag",
      icon: Smartphone,
      color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900/60",
    },
    {
      title: "Currently Issued Phones",
      value: timedInPhones,
      label: "Currently timed in",
      icon: ArrowUpRight,
      color: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-900/60",
    },
    {
      title: "Returned Phones",
      value: returnedToday,
      label: "Timed out today",
      icon: ArrowDownLeft,
      color: "text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-900/60",
    },
    {
      title: "Overdue Phones",
      value: overdueCount,
      label: ">24h since time in",
      icon: ClockAlert,
      color: overdueCount > 0
        ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900/60"
        : "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Title & Operational Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <span>Asset Custody Operations</span>
            <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              Live
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time custody tracking and shift compliance monitoring
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/custody/live-monitor"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Live Time In / Out</span>
          </Link>
          <Link
            href="/kiosk"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span>Launch NFC Kiosk</span>
          </Link>
          <Link
            href="/custody/operations"
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Desk Custody Action</span>
          </Link>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {METRIC_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="hover:border-slate-300 dark:hover:border-slate-700 transition-all">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate pr-2">
                    {card.title}
                  </span>
                  <div className={`p-1.5 rounded-lg border ${card.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono tracking-tight">
                  {card.value}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  {card.label}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Two Column Layout for Activity Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Live Issuance Activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <ArrowUpRight className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Live Issuance Activity</CardTitle>
                <CardDescription>Most recent device check-outs to employees</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentIssuances.length === 0 ? (
              <EmptyState
                icon={ArrowUpRight}
                title="No Issuance Records"
                description="No phones have been checked out yet. Issuance records will appear here live when scanned at NFC readers."
                actionText="Issue a Phone"
                actionHref="/custody/operations"
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentIssuances.map((tx) => (
                  <div key={tx.id} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tx.employee ? (
                          <>
                            {tx.employee.firstName} {tx.employee.lastName}
                            <span className="font-mono text-slate-400 font-normal ml-1.5">
                              ({tx.employee.employeeCode})
                            </span>
                          </>
                        ) : (
                          <span>{tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center space-x-2">
                        <span>Device: <strong className="text-slate-700 dark:text-slate-300">{tx.phoneAsset?.assetTag || tx.nfcCard?.cardNumber || tx.nfcCard?.cardUid || "Company Phone"}</strong></span>
                        <span>•</span>
                        <span>Via: {tx.nfcReader?.name || "NFC Reader"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                        {tx.transactionType === "TIME_IN" ? "Timed In" : "Issued"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Panel 2: Latest Surrender Transactions */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Latest Surrender Transactions</CardTitle>
                <CardDescription>Recently returned phones verified by reader</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentSurrenders.length === 0 ? (
              <EmptyState
                icon={ArrowDownLeft}
                title="No Surrender Records Today"
                description="No phones have been surrendered yet today. Completed returns will populate here immediately."
                actionText="Surrender a Phone"
                actionHref="/custody/operations"
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentSurrenders.map((tx) => (
                  <div key={tx.id} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {tx.employee ? (
                          <>
                            {tx.employee.firstName} {tx.employee.lastName}
                            <span className="font-mono text-slate-400 font-normal ml-1.5">
                              ({tx.employee.employeeCode})
                            </span>
                          </>
                        ) : (
                          <span>{tx.nfcCard?.cardNumber || `Phone [${tx.nfcCard?.cardUid || "NFC"}]`}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Device: <strong className="text-slate-700 dark:text-slate-300">{tx.phoneAsset?.assetTag || tx.nfcCard?.cardNumber || tx.nfcCard?.cardUid || "Company Phone"}</strong></span>
                        <span className="mx-1.5">•</span>
                        <span>Status: Timed Out</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300">
                        {tx.transactionType === "TIME_OUT" ? "Timed Out" : "Returned"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overdue Monitoring Panel (>24h Active Time In) */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
              <ClockAlert className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Overdue Phones (&gt;24 Hours)</CardTitle>
              <CardDescription>Accounts not timed out or returned after 24 hours of timing in</CardDescription>
            </div>
          </div>
          <Link
            href="/overdue"
            className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium"
          >
            Manage Overdue
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {overdueTransactions.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Zero Overdue Exceptions"
              description="No phones or accounts have exceeded 24 hours without timing out."
            />
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {overdueTransactions.map((tx) => (
                <div key={tx.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {tx.employee ? `${tx.employee.firstName} ${tx.employee.lastName}` : "Unknown Employee"}
                      {tx.employee?.employeeCode && (
                        <span className="font-mono text-slate-400 font-normal ml-1.5">
                          ({tx.employee.employeeCode})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {tx.phoneAsset?.assetTag ? `Phone: ${tx.phoneAsset.assetTag} • ` : tx.nfcCard?.cardNumber ? `Tag: ${tx.nfcCard.cardNumber} • ` : ""}
                      Timed In: {new Date(tx.timestamp).toLocaleString()} ({Math.floor((Date.now() - new Date(tx.timestamp).getTime()) / (1000 * 60 * 60))}h ago)
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    &gt;24H OVERDUE
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Department Summary & Custody Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 4: Department Summary */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-slate-500" />
              <CardTitle>Department Personnel Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {departments.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No Departments"
                description="Department hierarchy not configured."
              />
            ) : (
              departments.map((dept) => (
                <div
                  key={dept.id}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {dept.name}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Code: <span className="font-mono">{dept.code}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {dept._count.employees}
                    </span>
                    <span className="text-[10px] text-slate-400 block">Personnel</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Panel: Custody Compliance */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <CardTitle>Custody Compliance</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-500 dark:text-slate-400">On-Time Return Rate</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">100%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: "100%" }}></div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-500 dark:text-slate-400">Active Time-In Rate</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  {accountsWithNfc > 0 ? `${Math.round((timedInPhones / accountsWithNfc) * 100)}%` : "0%"}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${accountsWithNfc > 0 ? Math.min(100, (timedInPhones / accountsWithNfc) * 100) : 0}%` }}
                ></div>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-slate-500 leading-relaxed">
              Real-time analytics engine automatically evaluates shift deadlines, employee grace periods, and physical audit reconcile status.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
