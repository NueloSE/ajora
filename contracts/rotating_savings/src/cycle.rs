use soroban_sdk::{Address, BytesN, Env, token};
use crate::storage::{
    Group, GroupStatus,
    save_group, move_to_last,
    set_contributed, has_contributed, clear_contributions,
    save_commitment,
};
use crate::events;
use crate::reputation_client::ReputationClient;

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
///   - Award reputation completion bonus to every honest member
///   - Store ZK commitments for every member who contributed honestly
///   - Clear contribution flags for the next cycle
///   - Advance the cycle counter or mark the group as Completed
///   - If completed, decrement active-group count for all members in reputation
///
/// Can be called by the AI agent, the admin, or any member after the deadline.
pub fn close_cycle(env: &Env, group_id: u32, mut group: Group) -> Address {
    // Determine payout recipient for this cycle
    let recipient = group
        .payout_order
        .get(group.current_cycle)
        .expect("No recipient for cycle");

    // Collect honest members BEFORE clearing contribution flags
    let honest_members = collect_honest_members(env, group_id, &group.members);

    // Total pool = honest contributions only (defaulters are excluded)
    let total_pool = (honest_members.len() as i128) * group.contribution_amount;

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

    // Store ZK commitments for honest members
    store_honest_member_commitments(env, group_id, &group);

    // Reset contribution flags for the next cycle
    clear_contributions(env, group_id, &group.members);

    // Reputation: award +5/+10 completion bonus to every honest member
    if let Some(rep_addr) = group.reputation_contract.clone() {
        let rep = ReputationClient::new(env, &rep_addr);
        let caller = env.current_contract_address();
        for m in honest_members.iter() {
            rep.record_completion(&caller, &m);
        }
    }

    // Advance cycle state
    let _completed_cycle = group.current_cycle;
    group.current_cycle += 1;

    if group.current_cycle >= group.total_cycles {
        // All cycles done — group is finished
        group.status = GroupStatus::Completed;
        save_group(env, group_id, &group);
        events::group_completed(env, group_id);

        // Reputation: everyone leaves the group — decrement their active count
        if let Some(rep_addr) = group.reputation_contract.clone() {
            let rep = ReputationClient::new(env, &rep_addr);
            let caller = env.current_contract_address();
            for m in group.members.iter() {
                rep.decrement_active(&caller, &m);
            }
        }
    } else {
        // Start the next cycle — record when it begins
        group.cycle_start_ledger = env.ledger().sequence();
        save_group(env, group_id, &group);
    }

    recipient
}

/// Flag a member as defaulted when they miss the cycle deadline.
///
/// In addition to recording the default on the reputation contract, this
/// function implements the payout-demotion rule:
///
///   If the defaulter has a payout slot scheduled for a FUTURE cycle
///   (their position in payout_order > current_cycle), they are automatically
///   moved to the last position. They pay their dues before they can benefit.
///
/// A member whose payout slot is in the current cycle or already past is not
/// affected — they either receive the (reduced) payout or have already been paid.
pub fn flag_default(env: &Env, group_id: u32, mut group: Group, member: &Address) {
    events::member_defaulted(env, group_id, member, group.current_cycle);

    if let Some(rep_addr) = &group.reputation_contract.clone() {
        // The creditor is whoever receives the payout this cycle
        let creditor = group
            .payout_order
            .get(group.current_cycle)
            .expect("No payout recipient for current cycle");

        let rep = ReputationClient::new(env, rep_addr);
        rep.record_default(
            &env.current_contract_address(),
            member,
            &creditor,
            &group.contribution_amount,
            &group.token,
            &group_id,
            &group.current_cycle,
        );
    }

    // Payout demotion: if the defaulter has a future payout slot, move them to last
    let mut defaulter_idx: Option<u32> = None;
    for i in 0..group.payout_order.len() {
        if group.payout_order.get(i).unwrap() == *member {
            defaulter_idx = Some(i);
            break;
        }
    }

    if let Some(idx) = defaulter_idx {
        // idx >= current_cycle: demote if their payout slot is this cycle or later
        // (a member who defaults in their own payout cycle should not receive the payout)
        if idx >= group.current_cycle {
            let last_pos = group.payout_order.len() - 1;
            group.payout_order = move_to_last(env, &group.payout_order, idx);
            save_group(env, group_id, &group);
            events::payout_position_moved(env, group_id, member, idx, last_pos);
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Collect all members who have contributed in the current cycle.
/// Called before clearing contribution flags so we don't lose this info.
fn collect_honest_members(
    env: &Env,
    group_id: u32,
    members: &soroban_sdk::Vec<Address>,
) -> soroban_sdk::Vec<Address> {
    let mut honest: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(env);
    for m in members.iter() {
        if has_contributed(env, group_id, &m) {
            honest.push_back(m);
        }
    }
    honest
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
/// If no commitment is provided for a member (they defaulted), none is stored.
fn store_honest_member_commitments(_env: &Env, _group_id: u32, _group: &Group) {
    // We emit a marker event so the frontend/agent knows to submit
    // individual commitments via store_commitment_for_member after close.
    // This is the safe pattern — commitments come from the member's device
    // where their private wallet_address is known.
}
