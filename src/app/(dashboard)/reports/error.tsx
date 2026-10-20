"use client";

import React, { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ReportsErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Reports page caught client-side error:", error);
  }, [error]);

  return (
    <div className="p-6 max-w-xl mx-auto mt-12">
      <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 shadow-sm">
        <CardContent className="p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Unable to Load Reports & Exports
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              {error?.message || "An unexpected error occurred while rendering the custody report ledger."}
            </p>
          </div>
          <div>
            <button
              onClick={() => reset()}
              className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Loading</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
