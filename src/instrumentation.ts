import { assertProductionSecretsConfigured } from "@/lib/session-config";

export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  try {
    assertProductionSecretsConfigured();
  } catch (err) {
    console.error(
      "[FATAL][Startup] Server refused to start due to invalid or missing production secrets:",
      err instanceof Error ? err.message : String(err)
    );
    if (typeof process !== "undefined" && typeof process.exit === "function") {
      process.exit(1);
    }
    throw err;
  }
}
