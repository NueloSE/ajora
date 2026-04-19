use soroban_sdk::{Address, Env, symbol_short};

// ---------------------------------------------------------------------------
// Reputation Contract Events
// ---------------------------------------------------------------------------

/// Emitted when the reputation contract is initialised
pub fn initialized(env: &Env, admin: &Address) {
    env.events().publish(
        (symbol_short!("rep_init"),),
        admin.clone(),
    );
}

/// Emitted when a default is recorded for a member
pub fn default_recorded(
    env: &Env,
    debtor:   &Address,
    creditor: &Address,
    group_id: u32,
    cycle:    u32,
    new_score: u32,
) {
    env.events().publish(
        (symbol_short!("def_rec"), debtor.clone()),
        (creditor.clone(), group_id, cycle, new_score),
    );
}

/// Emitted when a member is locked out after third+ default
pub fn member_locked(env: &Env, member: &Address, locked_until_ledger: u64) {
    env.events().publish(
        (symbol_short!("lockout"), member.clone()),
        locked_until_ledger,
    );
}

/// Emitted when a member completes a cycle honestly
pub fn cycle_completed(env: &Env, member: &Address, new_score: u32, bonus: u32) {
    env.events().publish(
        (symbol_short!("cyc_done"), member.clone()),
        (new_score, bonus),
    );
}

/// Emitted when a debt is repaid
pub fn debt_repaid(
    env:      &Env,
    debtor:   &Address,
    creditor: &Address,
    group_id: u32,
    cycle:    u32,
    amount:   i128,
    new_score: u32,
) {
    env.events().publish(
        (symbol_short!("debt_rep"), debtor.clone()),
        (creditor.clone(), group_id, cycle, amount, new_score),
    );
}

/// Emitted when a member's active group count changes
pub fn active_groups_changed(env: &Env, member: &Address, count: u32) {
    env.events().publish(
        (symbol_short!("act_chg"), member.clone()),
        count,
    );
}
