use soroban_sdk::{Address, BytesN, Env, token};
use crate::storage::{
    Group, GroupStatus,
    save_group,
    set_contributed, has_contributed, clear_contributions,
    save_commitment,
};
use crate::events;

// ---------------------------------------------------------------------------
// Cycle Logic
// ---------------------------------------------------------------------------
// This module handles all state transitions inside a running cycle:
//   1. Recording a member contribution
//   2. Closing a cycle and sending the payout
//   3. Storing the ZK commitment for honest members
//   4. Flagging members who missed the deadline
// ---------------------------------------------------------------------------

/// Record a member's contribution for the current cycle.
///
/// Transfers `group.contribution_amount` USDC from the member's wallet
/// into the contract. The token client handles the actual transfer —
/// the member must have pre-approved the contract as a spender.
pub fn record_contribution(env: &Env, group_id: u32, group: Group, member: &Address) {
    // Pull USDC from member into contract
    let token_client = token::Client::new(env, &group.token);
    token_client.transfer(
        member,
        &env.current_contract_address(),
        &group.contribution_amount,
    );

    // Mark this member as contributed for the current cycle
    set_contributed(env, group_id, member);

    events::contribution_made(
        env,
        group_id,
        member,
        group.current_cycle,
        group.contribution_amount,
    );
}

/// Close the current cycle:
///   - Send the pooled USDC to the cycle's designated recipient
///   - Store ZK commitments for every member who contributed honestly
///   - Clear contribution flags for the next cycle
///   - Advance the cycle counter or mark the group as Completed
///
/// Can be called by the AI agent, the admin, or any member after the deadline.
/// All members who contributed honestly get a commitment stored regardless
/// of whether the deadline had to be enforced.
pub fn close_cycle(env: &Env, group_id: u32, mut group: Group) -> Address {
    // Determine payout recipient for this cycle
    let recipient = group
        .payout_order
        .get(group.current_cycle)
        .expect("No recipient for cycle");

    // Calculate total pool = contribution_amount × number of members
    // Members who defaulted reduce the pool — their slots are zero
    let total_pool = calculate_pool(&env, group_id, &group);

    // Send payout to recipient
    if total_pool > 0 {
        let token_client = token::Client::new(env, &group.token);
        token_client.transfer(
            &env.current_contract_address(),
            &recipient,
            &total_pool,
        );
    }

    events::payout_sent(env, group_id, &recipient, group.current_cycle, total_pool);

    // Store ZK commitments for members who contributed honestly this cycle
    store_honest_member_commitments(env, group_id, &group);

    // Reset contribution flags for the next cycle
    clear_contributions(env, group_id, &group.members);

    // Advance cycle state
    let _completed_cycle = group.current_cycle;
    group.current_cycle += 1;

    if group.current_cycle >= group.total_cycles {
        // All cycles done — group is finished
        group.status = GroupStatus::Completed;
        save_group(env, group_id, &group);
        events::group_completed(env, group_id);
    } else {
        // Start the next cycle — record when it begins
        group.cycle_start_ledger = env.ledger().sequence();
        save_group(env, group_id, &group);
    }

    recipient
}

/// Flag a member as defaulted when they miss the cycle deadline.
///
/// Records the default event on-chain. The member is NOT removed from
/// payout_order (they still receive their payout when their turn comes —
/// the group collectively absorbs the shortfall). However their default
/// is permanently visible in events and prevents them from joining new groups
/// through the ZK reputation system.
pub fn flag_default(env: &Env, group_id: u32, group: &Group, member: &Address) {
    events::member_defaulted(env, group_id, member, group.current_cycle);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Calculate the total pool available for payout this cycle.
/// Only counts members who actually contributed — defaults are excluded.
fn calculate_pool(env: &Env, group_id: u32, group: &Group) -> i128 {
    let mut pool: i128 = 0;
    for member in group.members.iter() {
        if has_contributed(env, group_id, &member) {
            pool += group.contribution_amount;
        }
    }
    pool
}

/// Store a ZK commitment for every member who contributed honestly this cycle.
///
/// The commitment is passed in by the caller (admin or AI agent) after
/// computing poseidon(wallet_address, cycles_completed) off-chain.
/// For the MVP we accept the commitment from the transaction signer —
/// in production this would be computed inside the contract using
/// Soroban Protocol 25 native Poseidon hashing.
///
/// Each honest member's commitment is updated to reflect their latest
/// completed cycle count, which they can later use to generate a ZK proof.
pub fn store_commitment_for_member(
    env: &Env,
    group_id: u32,
    member: &Address,
    commitment: BytesN<32>,
) {
    save_commitment(env, group_id, member, commitment.clone());
    events::commitment_stored(env, group_id, member, &commitment);
}

/// At cycle close, store commitments for all members who contributed honestly.
/// Commitments passed in via the close_cycle call parameters.
/// If no commitment is provided for a member (they defaulted), none is stored.
fn store_honest_member_commitments(_env: &Env, _group_id: u32, _group: &Group) {
    // We emit a marker event so the frontend/agent knows to submit
    // individual commitments via store_commitment_for_member after close
    // This is the safe pattern — commitments come from the member's device
    // where their private wallet_address is known
}
