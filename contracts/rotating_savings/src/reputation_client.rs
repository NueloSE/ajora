use soroban_sdk::{contractclient, Address, Env};

// ---------------------------------------------------------------------------
// Cross-contract client for the Reputation contract
// ---------------------------------------------------------------------------
// The #[contractclient] macro generates a ReputationClient struct that
// rotating_savings uses to invoke the reputation contract at runtime.
// No WASM import needed — Soroban resolves the call by contract address.

#[contractclient(name = "ReputationClient")]
#[allow(dead_code)]
pub trait ReputationTrait {
    /// Gate check — returns true if the member may join a group with the
    /// given min_score. Does NOT panic; use this to guard join_group.
    fn can_join(env: Env, member: Address, min_score: u32) -> bool;

    /// Return the member's current reputation score (0–100).
    fn get_score(env: Env, member: Address) -> u32;

    /// Record a default: deducts score, stores debt, applies lockout on 3rd+.
    fn record_default(
        env: Env,
        caller: Address,
        debtor: Address,
        creditor: Address,
        amount: i128,
        token: Address,
        group_id: u32,
        cycle: u32,
    );

    /// Award completion bonus to a member who contributed honestly this cycle.
    fn record_completion(env: Env, caller: Address, member: Address);

    /// Increment the member's active-group counter when they join.
    fn increment_active(env: Env, caller: Address, member: Address);

    /// Decrement the member's active-group counter when a group ends.
    fn decrement_active(env: Env, caller: Address, member: Address);
}
