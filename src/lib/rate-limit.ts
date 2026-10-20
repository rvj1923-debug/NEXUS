interface RateLimitRecord {
  attempts: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes per account
const MAX_ATTEMPTS = 5;

const GLOBAL_WINDOW_MS = 60 * 1000; // 1 minute rolling window across all accounts
const GLOBAL_MAX_FAILURES = 30; // More than 30 failed logins/min triggers global lockout
const GLOBAL_LOCKOUT_MS = 60 * 1000; // Reject all password attempts for 60 seconds

let globalFailureTimestamps: number[] = [];
let globalLockoutUntil = 0;

function normalizeKey(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function pruneGlobalFailures(now: number) {
  const cutoff = now - GLOBAL_WINDOW_MS;
  if (globalFailureTimestamps.length > 0 && globalFailureTimestamps[0] <= cutoff) {
    globalFailureTimestamps = globalFailureTimestamps.filter((ts) => ts > cutoff);
  }
}

/**
 * Clean up expired rate limit entries
 */
function cleanupStore() {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetAt) {
      memoryStore.delete(key);
    }
  }
  pruneGlobalFailures(now);
}

// Cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupStore, 5 * 60 * 1000);
}

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  resetSeconds: number;
  reason?: "account" | "global";
}

export function checkLoginRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  pruneGlobalFailures(now);

  if (now < globalLockoutUntil) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetSeconds: Math.max(1, Math.ceil((globalLockoutUntil - now) / 1000)),
      reason: "global",
    };
  }

  const key = normalizeKey(identifier);
  const record = memoryStore.get(key);

  if (!record || now > record.resetAt) {
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS,
      resetSeconds: Math.ceil(WINDOW_MS / 1000),
    };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
      reason: "account",
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - record.attempts,
    resetSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
  };
}

export function recordFailedLoginAttempt(identifier: string): RateLimitResult {
  const now = Date.now();

  // 1. Update global failure window (>30 failed logins/min -> 60s lockout across all accounts)
  pruneGlobalFailures(now);
  globalFailureTimestamps.push(now);
  if (globalFailureTimestamps.length >= GLOBAL_MAX_FAILURES) {
    globalLockoutUntil = Math.max(globalLockoutUntil, now + GLOBAL_LOCKOUT_MS);
  }

  // 2. Update per-account failure window (5 failures -> 15-minute lockout for this email)
  const key = normalizeKey(identifier);
  const record = memoryStore.get(key);

  if (!record || now > record.resetAt) {
    memoryStore.set(key, {
      attempts: 1,
      resetAt: now + WINDOW_MS,
    });
    const globalLocked = now < globalLockoutUntil;
    return {
      allowed: !globalLocked,
      remainingAttempts: globalLocked ? 0 : MAX_ATTEMPTS - 1,
      resetSeconds: globalLocked
        ? Math.max(1, Math.ceil((globalLockoutUntil - now) / 1000))
        : Math.ceil(WINDOW_MS / 1000),
      reason: globalLocked ? "global" : undefined,
    };
  }

  record.attempts += 1;
  const globalLocked = now < globalLockoutUntil;
  const isAllowed = !globalLocked && record.attempts < MAX_ATTEMPTS;

  return {
    allowed: isAllowed,
    remainingAttempts: globalLocked ? 0 : Math.max(0, MAX_ATTEMPTS - record.attempts),
    resetSeconds: globalLocked
      ? Math.max(1, Math.ceil((globalLockoutUntil - now) / 1000))
      : Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
    reason: globalLocked ? "global" : record.attempts >= MAX_ATTEMPTS ? "account" : undefined,
  };
}

export function resetLoginRateLimit(identifier: string): void {
  memoryStore.delete(normalizeKey(identifier));
}
