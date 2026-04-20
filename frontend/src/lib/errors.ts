// ---------------------------------------------------------------------------
// Soroban contract error parser
// ---------------------------------------------------------------------------
// Maps raw Soroban simulation errors like:
//   "Simulation failed: HostError: Error(Contract, #7) ..."
// to short, user-friendly messages.
// ---------------------------------------------------------------------------

// Rotating savings + Target savings share the same error codes up to 13
const ROTATING_ERRORS: Record<number, string> = {
  1:  "Group not found.",
  2:  "This action isn't allowed while the group is in its current status.",
  3:  "You are not a member of this group.",
  4:  "Only the group admin can do this.",
  5:  "This group is full.",
  6:  "You are already a member of this group.",
  7:  "You have already contributed this cycle.",
  8:  "Wrong contribution amount.",
  9:  "The cycle deadline hasn't passed yet — too early to close.",
  10: "The cycle deadline has passed — contributions are no longer accepted.",
  11: "This group has already completed all cycles.",
  12: "This member already contributed, so they cannot be flagged as a defaulter.",
  13: "No payout recipient found.",
  14: "Your reputation score, active group limit, or an unpaid debt is preventing you from joining. Check your reputation on the dashboard.",
};

const TARGET_ERRORS: Record<number, string> = {
  1:  "Pool not found.",
  2:  "This action isn't allowed while the pool is in its current status.",
  3:  "You are not a member of this pool.",
  4:  "Only the pool admin can do this.",
  5:  "This pool is full.",
  6:  "You are already a member of this pool.",
  7:  "You have already contributed this cycle.",
  8:  "Wrong contribution amount.",
  9:  "The cycle hasn't ended yet — too early to close.",
  10: "The cycle deadline has passed — contributions are no longer accepted.",
  11: "The pool has not matured yet — withdrawals open when all cycles complete.",
  12: "You have already withdrawn from this pool.",
  13: "Nothing to withdraw.",
  14: "This member already contributed.",
};

/**
 * Parse a raw Soroban/simulation error string and return a short,
 * user-friendly message. Falls back to a generic message if unrecognised.
 *
 * @param raw   - The Error.message from a caught exception
 * @param type  - "group" (rotating) or "pool" (target) — selects the error map
 */
export function friendlyError(raw: string, type: "group" | "pool" = "group"): string {
  // Extract the contract error number from patterns like:
  //   "Error(Contract, #7)"  or  "Error(Contract, 7)"
  const match = raw.match(/Error\(Contract,\s*#?(\d+)\)/i);
  if (match) {
    const code = parseInt(match[1], 10);
    const map  = type === "pool" ? TARGET_ERRORS : ROTATING_ERRORS;
    if (map[code]) return map[code];
  }

  // Insufficient USDC balance — not a contract error, comes from the token contract
  if (raw.toLowerCase().includes("insufficient") || raw.toLowerCase().includes("balance")) {
    return "Insufficient USDC balance. Top up your wallet and try again.";
  }

  // Simulation timed out or RPC unreachable
  if (raw.toLowerCase().includes("timeout") || raw.toLowerCase().includes("network")) {
    return "Network error — the Stellar RPC is unreachable. Try again in a moment.";
  }

  // Transaction timed out waiting for confirmation
  if (raw.includes("timed out")) {
    return "Transaction timed out waiting for confirmation. Check Stellar Explorer to see if it landed.";
  }

  // Passkey / WebAuthn cancelled
  if (raw.toLowerCase().includes("notallowederror") || raw.toLowerCase().includes("cancelled")) {
    return "Biometric sign cancelled. Please try again and approve the passkey prompt.";
  }

  // Generic fallback — still better than the raw dump
  return "Something went wrong. Please try again.";
}
