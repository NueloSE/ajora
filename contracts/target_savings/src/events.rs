use soroban_sdk::{Address, BytesN, Env, symbol_short};

// ---------------------------------------------------------------------------
// Contract Events
// ---------------------------------------------------------------------------

/// Emitted when a new target savings pool is created
pub fn pool_created(
    env: &Env,
    pool_id: u32,
    admin: &Address,
    max_members: u32,
    contribution_amount: i128,
    total_cycles: u32,
) {
    env.events().publish(
        (symbol_short!("pool_new"), pool_id),
        (admin.clone(), max_members, contribution_amount, total_cycles),
    );
}

/// Emitted when a member joins a forming pool
pub fn member_joined(env: &Env, pool_id: u32, member: &Address) {
    env.events().publish(
        (symbol_short!("pl_join"), pool_id),
        member.clone(),
    );
}

/// Emitted when a pool transitions from Forming → Active
pub fn pool_activated(env: &Env, pool_id: u32) {
    env.events().publish(
        (symbol_short!("pl_live"), pool_id),
        (),
    );
}

/// Emitted when a member contributes for the current cycle
pub fn contribution_made(
    env: &Env,
    pool_id: u32,
    member: &Address,
    cycle: u32,
    amount: i128,
    new_balance: i128,
) {
    env.events().publish(
        (symbol_short!("pl_ctrib"), pool_id),
        (member.clone(), cycle, amount, new_balance),
    );
}

/// Emitted when a cycle closes and the cycle counter advances
pub fn cycle_closed(env: &Env, pool_id: u32, cycle: u32) {
    env.events().publish(
        (symbol_short!("pl_close"), pool_id),
        cycle,
    );
}

/// Emitted when all cycles complete and the pool matures
/// After this event, members can call withdraw
pub fn pool_matured(env: &Env, pool_id: u32) {
    env.events().publish(
        (symbol_short!("pl_done"), pool_id),
        (),
    );
}

/// Emitted when a member withdraws their full accumulated savings
pub fn withdrawal_made(env: &Env, pool_id: u32, member: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("pl_wdraw"), pool_id),
        (member.clone(), amount),
    );
}

/// Emitted when a member misses the cycle deadline
pub fn member_defaulted(env: &Env, pool_id: u32, member: &Address, cycle: u32) {
    env.events().publish(
        (symbol_short!("pl_dflt"), pool_id),
        (member.clone(), cycle),
    );
}

/// Emitted when a ZK commitment is stored for a member
pub fn commitment_stored(env: &Env, pool_id: u32, member: &Address, commitment: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("pl_zk"), pool_id),
        (member.clone(), commitment.clone()),
    );
}
