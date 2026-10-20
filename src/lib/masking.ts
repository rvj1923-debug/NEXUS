import { SessionUser } from "./auth";

/**
 * Mask IMEI numbers for unauthorized roles to maintain privacy and security.
 * Full IMEI is visible to SYSTEM_ADMIN and IT_SUPPORT.
 * For other roles, middle digits are obfuscated.
 */
export function maskImei(imei: string | null | undefined, user: SessionUser | null): string {
  if (!imei) return "—";
  if (!user) return "•••••••••••••••";

  // Full access for administrators and IT Support
  if (user.roleCode === "SYSTEM_ADMIN" || user.roleCode === "IT_SUPPORT") {
    return imei;
  }

  // Obfuscate for other roles: show first 4 and last 2 digits
  if (imei.length <= 6) {
    return "••••••";
  }

  const first = imei.slice(0, 4);
  const last = imei.slice(-2);
  const middle = "•".repeat(Math.max(imei.length - 6, 6));

  return `${first}${middle}${last}`;
}

/**
 * Mask phone numbers for restricted views
 */
export function maskPhoneNumber(phone: string | null | undefined, user: SessionUser | null): string {
  if (!phone) return "—";
  if (!user) return "••••••••";

  if (user.roleCode === "SYSTEM_ADMIN" || user.roleCode === "PHONE_CUSTODIAN" || user.roleCode === "IT_SUPPORT") {
    return phone;
  }

  if (phone.length <= 4) return "••••";
  const last = phone.slice(-4);
  return `••••-•••-${last}`;
}
