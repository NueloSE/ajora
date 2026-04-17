#![no_std]

mod cycle;
mod events;
pub mod storage;
mod validation;

use soroban_sdk::{
    contract, contractimpl, Address, BytesN, Env, Vec,
};

use storage::{
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
};

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
        };

        save_group(&env, group_id, &group);
        events::group_created(&env, group_id, &admin, max_members, contribution_amount);

        group_id
    }

    /// Join an existing group that is still forming.
    ///
    /// Each new member is appended to the members list and assigned
    /// a payout position. When the last member joins, the group
    /// automatically transitions to Active and the first cycle starts.
    pub fn join_group(env: Env, group_id: u32, member: Address) {
        member.require_auth();

        require_group_exists(&env, group_id);
        let mut group = load_group(&env, group_id);

        require_forming(&env, &group);
        require_not_full(&env, &group);
        require_not_member(&env, &group, &member);

        let position = group.members.len();
        group.members.push_back(member.clone());
        group.payout_order.push_back(member.clone());

        events::member_joined(&env, group_id, &member, position);

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
    /// Records the default permanently on-chain via an event.
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

        cycle::flag_default(&env, group_id, &group, &member);
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
