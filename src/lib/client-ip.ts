import { NextRequest } from "next/server";

/**
 * Extract the client IP address safely.
 * Only uses X-Forwarded-For when env TRUST_PROXY=true, taking the right-most
 * entry added by the trusted reverse proxy. Otherwise returns "direct".
 */
export function getClientIp(req: NextRequest | Request): string {
  const trustProxy = (process.env.TRUST_PROXY || "").trim().toLowerCase() === "true";
  if (!trustProxy) {
    return "direct";
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return "direct";
  }

  const entries = forwardedFor
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return "direct";
  }

  return entries[entries.length - 1];
}
