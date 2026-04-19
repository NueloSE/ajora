#![no_std]

mod cycle;
mod events;
mod reputation_client;
pub mod storage;
mod validation;

use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, BytesN, Env, Vec,
};

use storage::{
    find_reentry_insert_pos, insert_address_at, save_reentry_score,
    Group, GroupStatus,
    next_group_id, save_group, load_group,
    load_commitment, has_contributed,
};
use validation::{
    require_group_exists, require_forming, require_active,
    require_member, require_not_member, require_not_full,
    require_not_contributed,
    require_before_deadline, require_after_deadline,
    require_not_contributed_for_default,
    Error,
};
use reputation_client::ReputationClient;

// ---------------------------------------------------------------------------
// Contract Entry Point
// ---------------------------------------------------------------------------

#[contract]
pub struct RotatingSavings;

#[contractimpl]
impl RotatingSavings {

    // -----------------------------------------------------------------------
    // Group Lifecycle
    // -----------------------------------------------------------------------

    /// Create a new rotating savings group.
    ///
    /// # Arguments
    /// * `admin`                  - Account creating and managing the group
    /// * `token`                  - USDC contract address on this network
    /// * `contribution_amount`    - Amount each member contributes per cycle (in stroops)
    /// * `cycle_duration_ledgers` - Length of each cycle in ledgers (~5s/ledger on testnet)
    /// * `max_members`            - Total group size (also = total number of cycles)
    /// * `min_score`              - Minimum reputation score required to join.
    ///                              Pass 0 for a re-entry group (open to all non-locked members).
    /// * `reputation_contract`    - Reputation contract address, or None to skip reputation checks.
    ///
    /// # Returns
    /// The new group's unique ID
    pub fn create_group(
        env: Env,
        admin: Address,
        token: Address,
        contribution_amount: i128,
        cycle_duration_ledgers: u32,
        max_members: u32,
        min_score: u32,
        reputation_contract: Option<Address>,
    ) -> u32 {
        admin.require_auth();

        let group_id = next_group_id(&env);

        let group = Group {
            admin: admin.clone(),
            members: Vec::new(&env),
            max_members,
            contribution_amount,
            cycle_duration_ledgers,
            payout_order: Vec::new(&env),
            current_cycle: 0,
            total_cycles: max_members,
            cycle_start_ledger: 0,
            status: GroupStatus::Forming,
            token,
            min_score,
            reputation_contract,
            normal_member_count: 0,
        };

        save_group(&env, group_id, &group);
        events::group_created(&env, group_id, &admin, max_members, contribution_amount);

        group_id
    }

    /// Join an existing group that is still forming.
    ///
    /// If the group has a reputation contract:
    ///   - The member's eligibility is checked (locked, unpaid debt, score, group limit)
    ///   - Their score determines whether they are a normal or re-entry member
    ///   - Payout position is assigned accordingly:
    ///       Normal members  → inserted before the re-entry section (join order)
    ///       Re-entry members → inserted after normal members, sorted by score
    ///                          descending (highest score paid first, lowest last)
    ///   - Their active-group count is incremented in the reputation contract
    ///
    /// When the last member joins, the group automatically transitions to Active.
    pub fn join_group(env: Env, group_id: u32, member: Address) {
        member.require_auth();

        require_group_exists(&env, group_id);
        let mut group = load_group(&env, group_id);

        require_forming(&env, &group);
        require_not_full(&env, &group);
        require_not_member(&env, &group, &member);

        // ---- Reputation check and payout ordering ----
        let rep_addr_opt = group.reputation_contract.clone();

        let (is_reentry, member_score) = if let Some(ref rep_addr) = rep_addr_opt {
            let rep = ReputationClient::new(&env, rep_addr);

            // Gate: check eligibility — locked / unpaid debt / score / group limit
            if !rep.can_join(&member, &group.min_score) {
                panic_with_error!(&env, Error::ReputationCheckFailed);
            }

            let score = rep.get_score(&member);
            // A re-entry member: below-60 score joining a re-entry group (min_score == 0)
            let is_re = score < 60 && group.min_score == 0;
            (is_re, score)
        } else {
            (false, 100u32)
        };

        // ---- Determine payout position and insert into payout_order ----
        let payout_position: u32;
        if is_reentry {
            // Re-entry section: insert so that scores remain descending
            // (highest score first → lowest score last = paid last)
            payout_position = find_reentry_insert_pos(
                &env,
                group_id,
                &group.payout_order,
                group.normal_member_count,
                member_score,
            );
            group.payout_order =
                insert_address_at(&env, &group.payout_order, payout_position, member.clone());
            save_reentry_score(&env, group_id, &member, member_score);
        } else {
            // Normal member: append at the end of the normal section
            // (before any existing re-entry members)
            payout_position = group.normal_member_count;
            group.payout_order =
                insert_address_at(&env, &group.payout_order, payout_position, member.clone());
            group.normal_member_count += 1;
        }

        group.members.push_back(member.clone());
        events::member_joined(&env, group_id, &member, payout_position);

        // Reputation: increment the member's active-group counter
        if let Some(ref rep_addr) = rep_addr_opt {
            let rep = ReputationClient::new(&env, rep_addr);
            rep.increment_active(&env.current_contract_address(), &member);
        }

        // Auto-activate when the group is full
        if group.members.len() >= group.max_members {
            group.status = GroupStatus::Active;
            group.cycle_start_ledger = env.ledger().sequence();
            events::group_activated(&env, group_id);
        }

        save_group(&env, group_id, &group);
    }

    // -----------------------------------------------------------------------
    // Contribution
    // -----------------------------------------------------------------------

    /// Submit a contribution for the current cycle.
    ///
    /// The member must have pre-approved this contract as a spender
    /// on the USDC token contract for at least `contribution_amount`.
    /// The passkey-signed approval happens in the frontend before this call.
    pub fn contribute(env: Env, group_id: u32, member: Address) {
        member.require_auth();

        require_group_exists(&env, group_id);
        let group = load_group(&env, group_id);

        require_active(&env, &group);
        require_member(&env, &group, &member);
        require_not_contributed(&env, group_id, &member);
        require_before_deadline(&env, &group);

        cycle::record_contribution(&env, group_id, group, &member);
    }

    // -----------------------------------------------------------------------
    // Cycle Management
    // -----------------------------------------------------------------------

    /// Close the current cycle and send the payout to the designated recipient.
    ///
    /// Can be called by the AI agent, admin, or any member after the deadline.
    /// Automatically advances to the next cycle or marks the group as Completed.
    /// Awards reputation completion bonuses to every member who contributed.
    ///
    /// # Returns
    /// The address of the member who received the payout
    pub fn close_cycle(env: Env, caller: Address, group_id: u32) -> Address {
        caller.require_auth();

        require_group_exists(&env, group_id);
        let group = load_group(&env, group_id);

        require_active(&env, &group);
        require_after_deadline(&env, &group);

        cycle::close_cycle(&env, group_id, group)
    }

    /// Flag a member who missed the cycle deadline as defaulted.
    ///
    /// Records the default in the reputation contract (if configured), which
    /// deducts score, records the debt owed to the cycle's payout recipient,
    /// and applies a lockout on the third+ default.
    ///
    /// Can only be called after the cycle deadline has passed.
    /// Can be called by admin or AI agent.
    pub fn flag_default(env: Env, caller: Address, group_id: u32, member: Address) {
        caller.require_auth();

        require_group_exists(&env, group_id);
        let group = load_group(&env, group_id);

        require_active(&env, &group);
        require_member(&env, &group, &member);
        require_after_deadline(&env, &group);
        require_not_contributed_for_default(&env, group_id, &member);

        cycle::flag_default(&env, group_id, group, &member);
    }

    // -----------------------------------------------------------------------
    // ZK Commitment
    // -----------------------------------------------------------------------

    /// Store a ZK commitment for a member after honest cycle completion.
    ///
    /// Called by the member from their device after a cycle closes.
    /// The commitment = poseidon(wallet_address, cycles_completed), computed
    /// client-side where the private wallet_address is known.
    ///
    /// This commitment is the on-chain anchor used when generating a ZK proof
    /// to prove participation history to a new group.
    pub fn store_commitment(
        env: Env,
        group_id: u32,
        member: Address,
        commitment: BytesN<32>,
    ) {
        member.require_auth();

        require_group_exists(&env, group_id);
        let group = load_group(&env, group_id);

        require_member(&env, &group, &member);

        cycle::store_commitment_for_member(&env, group_id, &member, commitment);
    }

    // -----------------------------------------------------------------------
    // Read-Only Queries
    // -----------------------------------------------------------------------

    /// Return the full group state — used by the frontend dashboard and AI agent
    pub fn get_group(env: Env, group_id: u32) -> Group {
        require_group_exists(&env, group_id);
        load_group(&env, group_id)
    }

    /// Check whether a member has contributed in the current cycle
    pub fn has_contributed(env: Env, group_id: u32, member: Address) -> bool {
        require_group_exists(&env, group_id);
        has_contributed(&env, group_id, &member)
    }

    /// Return the ZK commitment stored for a member, if any
    pub fn get_commitment(
        env: Env,
        group_id: u32,
        member: Address,
    ) -> Option<BytesN<32>> {
        require_group_exists(&env, group_id);
        load_commitment(&env, group_id, &member)
    }

    /// Return the current cycle number for a group
    pub fn current_cycle(env: Env, group_id: u32) -> u32 {
        require_group_exists(&env, group_id);
        load_group(&env, group_id).current_cycle
    }

    /// Return the ledger number when the current cycle deadline expires
    pub fn cycle_deadline(env: Env, group_id: u32) -> u32 {
        require_group_exists(&env, group_id);
        let group = load_group(&env, group_id);
        group.cycle_start_ledger + group.cycle_duration_ledgers
    }
}
