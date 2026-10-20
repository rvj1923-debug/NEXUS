import React from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, Shield } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ROLES, ROUTE_ACCESS_RULES } from "@/lib/rbac";

export default async function UnauthorizedPage(props: {
  searchParams: Promise<{ from?: string }>;
}) {
  const searchParams = await props.searchParams;
  const from = searchParams.from || "the requested resource";
  const user = await getSession();

  // Find required roles for this path
  const matchedRule = ROUTE_ACCESS_RULES.find((rule) =>
    from.startsWith(rule.pathPrefix)
  );

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-red-600/10 rounded-full blur-2xl pointer-events-none" />

        <div className="w-14 h-14 rounded-2xl bg-red-950/80 border border-red-800/80 text-red-400 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-7 h-7" />
        </div>

        <h1 className="text-xl font-bold text-white tracking-tight">
          403 — Access Boundary Restriction
        </h1>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          Your current session does not possess authorized clearance to access{" "}
          <code className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-[11px]">
            {from}
          </code>
          .
        </p>

        <div className="mt-6 p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Current User:</span>
            <span className="font-semibold text-slate-200">{user?.fullName || "Authenticated User"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Assigned Role:</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">
              {user ? ROLES[user.roleCode]?.name : "None"}
            </span>
          </div>
          {matchedRule && (
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-slate-400 block mb-1">Permitted Roles for this Area:</span>
              <div className="flex flex-wrap gap-1">
                {matchedRule.allowedRoles.map((r) => (
                  <span
                    key={r}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-950/60 text-indigo-300 border border-indigo-900/60"
                  >
                    {ROLES[r]?.name || r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link
            href="/dashboard"
            className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-600/20"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Return to Dashboard
          </Link>
        </div>

        <div className="mt-4 text-[11px] text-slate-500">
          This boundary check is enforced server-side via Next.js Middleware and RBAC security gates.
        </div>
      </div>
    </div>
  );
}
