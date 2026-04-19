#![allow(unused)]

use soroban_sdk::{contracttype, Address, Map, Vec, BytesN, Env, Symbol, symbol_short};

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------
// Each variant maps to a unique slot in contract persistent storage.

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Group metadata keyed by group_id
    Group(u32),
    /// Running counter — used to generate unique group IDs
    GroupCount,
    /// Whether a specific member has contributed in the current cycle
    /// Key: (group_id, member_address)
    Contributed(u32, Address),
    /// On-chain Poseidon commitment for a member after cycle completion
    /// Key: (group_id, member_address)
    /// Value: the commitment hash used as the ZK anchor
    Commitment(u32, Address),
    /// Reputation score captured at join time for re-entry members.
    /// Used to maintain payout ordering: lowest score = paid last.
    /// Key: (group_id, member_address)
    ReentryScore(u32, Address),
}

// ---------------------------------------------------------------------------
// Core Data Types
// ---------------------------------------------------------------------------

/// The lifecycle state of a group
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum GroupStatus {
    /// Accepting new members, not yet started
    Forming,
    /// Contributions and payouts are active
    Active,
    /// All cycles completed — group is done
    Completed,
    /// Admin cancelled or irrecoverable default
    Cancelled,
}

/// Full group record stored on-chain
#[contracttype]
#[derive(Clone)]
pub struct Group {
    /// Account that created the group
    pub admin: Address,
    /// Ordered list of members (join order — NOT payout order)
    pub members: Vec<Address>,
    /// Max number of members allowed (set at creation)
    pub max_members: u32,
    /// USDC contribution amount per cycle in stroops (1 USDC = 10_000_000)
    pub contribution_amount: i128,
    /// How many ledgers between each cycle close
    /// Testnet: ~5 sec/ledger. 1 week ≈ 120_960 ledgers
    pub cycle_duration_ledgers: u32,
    /// Payout order — index matches cycle number.
    /// Layout: [normal members in join order | re-entry members, highest score first]
    pub payout_order: Vec<Address>,
    /// Which cycle we are currently on (0-indexed)
    pub current_cycle: u32,
    /// Total number of cycles = number of members
    pub total_cycles: u32,
    /// Ledger number when the current cycle started
    pub cycle_start_ledger: u32,
    /// Current lifecycle status
    pub status: GroupStatus,
    /// USDC token contract address used for contributions
    pub token: Address,
    /// Minimum reputation score to join this group.
    /// 0 = re-entry group (open to everyone not locked/indebted, including score < 60).
    pub min_score: u32,
    /// Reputation contract address — None means no reputation tracking.
    pub reputation_contract: Option<Address>,
    /// Number of normal (non-re-entry) members currently in payout_order.
    /// Re-entry members are inserted starting at this index.
    pub normal_member_count: u32,
}

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------
// Thin wrappers around env.storage() so the rest of the contract
// never calls storage directly — all access goes through these functions.

const GROUP_COUNT_KEY: &str = "GC";

/// Increment and return the next group ID
pub fn next_group_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::GroupCount)
        .unwrap_or(0);
    let next = count + 1;
    env.storage()
        .persistent()
        .set(&DataKey::GroupCount, &next);
    next
}

/// Persist a group record
pub fn save_group(env: &Env, group_id: u32, group: &Group) {
    env.storage()
        .persistent()
        .set(&DataKey::Group(group_id), group);
}

/// Load a group record — panics if not found (caller must validate group_id first)
pub fn load_group(env: &Env, group_id: u32) -> Group {
    env.storage()
        .persistent()
        .get(&DataKey::Group(group_id))
        .expect("Group not found")
}

/// Returns true if a group with this ID exists
pub fn group_exists(env: &Env, group_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Group(group_id))
}

/// Mark a member as having contributed this cycle.
/// TTL is set to 200_000 ledgers (~11 days) — well beyond any reasonable cycle length.
pub fn set_contributed(env: &Env, group_id: u32, member: &Address) {
    let key = DataKey::Contributed(group_id, member.clone());
    env.storage().temporary().set(&key, &true);
    // Extend TTL so the entry survives for the entire cycle + buffer
    env.storage().temporary().extend_ttl(&key, 200_000, 200_000);
}

/// Check whether a member has contributed in the current cycle
pub fn has_contributed(env: &Env, group_id: u32, member: &Address) -> bool {
    env.storage()
        .temporary()
        .get(&DataKey::Contributed(group_id, member.clone()))
        .unwrap_or(false)
}

/// Clear contribution flags for all members at cycle close
/// Called once per cycle so fresh flags start the next cycle
pub fn clear_contributions(env: &Env, group_id: u32, members: &Vec<Address>) {
    for member in members.iter() {
        env.storage()
            .temporary()
            .remove(&DataKey::Contributed(group_id, member.clone()));
    }
}

/// Store the ZK commitment for a member after honest cycle completion
/// commitment = poseidon(wallet_address, cycles_completed) — computed off-chain,
/// stored here as the on-chain anchor for ZK proof verification
pub fn save_commitment(env: &Env, group_id: u32, member: &Address, commitment: BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(group_id, member.clone()), &commitment);
}

/// Load the stored ZK commitment for a member
pub fn load_commitment(env: &Env, group_id: u32, member: &Address) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::Commitment(group_id, member.clone()))
}

/// Save the reputation score of a re-entry member at join time.
/// This score is used to maintain payout ordering within the re-entry section.
pub fn save_reentry_score(env: &Env, group_id: u32, member: &Address, score: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::ReentryScore(group_id, member.clone()), &score);
}

/// Load a re-entry member's score as captured at join time.
/// Returns 0 if no entry (should not happen for valid re-entry members).
pub fn load_reentry_score(env: &Env, group_id: u32, member: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ReentryScore(group_id, member.clone()))
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Payout Order Helpers
// ---------------------------------------------------------------------------

/// Rebuild a Vec<Address> with `item` inserted at `pos`.
/// Soroban Vec has no insert method, so we reconstruct the entire Vec.
pub fn insert_address_at(
    env: &Env,
    vec: &Vec<Address>,
    pos: u32,
    item: Address,
) -> Vec<Address> {
    let mut new_vec: Vec<Address> = Vec::new(env);
    let len = vec.len();
    for i in 0..pos {
        new_vec.push_back(vec.get(i).unwrap());
    }
    new_vec.push_back(item);
    for i in pos..len {
        new_vec.push_back(vec.get(i).unwrap());
    }
    new_vec
}

/// Remove the element at `idx` from a Vec<Address> and append it to the end.
/// Used when a defaulter's future payout slot is moved to last position.
pub fn move_to_last(env: &Env, vec: &Vec<Address>, idx: u32) -> Vec<Address> {
    let item = vec.get(idx).unwrap();
    let mut new_vec: Vec<Address> = Vec::new(env);
    let len = vec.len();
    for i in 0..len {
        if i != idx {
            new_vec.push_back(vec.get(i).unwrap());
        }
    }
    new_vec.push_back(item);
    new_vec
}

/// Find the correct insertion position for a new re-entry member in the
/// re-entry section of `payout_order`.
///
/// Re-entry section starts at index `normal_count`. Within that section,
/// members are ordered by score descending (highest score first = paid
/// soonest among re-entry members, lowest score last = paid last of all).
///
/// Returns the index at which to insert the new member.
pub fn find_reentry_insert_pos(
    env: &Env,
    group_id: u32,
    payout_order: &Vec<Address>,
    normal_count: u32,
    new_score: u32,
) -> u32 {
    let len = payout_order.len();
    for i in normal_count..len {
        let existing_addr = payout_order.get(i).unwrap();
        let existing_score = load_reentry_score(env, group_id, &existing_addr);
        // Insert before the first member who has a lower score
        if existing_score < new_score {
            return i;
        }
    }
    // New member has the lowest score — append after all existing re-entry members
    len
}
