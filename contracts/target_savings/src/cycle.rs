use soroban_sdk::{Address, BytesN, Env, token};
use crate::storage::{
    SavingsPool, PoolStatus,
    save_pool,
    set_contributed, clear_contributions,
    add_to_balance, get_balance,
    mark_withdrawn, save_commitment,
};
use crate::events;

// ---------------------------------------------------------------------------
// Cycle Logic
// ---------------------------------------------------------------------------
// Key difference from rotating_savings:
//   - There is NO shared payout pool. Each member saves for themselves.
//   - `record_contribution` adds to the MEMBER'S OWN balance.
//   - `close_cycle` just advances the counter — no transfer to a recipient.
//   - `withdraw` is the only outbound transfer, and only after pool matures.
// ---------------------------------------------------------------------------

/// Record a member's contribution for the current cycle.
///
/// Transfers USDC from member into the contract and increments
/// their personal savings balance.
pub fn record_contribution(env: &Env, pool_id: u32, pool: &SavingsPool, member: &Address) {
    // Pull USDC from member into contract
    let token_client = token::Client::new(env, &pool.token);
    token_client.transfer(
        member,
        &env.current_contract_address(),
        &pool.contribution_amount,
    );

    // Mark contributed this cycle
    set_contributed(env, pool_id, member);

    // Add to their personal running balance
    add_to_balance(env, pool_id, member, pool.contribution_amount);

    let new_balance = get_balance(env, pool_id, member);

    events::contribution_made(
        env,
        pool_id,
        member,
        pool.current_cycle,
        pool.contribution_amount,
        new_balance,
    );
}

/// Close the current cycle.
///
/// Unlike rotating_savings, there is no payout here.
/// This function just:
///   - Clears contribution flags for the next cycle
///   - Advances the cycle counter
///   - Transitions to Matured when all cycles complete
pub fn close_cycle(env: &Env, pool_id: u32, mut pool: SavingsPool) {
    let closing_cycle = pool.current_cycle;

    // Clear contribution flags so next cycle starts fresh
    clear_contributions(env, pool_id, &pool.members);

    pool.current_cycle += 1;

    if pool.current_cycle >= pool.total_cycles {
        // All cycles complete — unlock withdrawals
        pool.status = PoolStatus::Matured;
        save_pool(env, pool_id, &pool);
        events::pool_matured(env, pool_id);
    } else {
        // Start next cycle
        pool.cycle_start_ledger = env.ledger().sequence();
        save_pool(env, pool_id, &pool);
        events::cycle_closed(env, pool_id, closing_cycle);
    }
}

/// Withdraw a member's full accumulated savings after the pool matures.
///
/// This is a one-time operation. The member receives exactly what
/// they contributed across all completed cycles — no more, no less.
/// If they defaulted in some cycles, their balance is proportionally lower.
pub fn withdraw(env: &Env, pool_id: u32, pool: &SavingsPool, member: &Address) {
    let balance = get_balance(env, pool_id, member);

    // Transfer the member's full balance out of the contract
    let token_client = token::Client::new(env, &pool.token);
    token_client.transfer(
        &env.current_contract_address(),
        member,
        &balance,
    );

    // Mark withdrawn so this cannot be called again
    mark_withdrawn(env, pool_id, member);

    events::withdrawal_made(env, pool_id, member, balance);
}

/// Flag a member as defaulted when they miss the cycle deadline.
pub fn flag_default(env: &Env, pool_id: u32, pool: &SavingsPool, member: &Address) {
    events::member_defaulted(env, pool_id, member, pool.current_cycle);
}

/// Store a ZK commitment for a member.
/// Same pattern as rotating_savings — called by the member from their device.
pub fn store_commitment_for_member(
    env: &Env,
    pool_id: u32,
    member: &Address,
    commitment: BytesN<32>,
) {
    save_commitment(env, pool_id, member, commitment.clone());
    events::commitment_stored(env, pool_id, member, &commitment);
}
