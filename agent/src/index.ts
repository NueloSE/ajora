// ---------------------------------------------------------------------------
// Ajora Agent — entry point
// ---------------------------------------------------------------------------

import "dotenv/config";
import { runAgentCycle, buildMockObservation } from "./agent.js";
import { buildLiveObservation } from "./stellar.js";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "60000");
const USE_MOCK         = process.env.USE_MOCK_DATA !== "false"; // default true until deployed

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║       Ajora Group Health Agent       ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`Mode:     ${USE_MOCK ? "mock data" : "live Stellar testnet"}`);
  console.log(`Interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`Model:    claude-sonnet-4-6\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is not set in .env");
    process.exit(1);
  }

  // Run immediately on start, then on interval
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

async function tick() {
  try {
    const observation = USE_MOCK
      ? await buildMockObservation()
      : await buildLiveObservation();
    await runAgentCycle(observation);
  } catch (err) {
    console.error("[agent] Cycle error:", err);
  }
}

main();
