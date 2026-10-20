"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { PhonixEmblem } from "@/components/phonix-logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explicitNext = searchParams.get("next");
  const nextPath = explicitNext && explicitNext.startsWith("/") ? explicitNext : "/dashboard";
  const isHrOverdueRedirect = nextPath.startsWith("/overdue");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Authentication failed. Please check your credentials.");
        setLoading(false);
        return;
      }

      const redirectTarget =
        data.user?.roleCode === "KIOSK"
          ? "/kiosk"
          : data.user?.roleCode === "HR_ADMIN"
          ? explicitNext && explicitNext.startsWith("/overdue")
            ? explicitNext
            : "/overdue"
          : explicitNext && explicitNext.startsWith("/")
          ? explicitNext
          : data.redirectTo || "/dashboard";
      router.push(redirectTarget);
      router.refresh();
    } catch {
      setError("Network error. Please ensure the backend server is reachable.");
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {isHrOverdueRedirect && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-700/80 text-rose-200 text-xs flex items-start space-x-2.5">
            <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              <strong>HR Department Login Required:</strong> Sign in with the <strong>HR Department</strong> account or System Admin to open <strong>Overdue Monitoring</strong>.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-xs font-semibold text-slate-300 mb-1.5"
          >
            Work Email Address
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Mail className="w-4 h-4" />
            </div>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="block w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-xs font-semibold text-slate-300 mb-1.5"
          >
            Password
          </label>
          <div className="relative rounded-xl shadow-sm">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="block w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-xl shadow-lg shadow-indigo-600/25 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying Session...
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4 mr-2" />
              Sign In to Enterprise Portal
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="flex justify-center">
          <PhonixEmblem size={68} className="hover:scale-105 transition-transform" />
        </div>
        <h2 className="mt-4 text-center text-3xl font-black text-white tracking-tight flex items-center justify-center space-x-2">
          <span>NEX</span>
          <span className="bg-gradient-to-r from-violet-400 via-pink-400 to-amber-400 bg-clip-text text-transparent">
            US
          </span>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
            NFC
          </span>
        </h2>
        <p className="mt-1.5 text-center text-xs font-medium text-slate-300 tracking-normal px-2">
          NFC-Enabled Exchange &amp; Usage System
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Loading authentication form...</div>}>
          <LoginForm />
        </Suspense>

        {/* Security Compliance Footnote */}
        <div className="mt-4 text-center text-[11px] text-slate-500 space-y-1">
          <div>Protected by bcrypt password hashing &amp; server-side HMAC-signed JWT cookies.</div>
          <div className="text-slate-400">All rights reserved 2026 @ PBI Dev Team</div>
        </div>
      </div>
    </div>
  );
}
