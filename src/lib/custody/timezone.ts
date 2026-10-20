/**
 * Timezone & Shift Schedule Deadline Engine
 * Default company timezone: Asia/Manila (overridable via APP_TIMEZONE)
 */

export const COMPANY_TIMEZONE =
  (typeof process !== "undefined" &&
    (process.env.APP_TIMEZONE || process.env.NEXT_PUBLIC_APP_TIMEZONE)?.trim()) ||
  "Asia/Manila";

/**
 * Formats a Date into standard readable string in the configured company timezone
 */
export function formatManilaDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatManilaTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatManilaDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function getManilaDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COMPANY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Computes the return deadline for a phone issuance.
 * Standard Policy: 24 hours from Time In / Issuance (+ optional overtime extension).
 */
export function computeReturnDeadline(
  _shift?: {
    startTime?: string;
    endTime?: string;
    gracePeriodMinutes?: number;
  } | null,
  referenceDate = new Date(),
  overtimeMinutes = 0
): Date {
  return new Date(referenceDate.getTime() + (24 * 60 + (overtimeMinutes || 0)) * 60 * 1000);
}

/**
 * Evaluates whether a return is on-time or late relative to returnDeadlineAt
 */
export function evaluateReturnPunctuality(
  actualReturnAt: Date,
  returnDeadlineAt: Date | null
): {
  isLate: boolean;
  returnStatus: "ON_TIME" | "LATE";
  overdueMinutes: number;
  custodyDurationMinutes: number;
} {
  const isLate = returnDeadlineAt ? actualReturnAt.getTime() > returnDeadlineAt.getTime() : false;
  const overdueMinutes =
    isLate && returnDeadlineAt
      ? Math.max(0, Math.floor((actualReturnAt.getTime() - returnDeadlineAt.getTime()) / (60 * 1000)))
      : 0;

  return {
    isLate,
    returnStatus: isLate ? "LATE" : "ON_TIME",
    overdueMinutes,
    custodyDurationMinutes: 0,
  };
}

/**
 * Returns UTC Date range [startOfDay, endOfDay] for a given date in Asia/Manila
 */
export function getManilaDayRange(dateString?: string): { start: Date; end: Date; dateStr: string } {
  const dateStr = dateString || getManilaDateString();
  const start = new Date(`${dateStr}T00:00:00+08:00`);
  const end = new Date(`${dateStr}T23:59:59.999+08:00`);
  return { start, end, dateStr };
}

/**
 * Date ranges for reports
 */
export function getReportDateRange(filter: "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "QUARTER" | "CUSTOM", customStart?: string, customEnd?: string) {
  const now = new Date();
  const todayStr = getManilaDateString(now);

  if (filter === "TODAY") {
    return getManilaDayRange(todayStr);
  }

  if (filter === "YESTERDAY") {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = getManilaDateString(yesterday);
    return getManilaDayRange(yesterdayStr);
  }

  if (filter === "WEEK") {
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startStr = getManilaDateString(startOfWeek);
    return {
      start: new Date(`${startStr}T00:00:00+08:00`),
      end: new Date(`${todayStr}T23:59:59.999+08:00`),
      dateStr: `${startStr} to ${todayStr}`,
    };
  }

  if (filter === "MONTH") {
    const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startStr = getManilaDateString(startOfMonth);
    return {
      start: new Date(`${startStr}T00:00:00+08:00`),
      end: new Date(`${todayStr}T23:59:59.999+08:00`),
      dateStr: `${startStr} to ${todayStr}`,
    };
  }

  if (filter === "QUARTER") {
    const startOfQuarter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const startStr = getManilaDateString(startOfQuarter);
    return {
      start: new Date(`${startStr}T00:00:00+08:00`),
      end: new Date(`${todayStr}T23:59:59.999+08:00`),
      dateStr: `${startStr} to ${todayStr}`,
    };
  }

  // CUSTOM
  const startStr = customStart || todayStr;
  const endStr = customEnd || todayStr;
  return {
    start: new Date(`${startStr}T00:00:00+08:00`),
    end: new Date(`${endStr}T23:59:59.999+08:00`),
    dateStr: `${startStr} to ${endStr}`,
  };
}
