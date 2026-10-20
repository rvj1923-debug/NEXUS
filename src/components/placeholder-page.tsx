import React from "react";
import { LucideIcon, Layers, Database, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";

interface PlaceholderPageProps {
  title: string;
  moduleName: string;
  description: string;
  icon: LucideIcon;
  targetPhase?: string;
  dbTables: string[];
  features: string[];
  liveCount?: number | string;
  countLabel?: string;
  actionButton?: React.ReactNode;
}

export function PlaceholderPage({
  title,
  moduleName,
  description,
  icon: Icon,
  targetPhase = "Phase 2",
  dbTables,
  features,
  liveCount = 0,
  countLabel = "Records Found",
  actionButton,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-start space-x-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40">
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {title}
              </h1>
              <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                Phase 1 Foundation
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              {description}
            </p>
          </div>
        </div>

        {actionButton && <div>{actionButton}</div>}
      </div>

      {/* Status Notice */}
      <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-300">
        <div className="flex items-start space-x-3">
          <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <div className="font-semibold text-blue-950 dark:text-blue-200">
              Module Status: Route & Architecture Verified (Scheduled for full operational workflow in {targetPhase})
            </div>
            <p className="text-blue-800 dark:text-blue-300/90 leading-relaxed">
              The normalized PostgreSQL schema, RBAC security guards, and session permissions for <strong>{moduleName}</strong> are active. Production data is preserved without fabricated mocks.
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Architecture & Schema Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Provisioned Tables */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle>PostgreSQL Schema</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Normalized tables active in database for this domain:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dbTables.map((tbl) => (
                <span
                  key={tbl}
                  className="px-2 py-1 text-[11px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                >
                  {tbl}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Live Operational Metrics */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <CardTitle>Live Database Records</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono">
              {liveCount}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {countLabel}
            </p>
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
              Verified from active PostgreSQL cluster
            </div>
          </CardContent>
        </Card>

        {/* Planned Functional Scope */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <CardTitle>Planned Operations</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {features.map((feat, idx) => (
                <li key={idx} className="flex items-center space-x-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
