import React from "react";
import { LucideIcon, Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  actionHref?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionText,
  onAction,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
        {title}
      </h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1 mb-4">
        {description}
      </p>
      {actionText && (
        actionHref ? (
          <a
            href={actionHref}
            className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
          >
            {actionText}
          </a>
        ) : (
          <button
            onClick={onAction}
            className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
          >
            {actionText}
          </button>
        )
      )}
    </div>
  );
}
