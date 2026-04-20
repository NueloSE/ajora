// ---------------------------------------------------------------------------
// Ajora AI Agent — the Claude-powered group health monitor
// ---------------------------------------------------------------------------
//
// HOW IT WORKS:
//   1. Every POLL_INTERVAL_MS the agent fetches all active group states from
//      the Soroban contracts (via stellar.ts).
//
//   2. It builds an "observation" — a structured description of who has
//      contributed, how close each deadline is, and what the payout order is.
//
//   3. It calls Claude (claude-sonnet-4-6) with:
//        - A system prompt describing the agent's role and rules
//        - The current observation as the user message
//        - The AGENT_TOOLS as available tools
//
//   4. Claude responds with tool_use blocks — each one is a concrete action
//      (send_reminder, flag_default, close_cycle, etc.).
//
//   5. The executor runs those actions — submitting Stellar transactions where
//      needed, logging notifications for the rest.
//
//   6. The tool results are fed back to Claude for a final summary, which is
//      logged. Then the loop repeats.

import Anthropic from "@anthropic-ai/sdk";
import { AgentObservation, SavingsGroup } from "./types.js";
import { AGENT_TOOLS } from "./tools.js";
import { executeTool } from "./executor.js";
import { getCurrentLedger, fetchMemberReputationScore, fetchMemberUnpaidDebtCount } from "./stellar.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "60000"); // 1 min default
const LEDGERS_PER_HOUR = 720; // ~5s per ledger on Stellar

// ---------------------------------------------------------------------------
// System prompt — tells Claude what it is and what the rules are
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `
You are the Ajora Group Health Agent — an autonomous monitor for a decentralised
rotating savings platform built on Stellar.

Your job is to watch savings groups and take the right action at the right time:

RULES:
1. If a member has not contributed and the deadline is MORE than 48 hours away:
   → no_action (it is too early to remind)

2. If a member has not contributed and the deadline is LESS than 48 hours away:
   → send_reminder (one reminder per member per cycle)
   Include the member's reputation score in the reminder, e.g.:
   "Alice (score 85) — your contribution is due in 12 hours."

3. If the deadline has PASSED (ledgers_until_deadline < 0) and a member has NOT contributed:
   → flag_default on the contract, then consider close_cycle if it unblocks the payout
   When flagging a default, the creditor is the member whose payout position matches
   the current cycle index in the payout_order array (0-indexed: cycle 1 → index 0).

4. If ALL members in an active rotating group have contributed:
   → close_cycle immediately — do not wait for the deadline

5. If a group is in "forming" status and needs members:
   → alert_forming_group (once per poll, not spammy)

6. If a payout just completed (close_cycle succeeded):
   → alert_payout to the recipient

7. Never call flag_default or close_cycle more than once per group per cycle.
   Check whether the action has already been taken before calling it.

REPUTATION CONTEXT:
- Each member has a score 0–100. New members start at 100.
- Score < 60: member is in re-entry status — mention this in reminders.
- Score drops: -20 (1st default), -25 (2nd), -30 (3rd+). Third default triggers a 6-month lockout.
- Unpaid debts block joining new groups. Mention unpaid debts in reminder messages.
- Use score context to calibrate urgency: a member with score 40 and unpaid debts
  needs a firmer reminder than a member with score 95.

CONTEXT:
- Stellar processes ~720 ledgers per hour (one ledger ~5 seconds)
- "contribution_amount" is in stroops (1 USDC = 10,000,000 stroops)
- Group IDs are u32 integers matching the on-chain contract storage
- Addresses are Stellar public keys (G... format)

Be conservative: when in doubt, prefer no_action over a premature action.
Think step by step about each group before deciding.
`.trim();

// ---------------------------------------------------------------------------
// Build the observation message sent to Claude each poll
// ---------------------------------------------------------------------------
async function buildObservationMessage(obs: AgentObservation): Promise<string> {
  const lines: string[] = [
    `Current ledger: ${obs.currentLedger}`,
    `Groups to monitor: ${obs.groups.length}`,
    "",
  ];

  for (const group of obs.groups) {
    const ledgersLeft = obs.deadlinesInLedgers[group.id] ?? 0;
    const hoursLeft   = Math.round(ledgersLeft / LEDGERS_PER_HOUR);

    lines.push(`--- Group ${group.id}: "${group.name}" (${group.type}) ---`);
    lines.push(`  Status: ${group.status}`);
    lines.push(`  Cycle: ${group.currentCycle} / ${group.totalCycles}`);
    lines.push(`  Members: ${group.members.length} / ${group.maxMembers}`);
    lines.push(`  Contribution: ${Number(group.contributionAmount) / 10_000_000} USDC per cycle`);
    lines.push(`  Ledgers until deadline: ${ledgersLeft} (~${hoursLeft}h)`);

    const groupContribs  = obs.contributions.filter(c => c.groupId === group.id);
    const contributed    = groupContribs.filter(c => c.contributed).map(c => c.member);
    const notContributed = groupContribs.filter(c => !c.contributed).map(c => c.member);

    if (contributed.length > 0) {
      lines.push(`  Contributed (${contributed.length}): ${contributed.join(", ")}`);
    }

    if (notContributed.length > 0) {
      // Fetch reputation scores for non-contributors in parallel
      const repData = await Promise.all(
        notContributed.map(async member => {
          const [score, debtCount] = await Promise.all([
            fetchMemberReputationScore(member),
            fetchMemberUnpaidDebtCount(member),
          ]);
          return { member, score, debtCount };
        }),
      );

      lines.push(`  NOT contributed (${notContributed.length}):`);
      for (const { member, score, debtCount } of repData) {
        const debtNote = debtCount > 0 ? `, ${debtCount} unpaid debt${debtCount > 1 ? "s" : ""}` : "";
        const reentryNote = score < 60 ? " [re-entry member]" : "";
        lines.push(`    - ${member} (score: ${score}${debtNote}${reentryNote})`);
      }
    }

    lines.push("");
  }

  lines.push("Decide what actions to take for each group.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Quick check — is there anything that actually needs Claude's attention?
// Returns true if at least one group has an urgent condition.
// ---------------------------------------------------------------------------
const LEDGERS_48H  = 48 * LEDGERS_PER_HOUR;  // 34,560 ledgers

function needsAttention(observation: AgentObservation): boolean {
  for (const group of observation.groups) {
    // Forming groups always worth alerting
    if (group.status === "forming") return true;

    const ledgersLeft = observation.deadlinesInLedgers[group.id] ?? Infinity;
    const groupContribs = observation.contributions.filter(c => c.groupId === group.id);
    const allContributed = groupContribs.length > 0 && groupContribs.every(c => c.contributed);
    const anyMissed = groupContribs.some(c => !c.contributed);

    // Deadline within 48h with missing contributions
    if (anyMissed && ledgersLeft < LEDGERS_48H) return true;
    // Deadline passed with missing contributions (default territory)
    if (anyMissed && ledgersLeft < 0) return true;
    // All contributed — close_cycle needed
    if (allContributed) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Run one agent poll cycle
// ---------------------------------------------------------------------------
export async function runAgentCycle(observation: AgentObservation): Promise<void> {
  // Skip Claude entirely if nothing needs attention — saves API cost
  if (!needsAttention(observation)) {
    console.log("\n[agent] Ledger", observation.currentLedger, "— nothing urgent, skipping Claude.");
    return;
  }

  const userMessage = await buildObservationMessage(observation);

  console.log("\n[agent] Starting cycle at ledger", observation.currentLedger);
  console.log("[agent] Observation:\n" + userMessage);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Agentic loop — keep calling Claude until it stops using tools
  let iteration = 0;
  const MAX_ITERATIONS = 10; // safety cap

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

    console.log(`[agent] Claude response (stop_reason: ${response.stop_reason})`);

    // Collect tool use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // Log any text reasoning Claude produced
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    for (const t of textBlocks) {
      if (t.text.trim()) console.log("[agent] Claude reasoning:", t.text.trim());
    }

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      // Claude is done — no more tools to call
      break;
    }

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      console.log(`[agent] Executing tool: ${toolUse.name}`, toolUse.input);
      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add Claude's response + tool results to the conversation
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  console.log("[agent] Cycle complete.\n");
}

// ---------------------------------------------------------------------------
// Mock observation builder — used until contracts are deployed
// ---------------------------------------------------------------------------
// Generates realistic test data so the agent can be demoed without live
// contracts. Replace with real Soroban reads post-deployment.

export async function buildMockObservation(): Promise<AgentObservation> {
  const currentLedger = await getCurrentLedger().catch(() => 10_000);
  const ALICE = "GBVMK4YWQX3ZJUV7XNPLO2JZQNFHK7YALICE000000000000000000000";
  const BOB   = "GBOB000000000000000000000000000000000000000000000000000000";
  const CAROL = "GCAROL00000000000000000000000000000000000000000000000000000";

  const groups: SavingsGroup[] = [
    {
      id: 1,
      name: "Lagos Circle",
      type: "rotating",
      members: [ALICE, BOB, CAROL],
      maxMembers: 3,
      contributionAmount: BigInt(500_000_000), // 50 USDC
      cycleDurationLedgers: 720 * 24 * 7,     // 1 week
      currentCycle: 1,
      totalCycles: 3,
      cycleStartLedger: currentLedger - 720 * 24 * 6, // 6 days in
      status: "active",
      token: "USDC_CONTRACT",
    },
    {
      id: 2,
      name: "Abuja Savers",
      type: "rotating",
      members: [ALICE, BOB],
      maxMembers: 4,
      contributionAmount: BigInt(250_000_000), // 25 USDC
      cycleDurationLedgers: 720 * 24 * 30,    // 30 days
      currentCycle: 0,
      totalCycles: 4,
      cycleStartLedger: currentLedger - 720 * 24 * 2,
      status: "forming",
      token: "USDC_CONTRACT",
    },
  ];

  // Lagos Circle: Alice contributed, Bob and Carol have NOT — deadline in ~18h
  const contributions = [
    { groupId: 1, member: ALICE, contributed: true,  cycle: 1 },
    { groupId: 1, member: BOB,   contributed: false, cycle: 1 },
    { groupId: 1, member: CAROL, contributed: false, cycle: 1 },
  ];

  // Deadline is 18 hours away in ledgers
  const deadlinesInLedgers: Record<number, number> = {
    1: Math.round(18 * LEDGERS_PER_HOUR),  // ~18 hours
    2: 0,                                   // forming — no active deadline
  };

  return { currentLedger, groups, contributions, deadlinesInLedgers };
}
