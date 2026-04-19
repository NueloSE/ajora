// ---------------------------------------------------------------------------
// Shared types for the Ajora AI Agent
// ---------------------------------------------------------------------------

export interface SavingsGroup {
  id: number;
  name: string;
  type: "rotating" | "target";
  members: string[];       // Stellar account addresses
  maxMembers: number;
  contributionAmount: bigint;
  cycleDurationLedgers: number;
  currentCycle: number;
  totalCycles: number;
  cycleStartLedger: number;
  status: "forming" | "active" | "completed" | "matured" | "cancelled";
  token: string;           // token contract address
}

export interface MemberContribution {
  groupId: number;
  member: string;
  contributed: boolean;
  cycle: number;
}

export interface AgentAction {
  type:
    | "send_reminder"
    | "flag_default"
    | "close_cycle"
    | "alert_forming_group"
    | "alert_payout"
    | "no_action";
  groupId: number;
  member?: string;         // relevant for per-member actions
  reason: string;          // Claude's reasoning
  urgency: "low" | "medium" | "high";
}

export interface AgentObservation {
  currentLedger: number;
  groups: SavingsGroup[];
  contributions: MemberContribution[];
  // How many ledgers until each active group's deadline
  deadlinesInLedgers: Record<number, number>;
}
