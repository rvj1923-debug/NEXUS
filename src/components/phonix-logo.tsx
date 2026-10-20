"use client";

import React from "react";

interface PhonixLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  iconOnly?: boolean;
  showTagline?: boolean;
  className?: string;
  iconClassName?: string;
}

const SIZE_MAP = {
  xs: { icon: 24, font: "text-sm", sub: "text-[9px]" },
  sm: { icon: 32, font: "text-base", sub: "text-[10px]" },
  md: { icon: 40, font: "text-lg", sub: "text-[11px]" },
  lg: { icon: 48, font: "text-xl", sub: "text-xs" },
  xl: { icon: 56, font: "text-2xl", sub: "text-xs" },
  "2xl": { icon: 72, font: "text-3xl", sub: "text-sm" },
};

/**
 * NEXUS Logo Emblem
 * Represents NFC-Enabled Exchange & Usage System:
 * - Central Smartphone hardware geometry
 * - Radiating NFC signal arcs
 * - Top rising beacon
 * - Central circulation exchange arrows (Inventory In/Out)
 */
export function PhonixEmblem({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 drop-shadow-md transition-transform duration-200 ${className}`}
    >
      <defs>
        {/* Main Phoenix Flame & Tech Gradient */}
        <linearGradient id="phonixBadgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F46E5" />   {/* Electric Indigo */}
          <stop offset="45%" stopColor="#7C3AED" />  {/* Royal Violet */}
          <stop offset="80%" stopColor="#D946EF" />  {/* Magenta Pulse */}
          <stop offset="100%" stopColor="#EA580C" /> {/* Phoenix Flame */}
        </linearGradient>

        {/* Outer Glow Gradient */}
        <linearGradient id="phonixGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0.8" />
        </linearGradient>

        {/* NFC Wing Arcs Gradient */}
        <linearGradient id="phonixWingGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="60%" stopColor="#F43F5E" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>

        {/* Screen Shimmer */}
        <linearGradient id="phonixScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1E1B4B" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0F172A" stopOpacity="0.95" />
        </linearGradient>

        {/* Exchange Flame Arrow Gradient */}
        <linearGradient id="exchangeGradA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
        <linearGradient id="exchangeGradB" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>

      {/* Rounded Squircle Shield Base */}
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="18"
        fill="url(#phonixBadgeGrad)"
      />
      <rect
        x="2.5"
        y="2.5"
        width="59"
        height="59"
        rx="17.5"
        stroke="url(#phonixGlowGrad)"
        strokeWidth="1.2"
        strokeOpacity="0.6"
      />

      {/* --- PHOENIX WINGS / NFC BROADCAST ARCS --- */}
      {/* Left Wing NFC Waves (Broadcasting Contactless Wave) */}
      <path
        d="M 17 40 C 11 36 8 28 10 20 C 11 16 13 13 17 11"
        stroke="url(#phonixWingGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeOpacity="0.95"
      />
      <path
        d="M 19 35 C 15 32 13 26 14 21 C 15 18 17 16 20 15"
        stroke="url(#phonixWingGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />

      {/* Right Wing NFC Waves */}
      <path
        d="M 47 40 C 53 36 56 28 54 20 C 53 16 51 13 47 11"
        stroke="url(#phonixWingGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeOpacity="0.95"
      />
      <path
        d="M 45 35 C 49 32 51 26 50 21 C 49 18 47 16 44 15"
        stroke="url(#phonixWingGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />

      {/* --- TOP PHOENIX CREST / FLAME PULSE --- */}
      <path
        d="M 32 6 C 30 10 29 12 32 14 C 35 12 34 10 32 6 Z"
        fill="#FDE047"
      />
      <circle cx="32" cy="7.5" r="1.5" fill="#FFFFFF" />

      {/* --- CENTRAL SMARTPHONE HARDWARE --- */}
      {/* Phone Outer Chassis */}
      <rect
        x="22"
        y="14"
        width="20"
        height="36"
        rx="4.5"
        fill="url(#phonixScreenGrad)"
        stroke="#FFFFFF"
        strokeWidth="1.8"
      />

      {/* Top Camera Dot & Sensor */}
      <circle cx="32" cy="17" r="1" fill="#94A3B8" />

      {/* Bottom Home Indicator */}
      <rect
        x="28.5"
        y="46.5"
        width="7"
        height="1.2"
        rx="0.6"
        fill="#94A3B8"
      />

      {/* --- INVENTORY EXCHANGE & TIME IN/OUT DYNAMICS (Phone Screen) --- */}
      {/* Up-Right Arrow (Time In / Check In) */}
      <path
        d="M 28 32 L 34 26 M 34 26 H 30 M 34 26 V 30"
        stroke="url(#exchangeGradA)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Down-Left Arrow (Time Out / Check Out) */}
      <path
        d="M 36 34 L 30 40 M 30 40 H 34 M 30 40 V 36"
        stroke="url(#exchangeGradB)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Central NFC Spark Core */}
      <circle cx="32" cy="33" r="1.8" fill="#FFFFFF" />
      <circle cx="32" cy="33" r="3" stroke="#FDE047" strokeWidth="0.8" strokeDasharray="1.5 1.5" />
    </svg>
  );
}

export function PhonixLogo({
  size = "md",
  iconOnly = false,
  showTagline = true,
  className = "",
  iconClassName = "",
}: PhonixLogoProps) {
  const currentSize = SIZE_MAP[size];

  return (
    <div className={`inline-flex items-center space-x-3 select-none ${className}`}>
      <PhonixEmblem size={currentSize.icon} className={iconClassName} />

      {!iconOnly && (
        <div className="flex flex-col justify-center leading-none">
          <div className="flex items-center space-x-1.5">
            <span
              className={`font-black tracking-tight text-slate-900 dark:text-white ${currentSize.font} font-sans`}
            >
              NEX
              <span className="bg-gradient-to-r from-violet-600 via-pink-500 to-amber-500 dark:from-violet-400 dark:via-pink-400 dark:to-amber-400 bg-clip-text text-transparent">
                US
              </span>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 tracking-wider">
              NFC
            </span>
          </div>

          {showTagline && (
            <span
              className={`font-medium text-slate-500 dark:text-slate-400 tracking-tight mt-1 line-clamp-1 ${currentSize.sub}`}
            >
              NFC-Enabled Exchange &amp; Usage System
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const NexusEmblem = PhonixEmblem;
export const NexusLogo = PhonixLogo;

export default PhonixLogo;
