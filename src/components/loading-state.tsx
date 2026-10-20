import React from "react";
import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Loading records from database..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center">
      <Loader2 className="w-8 h-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-3" />
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {message}
      </p>
    </div>
  );
}
