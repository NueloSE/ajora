use soroban_sdk::{Address, BytesN, Env, symbol_short};

// ---------------------------------------------------------------------------
// Contract Events
// ---------------------------------------------------------------------------
// Every significant state change emits an event.
// Frontend and AI agent listen to these to update UI and trigger actions.
//
// Event structure: env.events().publish((topic1, topic2), data)
// Topics are indexed for filtering. Data is the event payload.
// ---------------------------------------------------------------------------

/// Emitted when a new rotating savings group is created
pub fn group_created(env: &Env, group_id: u32, admin: &Address, max_members: u32, contribution_amount: i128) {
    env.events().publish(
        (symbol_short!("grp_new"), group_id),
        (admin.clone(), max_members, contribution_amount),
    );
}

/// Emitted when a member successfully joins a group
pub fn member_joined(env: &Env, group_id: u32, member: &Address, payout_position: u32) {
    env.events().publish(
        (symbol_short!("grp_join"), group_id),
        (member.clone(), payout_position),
    );
}

/// Emitted when a group transitions from Forming → Active
/// Triggered when the group reaches max_members
pub fn group_activated(env: &Env, group_id: u32) {
    env.events().publish(
        (symbol_short!("grp_live"), group_id),
        (),
    );
}

/// Emitted when a member makes their contribution for the current cycle
pub fn contribution_made(env: &Env, group_id: u32, member: &Address, cycle: u32, amount: i128) {
    env.events().publish(
        (symbol_short!("contrib"), group_id),
        (member.clone(), cycle, amount),
    );
}

/// Emitted when a cycle closes and payout is sent to the recipient
pub fn payout_sent(env: &Env, group_id: u32, recipient: &Address, cycle: u32, amount: i128) {
    env.events().publish(
        (symbol_short!("payout"), group_id),
        (recipient.clone(), cycle, amount),
    );
}

/// Emitted when a member defaults (deadline passed, no contribution)
pub fn member_defaulted(env: &Env, group_id: u32, member: &Address, cycle: u32) {
    env.events().publish(
        (symbol_short!("default"), group_id),
        (member.clone(), cycle),
    );
}

/// Emitted when a ZK commitment is stored for a member after honest cycle completion
/// The commitment hash is the public anchor used later for ZK proof generation
pub fn commitment_stored(env: &Env, group_id: u32, member: &Address, commitment: &BytesN<32>) {
    env.events().publish(
        (symbol_short!("zk_commit"), group_id),
        (member.clone(), commitment.clone()),
    );
}

/// Emitted when the final cycle completes and the group is fully done
pub fn group_completed(env: &Env, group_id: u32) {
    env.events().publish(
        (symbol_short!("grp_done"), group_id),
        (),
    );
}
