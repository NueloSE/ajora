use soroban_sdk::{Address, BytesN, Env, symbol_short};

// ---------------------------------------------------------------------------
// Contract Events
// ---------------------------------------------------------------------------

/// Emitted when the contract is initialised with a verification key
pub fn vk_initialised(env: &Env, admin: &Address) {
    env.events().publish(
        (symbol_short!("zk_init"), admin.clone()),
        (),
    );
}

/// Emitted when a valid proof is submitted and verified
///
/// Public inputs are included so any observer can independently
/// confirm what was proven:
///   - member:            who holds this credit history
///   - group_id:          which group's commitment was used
///   - group_commitment:  the on-chain anchor (poseidon hash)
///   - cycles_claimed:    how many cycles the proof covers
pub fn proof_verified(
    env: &Env,
    member: &Address,
    group_id: u32,
    group_commitment: &BytesN<32>,
    cycles_claimed: u32,
) {
    env.events().publish(
        (symbol_short!("zk_valid"), member.clone()),
        (group_id, group_commitment.clone(), cycles_claimed),
    );
}

/// Emitted when a proof submission fails verification
/// Helps the frontend and agent detect invalid attempts
pub fn proof_rejected(env: &Env, member: &Address, group_id: u32) {
    env.events().publish(
        (symbol_short!("zk_fail"), member.clone()),
        group_id,
    );
}

/// Emitted when a new group queries whether a member holds valid ZK credit
pub fn credit_checked(env: &Env, checker: &Address, member: &Address, group_id: u32, result: bool) {
    env.events().publish(
        (symbol_short!("zk_chk"), member.clone()),
        (checker.clone(), group_id, result),
    );
}
