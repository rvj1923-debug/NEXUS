import type { RoleCode } from "./rbac";

export const SESSION_COOKIE_NAME = "cpt_session";
export const KIOSK_DEVICE_COOKIE_NAME = "cpt_kiosk_device";
export const STRICT_SESSION_VERSION = "v2-strict-login";

export const SESSION_EXPIRATION = "8h"; // Enterprise working shift session duration for human accounts
export const KIOSK_SESSION_EXPIRATION = "30d"; // 30-day JWT lifetime for kiosk terminals, renewed after 1 day
export const STANDARD_COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds
export const KIOSK_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
export const KIOSK_DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds
export const KIOSK_RENEWAL_THRESHOLD_SECONDS = 24 * 60 * 60; // Renew when older than 1 day

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  roleCode: RoleCode;
  roleName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  permissions: string[];
}

/**
 * Edge-safe JWT secret key getter used across middleware, auth utilities, and route handlers.
 * In production, SESSION_SECRET must be explicitly configured with at least 32 characters.
 */
export function getJwtSecretKey(): Uint8Array {
  const secret = (process.env.SESSION_SECRET || "").trim();
  if (secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }

  if (process.env.NODE_ENV === "production") {
    const message =
      "[FATAL][session-config] SESSION_SECRET is missing or shorter than 32 characters in production. Refusing to start or serve requests.";
    console.error(message);
    throw new Error(message);
  }

  // Dev-only fallback when NODE_ENV !== "production"
  return new TextEncoder().encode("dev_only_local_jwt_signing_key_32_chars_min");
}

/**
 * Edge-safe Kiosk device secret getter.
 * In production, KIOSK_DEVICE_SECRET must be explicitly configured with at least 32 characters.
 * Never falls back to any default value in any environment.
 */
export function getKioskDeviceSecret(): string {
  const secret = (process.env.KIOSK_DEVICE_SECRET || "").trim();
  if (secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    const message =
      "[FATAL][session-config] KIOSK_DEVICE_SECRET is missing or shorter than 32 characters in production. Refusing to start or serve requests.";
    console.error(message);
    throw new Error(message);
  }

  return secret;
}

/**
 * Validates required cryptographic secrets in production at server startup.
 */
export function assertProductionSecretsConfigured(): void {
  if (process.env.NODE_ENV === "production") {
    getJwtSecretKey();
    getKioskDeviceSecret();
  }
}
