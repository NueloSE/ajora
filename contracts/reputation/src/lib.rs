#![no_std]

// ---------------------------------------------------------------------------
// Ajora Reputation Contract
// ---------------------------------------------------------------------------
//
// Tracks on-chain reputation scores for every Ajora member.
//
// SCORE MECHANICS:
//   Starting score:              100  (max 100)
//   Complete a cycle honestly:   +5   (capped at 100)
//   Complete re-entry cycle:     +10  (only when score < 60, capped at 100)
//   Repay one debt:              +8   (per debt, capped at 100)
//   First default:               -20
//   Second default:              -25
//   Third+ default:              -30  + 6-month lockout
//   Score floor:                  0
//
// GROUP LIMIT BANDS:
//   Score 80–100  →  max 2 active groups
//   Score 60–79   →  max 1 active group
//   Score < 60    →  cannot join (unless group min_score = 0, re-entry group)
//   Locked        →  cannot join anything
//
// DEBT SYSTEM:
//   Every default records a DebtRecord pointing to the specific creditor
//   (the member who was supposed to receive the payout that cycle).
//   A member with ANY unpaid debt cannot join a new group.
//   Repayment sends USDC directly from debtor → creditor on-chain.
//   Multiple defaults across groups or cycles are all tracked independently.
//
// PAYOUT ORDER:
//   Re-entry members (score < 60) are placed last in payout order.
//   Among re-entry members, the lowest score goes last.
//   This is enforced in rotating_savings join_group, not here.
// ---------------------------------------------------------------------------

mod events;
mod storage;
mod validation;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use storage::{
    load_active_groups, load_debts, load_default_count,
    load_locked_until, load_score, max_groups_for_score, member_has_unpaid_debt,
    member_is_locked, save_active_groups, save_admin, save_debts,
    save_default_count, save_locked_until, save_score, DebtRecord,
    COMPLETE_BONUS, DEFAULT_1_PENALTY, DEFAULT_2_PENALTY, DEFAULT_3_PENALTY,
    LOCKOUT_LEDGERS, REPAY_BONUS, REENTRY_BONUS, SCORE_MAX,
};
use validation::{require_initialized, require_not_initialized};

#[contract]
pub struct Reputation;

#[contractimpl]
impl Reputation {

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the reputation contract with an admin address.
    /// Must be called once after deployment before any other function.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        require_not_initialized(&env);
        save_admin(&env, &admin);
        events::initialized(&env, &admin);
    }

    // -----------------------------------------------------------------------
    // Called by rotating_savings — record a default
    // -----------------------------------------------------------------------

    /// Record a default when a member misses a cycle deadline.
    ///
    /// Called by the rotating_savings contract (passing its own address as
    /// `caller`). Soroban automatically authorises the calling contract for
    /// cross-contract sub-invocations.
    ///
    /// Deducts score, records the debt owed to the cycle's payout recipient,
    /// and applies a 6-month lockout on the third+ default.
    ///
    /// # Arguments
    /// * `caller`   — the savings contract invoking this (must have auth)
    /// * `debtor`   — the member who defaulted
    /// * `creditor` — the member who was supposed to receive the payout
    /// * `amount`   — contribution amount owed, in stroops
    /// * `token`    — USDC contract address (needed for repayment later)
    /// * `group_id` — which group the default occurred in
    /// * `cycle`    — which cycle within that group
    pub fn record_default(
        env:      Env,
        caller:   Address,
        debtor:   Address,
        creditor: Address,
        amount:   i128,
        token:    Address,
        group_id: u32,
        cycle:    u32,
    ) {
        caller.require_auth();
        require_initialized(&env);

        // Determine penalty based on how many times they have defaulted before
        let default_count = load_default_count(&env, &debtor);
        let penalty: u32 = match default_count {
            0 => DEFAULT_1_PENALTY,
            1 => DEFAULT_2_PENALTY,
            _ => DEFAULT_3_PENALTY,
        };

        // Apply score deduction — floor at 0
        let current_score = load_score(&env, &debtor);
        let new_score = current_score.saturating_sub(penalty);
        save_score(&env, &debtor, new_score);

        // Increment default counter
        save_default_count(&env, &debtor, default_count + 1);

        // Apply 6-month lockout on third+ default
        if default_count >= 2 {
            let locked_until = (env.ledger().sequence() as u64) + LOCKOUT_LEDGERS;
            save_locked_until(&env, &debtor, locked_until);
            events::member_locked(&env, &debtor, locked_until);
        }

        // Record the debt — add to the member's debt list
        let mut debts = load_debts(&env, &debtor);
        debts.push_back(DebtRecord {
            creditor: creditor.clone(),
            amount,
            group_id,
            cycle,
            token,
            paid: false,
        });
        save_debts(&env, &debtor, &debts);

        events::default_recorded(&env, &debtor, &creditor, group_id, cycle, new_score);
    }

    // -----------------------------------------------------------------------
    // Called by rotating_savings — record honest cycle completion
    // -----------------------------------------------------------------------

    /// Record that a member completed a cycle honestly.
    ///
    /// Called by rotating_savings during close_cycle for every member who
    /// contributed. Awards +10 if score < 60 (re-entry bonus) or +5 otherwise.
    ///
    /// # Arguments
    /// * `caller`  — the savings contract invoking this (must have auth)
    /// * `member`  — the member who completed the cycle
    pub fn record_completion(env: Env, caller: Address, member: Address) {
        caller.require_auth();
        require_initialized(&env);

        let score = load_score(&env, &member);

        // Re-entry members (score < 60) earn double bonus to reward commitment
        let bonus = if score < 60 { REENTRY_BONUS } else { COMPLETE_BONUS };
        let new_score = (score + bonus).min(SCORE_MAX);
        save_score(&env, &member, new_score);

        events::cycle_completed(&env, &member, new_score, bonus);
    }

    // -----------------------------------------------------------------------
    // Called by rotating_savings — track active group membership
    // -----------------------------------------------------------------------

    /// Increment a member's active group count when they join a group.
    /// Called by rotating_savings join_group after eligibility is confirmed.
    pub fn increment_active(env: Env, caller: Address, member: Address) {
        caller.require_auth();
        require_initialized(&env);

        let count = load_active_groups(&env, &member);
        save_active_groups(&env, &member, count + 1);
        events::active_groups_changed(&env, &member, count + 1);
    }

    /// Decrement a member's active group count when a group ends.
    /// Called by rotating_savings close_cycle when status → Completed,
    /// or when a member is removed due to group cancellation.
    pub fn decrement_active(env: Env, caller: Address, member: Address) {
        caller.require_auth();
        require_initialized(&env);

        let count = load_active_groups(&env, &member);
        if count == 0 {
            // Safety: never go below 0
            return;
        }
        save_active_groups(&env, &member, count - 1);
        events::active_groups_changed(&env, &member, count - 1);
    }

    // -----------------------------------------------------------------------
    // Called by member — repay a specific debt
    // -----------------------------------------------------------------------

    /// Repay a specific debt identified by (group_id, cycle).
    ///
    /// Transfers the owed USDC directly from the debtor to the creditor.
    /// The debtor must have pre-approved this contract as a spender.
    /// Awards +8 to the debtor's score after successful repayment.
    ///
    /// # Arguments
    /// * `debtor`   — the member repaying the debt (must have auth)
    /// * `group_id` — which group the debt is from
    /// * `cycle`    — which cycle within that group
    pub fn repay_debt(env: Env, debtor: Address, group_id: u32, cycle: u32) {
        debtor.require_auth();
        require_initialized(&env);

        let mut debts = load_debts(&env, &debtor);

        // Find the matching unpaid debt
        let mut found_idx: Option<u32> = None;
        let mut debt_amount: i128 = 0;
        let mut debt_creditor: Option<Address> = None;
        let mut debt_token: Option<Address> = None;

        for (i, debt) in debts.iter().enumerate() {
            if debt.group_id == group_id && debt.cycle == cycle && !debt.paid {
                found_idx      = Some(i as u32);
                debt_amount    = debt.amount;
                debt_creditor  = Some(debt.creditor.clone());
                debt_token     = Some(debt.token.clone());
                break;
            }
        }

        let idx      = found_idx.expect("Debt not found for this group and cycle");
        let creditor = debt_creditor.unwrap();
        let token    = debt_token.unwrap();

        // Transfer USDC from debtor → creditor
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&debtor, &creditor, &debt_amount);

        // Mark the specific debt as paid
        let mut updated_debt = debts.get(idx).unwrap();
        updated_debt.paid = true;
        debts.set(idx, updated_debt);
        save_debts(&env, &debtor, &debts);

        // Award score bonus for repayment
        let current_score = load_score(&env, &debtor);
        let new_score = (current_score + REPAY_BONUS).min(SCORE_MAX);
        save_score(&env, &debtor, new_score);

        events::debt_repaid(&env, &debtor, &creditor, group_id, cycle, debt_amount, new_score);
    }

    // -----------------------------------------------------------------------
    // Read-only queries
    // -----------------------------------------------------------------------

    /// Return the current reputation score for a member.
    /// Returns 100 for addresses with no record (new members).
    pub fn get_score(env: Env, member: Address) -> u32 {
        load_score(&env, &member)
    }

    /// Return all debt records for a member (paid and unpaid).
    pub fn get_debts(env: Env, member: Address) -> Vec<DebtRecord> {
        load_debts(&env, &member)
    }

    /// Return true if the member has at least one unpaid debt.
    pub fn has_unpaid_debt(env: Env, member: Address) -> bool {
        member_has_unpaid_debt(&env, &member)
    }

    /// Return true if the member is currently within a lockout period.
    pub fn is_locked(env: Env, member: Address) -> bool {
        member_is_locked(&env, &member)
    }

    /// Return the ledger number when the lockout expires — 0 if not locked.
    pub fn locked_until(env: Env, member: Address) -> u64 {
        load_locked_until(&env, &member)
    }

    /// Return the number of groups the member is currently active in.
    pub fn get_active_groups(env: Env, member: Address) -> u32 {
        load_active_groups(&env, &member)
    }

    /// Return the total number of defaults ever recorded for this member.
    pub fn get_default_count(env: Env, member: Address) -> u32 {
        load_default_count(&env, &member)
    }

    /// Full join eligibility check — returns true if the member can join a
    /// group with the given min_score requirement, false otherwise.
    /// Does NOT panic — use this for frontend display logic.
    /// rotating_savings calls require_can_join() directly which panics with
    /// a typed error.
    pub fn can_join(env: Env, member: Address, min_score: u32) -> bool {
        if member_is_locked(&env, &member)         { return false; }
        if member_has_unpaid_debt(&env, &member)   { return false; }

        let score = load_score(&env, &member);
        if min_score > 0 && score < min_score      { return false; }

        let max_groups = max_groups_for_score(score, min_score);
        if max_groups == 0                         { return false; }

        let active = load_active_groups(&env, &member);
        active < max_groups
    }

    /// Return the maximum number of active groups this member is allowed
    /// based on their score — useful for frontend display.
    pub fn max_allowed_groups(env: Env, member: Address) -> u32 {
        let score = load_score(&env, &member);
        // Use min_score=0 for the general limit (not tied to a specific group)
        max_groups_for_score(score, 0)
    }
}
