import React from "react";
import { Settings, Sliders, Shield, Save, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export const revalidate = 0;

export default async function SettingsPage() {
  const settings = await db.systemSetting.findMany({
    orderBy: { category: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              System Settings & Configuration
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              System Admin Only
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Operational thresholds, shift grace parameters, notification policies, and NFC hardware bindings
          </p>
        </div>
      </div>

      {settings.length === 0 ? (
        <EmptyState
          icon={Settings}
          title="No Settings Found"
          description="Default system settings have not been seeded."
        />
      ) : (
        <div className="space-y-4">
          {settings.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {s.settingKey}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-mono">
                      {s.category}
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                    {s.description || "System configuration parameter"}
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <input
                    type="text"
                    disabled
                    defaultValue={s.settingValue}
                    className="px-3 py-1.5 font-mono text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 w-48 sm:w-64"
                  />
                  <span className="text-[11px] text-slate-400">Phase 1 Locked</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
