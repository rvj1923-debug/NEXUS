/**
 * Deployment role of this installation (CPT_ROLE in .env):
 * - ALL    (default): web server, database and NFC reader agent on the same kiosk PC.
 * - SERVER : central server (e.g. Azure VM). NFC reader agents run on each kiosk PC,
 *            so the server must not probe its own 127.0.0.1:8002.
 * - KIOSK  : kiosk PC that only runs the NFC reader agent and Edge (no web server here).
 */
export type DeploymentRole = "ALL" | "SERVER" | "KIOSK";

export function getDeploymentRole(): DeploymentRole {
  const raw = (process.env.CPT_ROLE || "").trim().toUpperCase();
  if (raw === "SERVER" || raw === "KIOSK") return raw;
  return "ALL";
}

/** True when NFC reader agents live on the kiosk PCs instead of this server. */
export function isRemoteAgentDeployment(): boolean {
  return getDeploymentRole() === "SERVER";
}
