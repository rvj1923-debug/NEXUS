"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldAlert, RefreshCw, Loader2, Lock } from "lucide-react";
import { PhonixEmblem } from "@/components/phonix-logo";

function NotProvisionedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") || "connecting";

  const isUnavailable = reason === "unavailable";
  const retryIntervalSeconds = isUnavailable ? 5 : 2;

  const [secondsLeft, setSecondsLeft] = useState<number>(retryIntervalSeconds);

  useEffect(() => {
    if (!isUnavailable) {
      window.location.replace("/api/kiosk/device-login");
      return;
    }
    setSecondsLeft(retryIntervalSeconds);
  }, [isUnavailable, retryIntervalSeconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.location.replace("/api/kiosk/device-login");
          return retryIntervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [retryIntervalSeconds]);

  const handleRetryNow = () => {
    window.location.replace("/api/kiosk/device-login");
  };

  const title = "Starting up / connecting kiosk…";
  const description = isUnavailable
    ? "The database or backend service is starting up. This kiosk will automatically connect as soon as the service is ready."
    : "Launching Kiosk Terminal session automatically…";

  return (
    <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
      <div className="flex justify-center">
        <PhonixEmblem size={56} />
      </div>

      <div className="w-16 h-16 rounded-full border-2 flex items-center justify-center mx-auto bg-blue-950/60 border-blue-500/80 text-blue-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-black tracking-tight text-white uppercase">
          {title}
        </h1>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>

      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 flex items-center justify-between">
        <span>Connecting in</span>
        <span className="font-bold text-amber-400">{secondsLeft}s</span>
      </div>

      <button
        onClick={handleRetryNow}
        className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Open Kiosk Now</span>
      </button>
    </div>
  );
}

export default function KioskNotProvisionedPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center text-xs text-slate-400">
            Checking kiosk status…
          </div>
        }
      >
        <NotProvisionedContent />
      </Suspense>
    </div>
  );
}
