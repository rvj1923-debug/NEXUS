import net from "node:net";

const port = parseInt(process.env.PGPORT || "5432", 10);
const host = process.env.PGHOST || "127.0.0.1";
const maxAttempts = 20;
const delayMs = 500;

console.log(`[Orchestrator] Waiting for PostgreSQL to be ready on ${host}:${port}...`);

async function checkPort() {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(400);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => {
      resolve(false);
    });
    s.connect(port, host);
  });
}

async function main() {
  for (let i = 1; i <= maxAttempts; i++) {
    const ready = await checkPort();
    if (ready) {
      console.log("[Orchestrator] ✓ PostgreSQL server is ready and accepting connections.");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.error("[Orchestrator] ⚠ Timed out waiting for PostgreSQL server.");
  process.exit(1);
}

main();
