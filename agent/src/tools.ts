// ---------------------------------------------------------------------------
// Claude tool definitions — what the agent can DO
// ---------------------------------------------------------------------------
// Each tool maps to a real on-chain action or a notification.
// Claude decides which tool to call based on the group state it observes.

import Anthropic from "@anthropic-ai/sdk";

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "send_reminder",
    description:
      "Send a reminder notification to a member who has not yet contributed " +
      "in the current cycle. Use when the deadline is approaching (< 48 hours " +
      "in ledger terms) and the member has not contributed.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id:   { type: "number",  description: "The savings group ID" },
        group_name: { type: "string",  description: "Human-readable group name" },
        member:     { type: "string",  description: "Stellar address of the member to remind" },
        hours_left: { type: "number",  description: "Approximate hours until cycle deadline" },
        amount:     { type: "string",  description: "Contribution amount due, e.g. '50,000 USDC'" },
      },
      required: ["group_id", "group_name", "member", "hours_left", "amount"],
    },
  },
  {
    name: "flag_default",
    description:
      "Call flag_default on the Soroban contract for a member who missed the " +
      "cycle deadline. Only call this AFTER the deadline has passed and the " +
      "member has not contributed.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id:      { type: "number", description: "The savings group ID" },
        contract_type: { type: "string", enum: ["rotating", "target"], description: "Which contract type" },
        member:        { type: "string", description: "Stellar address of the defaulting member" },
        reason:        { type: "string", description: "Brief explanation of why this is being flagged" },
      },
      required: ["group_id", "contract_type", "member", "reason"],
    },
  },
  {
    name: "close_cycle",
    description:
      "Call close_cycle on the rotating savings contract. Use when ALL " +
      "members have contributed in the current cycle, or the deadline has " +
      "passed. This triggers the payout to the next recipient.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id:   { type: "number", description: "The savings group ID" },
        group_name: { type: "string", description: "Human-readable group name" },
        reason:     { type: "string", description: "Why the cycle is being closed now" },
      },
      required: ["group_id", "group_name", "reason"],
    },
  },
  {
    name: "alert_payout",
    description:
      "Notify the upcoming payout recipient that they will receive funds soon. " +
      "Call this when a cycle closes successfully.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id:   { type: "number", description: "The savings group ID" },
        group_name: { type: "string", description: "Human-readable group name" },
        recipient:  { type: "string", description: "Stellar address of the payout recipient" },
        amount:     { type: "string", description: "Amount being paid out" },
        tx_hash:    { type: "string", description: "Transaction hash of the close_cycle tx" },
      },
      required: ["group_id", "group_name", "recipient", "amount"],
    },
  },
  {
    name: "alert_forming_group",
    description:
      "Announce that a new savings group is forming and needs more members. " +
      "Call this when a group is in Forming status and has open slots.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id:        { type: "number", description: "The savings group ID" },
        group_name:      { type: "string", description: "Human-readable group name" },
        members_needed:  { type: "number", description: "How many more members are needed" },
        amount:          { type: "string", description: "Contribution per cycle" },
        total_cycles:    { type: "number", description: "Total number of cycles" },
      },
      required: ["group_id", "group_name", "members_needed", "amount"],
    },
  },
  {
    name: "no_action",
    description:
      "Explicitly record that no action is needed right now for a group. " +
      "Use this when everything is on track.",
    input_schema: {
      type: "object" as const,
      properties: {
        group_id: { type: "number", description: "The savings group ID" },
        reason:   { type: "string", description: "Why no action is needed" },
      },
      required: ["group_id", "reason"],
    },
  },
];
