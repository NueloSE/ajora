#![no_std]

mod cycle;
mod events;
pub mod storage;
mod validation;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

use storage::{
    SavingsPool, PoolStatus,
    next_pool_id, save_pool, load_pool,
    get_balance, load_commitment, has_contributed,
};
use validation::{
    require_pool_exists, require_forming, require_active, require_matured,
    require_member, require_not_member, require_not_full,
    require_not_contributed, require_before_deadline, require_after_deadline,
    require_not_withdrawn, require_not_contributed_for_default,
};

// ---------------------------------------------------------------------------
// Contract Entry Point
// ---------------------------------------------------------------------------

#[contract]
pub struct TargetSavings;

#[contractimpl]
impl TargetSavings {

    // -----------------------------------------------------------------------
    // Pool Lifecycle
    // -----------------------------------------------------------------------

    /// Create a new target savings pool.
    ///
    /// # Arguments
    /// * `admin`                  - Account creating and managing the pool
    /// * `token`                  - USDC contract address
    /// * `contribution_amount`    - Fixed amount each member saves per cycle (in stroops)
    /// * `cycle_duration_ledgers` - Length of each cycle in ledgers
    /// * `total_cycles`           - Number of cycles before withdrawal unlocks
    /// * `max_members`            - Maximum number of members in the pool
    ///
    /// # Returns
    /// The new pool's unique ID
    pub fn create_pool(
        env: Env,
        admin: Address,
        token: Address,
        contribution_amount: i128,
        cycle_duration_ledgers: u32,
        total_cycles: u32,
        max_members: u32,
    ) -> u32 {
        admin.require_auth();

        let pool_id = next_pool_id(&env);

        let pool = SavingsPool {
            admin: admin.clone(),
            members: Vec::new(&env),
            max_members,
            contribution_amount,
            cycle_duration_ledgers,
            total_cycles,
            current_cycle: 0,
            cycle_start_ledger: 0,
            status: PoolStatus::Forming,
            token,
        };

        save_pool(&env, pool_id, &pool);
        events::pool_created(
            &env,
            pool_id,
            &admin,
            max_members,
            contribution_amount,
            total_cycles,
        );

        pool_id
    }

    /// Join a forming pool.
    ///
    /// When the pool reaches max_members it automatically activates
    /// and the first cycle begins.
    pub fn join_pool(env: Env, pool_id: u32, member: Address) {
        member.require_auth();

        require_pool_exists(&env, pool_id);
        let mut pool = load_pool(&env, pool_id);

        require_forming(&env, &pool);
        require_not_full(&env, &pool);
        require_not_member(&env, &pool, &member);

        pool.members.push_back(member.clone());
        events::member_joined(&env, pool_id, &member);

        // Auto-activate when pool is full
        if pool.members.len() >= pool.max_members {
            pool.status = PoolStatus::Active;
            pool.cycle_start_ledger = env.ledger().sequence();
            events::pool_activated(&env, pool_id);
        }

        save_pool(&env, pool_id, &pool);
    }

    // -----------------------------------------------------------------------
    // Contribution
    // -----------------------------------------------------------------------

    /// Contribute for the current cycle.
    ///
    /// Transfers `contribution_amount` USDC from the member's wallet
    /// into the contract and adds it to their personal savings balance.
    /// Requires pre-approval of this contract as a spender on the token.
    pub fn contribute(env: Env, pool_id: u32, member: Address) {
        member.require_auth();

        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);

        require_active(&env, &pool);
        require_member(&env, &pool, &member);
        require_not_contributed(&env, pool_id, &member);
        require_before_deadline(&env, &pool);

        cycle::record_contribution(&env, pool_id, &pool, &member);
    }

    // -----------------------------------------------------------------------
    // Cycle Management
    // -----------------------------------------------------------------------

    /// Close the current cycle and advance to the next one.
    ///
    /// Unlike rotating savings, no payout is sent here — each member's
    /// balance simply accumulates. When the final cycle closes the pool
    /// transitions to Matured and withdrawals become available.
    ///
    /// Can be called by admin, AI agent, or any member after the deadline.
    pub fn close_cycle(env: Env, caller: Address, pool_id: u32) {
        caller.require_auth();

        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);

        require_active(&env, &pool);
        require_after_deadline(&env, &pool);

        cycle::close_cycle(&env, pool_id, pool);
    }

    /// Flag a member who missed the cycle deadline as defaulted.
    ///
    /// Their balance for this cycle will simply not increase — they
    /// receive less at withdrawal time. The default is recorded on-chain.
    pub fn flag_default(env: Env, caller: Address, pool_id: u32, member: Address) {
        caller.require_auth();

        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);

        require_active(&env, &pool);
        require_member(&env, &pool, &member);
        require_after_deadline(&env, &pool);
        require_not_contributed_for_default(&env, pool_id, &member);

        cycle::flag_default(&env, pool_id, &pool, &member);
    }

    // -----------------------------------------------------------------------
    // Withdrawal
    // -----------------------------------------------------------------------

    /// Withdraw accumulated savings after the pool matures.
    ///
    /// The member receives the full balance they built up across all cycles
    /// they contributed to. This is a one-time, irreversible operation.
    ///
    /// If a member defaulted on some cycles, their balance is proportionally
    /// lower — they only receive what they actually contributed.
    pub fn withdraw(env: Env, pool_id: u32, member: Address) {
        member.require_auth();

        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);

        require_matured(&env, &pool);
        require_member(&env, &pool, &member);
        require_not_withdrawn(&env, pool_id, &member);

        cycle::withdraw(&env, pool_id, &pool, &member);
    }

    // -----------------------------------------------------------------------
    // ZK Commitment
    // -----------------------------------------------------------------------

    /// Store a ZK commitment after honest cycle participation.
    ///
    /// commitment = poseidon(wallet_address, cycles_completed),
    /// computed client-side and submitted by the member.
    pub fn store_commitment(
        env: Env,
        pool_id: u32,
        member: Address,
        commitment: BytesN<32>,
    ) {
        member.require_auth();

        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);

        require_member(&env, &pool, &member);

        cycle::store_commitment_for_member(&env, pool_id, &member, commitment);
    }

    // -----------------------------------------------------------------------
    // Read-Only Queries
    // -----------------------------------------------------------------------

    /// Return the full pool state
    pub fn get_pool(env: Env, pool_id: u32) -> SavingsPool {
        require_pool_exists(&env, pool_id);
        load_pool(&env, pool_id)
    }

    /// Return a member's current accumulated savings balance
    pub fn get_balance(env: Env, pool_id: u32, member: Address) -> i128 {
        require_pool_exists(&env, pool_id);
        get_balance(&env, pool_id, &member)
    }

    /// Check whether a member has contributed in the current cycle
    pub fn has_contributed(env: Env, pool_id: u32, member: Address) -> bool {
        require_pool_exists(&env, pool_id);
        has_contributed(&env, pool_id, &member)
    }

    /// Return the ZK commitment for a member, if any
    pub fn get_commitment(env: Env, pool_id: u32, member: Address) -> Option<BytesN<32>> {
        require_pool_exists(&env, pool_id);
        load_commitment(&env, pool_id, &member)
    }

    /// Return the current cycle number
    pub fn current_cycle(env: Env, pool_id: u32) -> u32 {
        require_pool_exists(&env, pool_id);
        load_pool(&env, pool_id).current_cycle
    }

    /// Return the ledger number when the current cycle deadline expires
    pub fn cycle_deadline(env: Env, pool_id: u32) -> u32 {
        require_pool_exists(&env, pool_id);
        let pool = load_pool(&env, pool_id);
        pool.cycle_start_ledger + pool.cycle_duration_ledgers
    }
}
