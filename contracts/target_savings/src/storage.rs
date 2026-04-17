use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Pool metadata keyed by pool_id
    Pool(u32),
    /// Running counter for unique pool IDs
    PoolCount,
    /// Whether a member has contributed in the current cycle
    /// Temporary storage — cleared each cycle
    Contributed(u32, Address),
    /// Accumulated savings balance per member
    /// Grows by contribution_amount each honest cycle
    MemberBalance(u32, Address),
    /// Whether a member has already withdrawn their savings
    /// One-time flag — withdrawal is irreversible
    Withdrawn(u32, Address),
    /// ZK commitment anchor per member
    Commitment(u32, Address),
}

// ---------------------------------------------------------------------------
// Core Data Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum PoolStatus {
    /// Accepting new members, not yet started
    Forming,
    /// Contributions active, withdrawals locked
    Active,
    /// All cycles done — withdrawals now open
    Matured,
    /// Admin cancelled
    Cancelled,
}

/// Full pool record stored on-chain
#[contracttype]
#[derive(Clone)]
pub struct SavingsPool {
    /// Account that created the pool
    pub admin: Address,
    /// Current members
    pub members: Vec<Address>,
    /// Maximum number of members
    pub max_members: u32,
    /// Fixed USDC contribution amount per cycle in stroops
    pub contribution_amount: i128,
    /// How many ledgers between each cycle close
    pub cycle_duration_ledgers: u32,
    /// Total number of cycles before withdrawal unlocks
    pub total_cycles: u32,
    /// Current cycle index (0-based)
    pub current_cycle: u32,
    /// Ledger number when the current cycle started
    pub cycle_start_ledger: u32,
    /// Current lifecycle status
    pub status: PoolStatus,
    /// USDC token contract address
    pub token: Address,
}

// ---------------------------------------------------------------------------
// Pool Storage Helpers
// ---------------------------------------------------------------------------

pub fn next_pool_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::PoolCount)
        .unwrap_or(0);
    let next = count + 1;
    env.storage().persistent().set(&DataKey::PoolCount, &next);
    next
}

pub fn save_pool(env: &Env, pool_id: u32, pool: &SavingsPool) {
    env.storage()
        .persistent()
        .set(&DataKey::Pool(pool_id), pool);
}

pub fn load_pool(env: &Env, pool_id: u32) -> SavingsPool {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(pool_id))
        .expect("Pool not found")
}

pub fn pool_exists(env: &Env, pool_id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Pool(pool_id))
}

// ---------------------------------------------------------------------------
// Contribution Flag Helpers
// ---------------------------------------------------------------------------

pub fn set_contributed(env: &Env, pool_id: u32, member: &Address) {
    let key = DataKey::Contributed(pool_id, member.clone());
    env.storage().temporary().set(&key, &true);
    env.storage().temporary().extend_ttl(&key, 200_000, 200_000);
}

pub fn has_contributed(env: &Env, pool_id: u32, member: &Address) -> bool {
    env.storage()
        .temporary()
        .get(&DataKey::Contributed(pool_id, member.clone()))
        .unwrap_or(false)
}

pub fn clear_contributions(env: &Env, pool_id: u32, members: &Vec<Address>) {
    for member in members.iter() {
        env.storage()
            .temporary()
            .remove(&DataKey::Contributed(pool_id, member.clone()));
    }
}

// ---------------------------------------------------------------------------
// Member Balance Helpers
// ---------------------------------------------------------------------------
// Unlike rotating savings, each member accumulates their own balance.
// The contract holds all funds; balances are accounting entries.

/// Add one cycle's contribution to the member's running balance
pub fn add_to_balance(env: &Env, pool_id: u32, member: &Address, amount: i128) {
    let key = DataKey::MemberBalance(pool_id, member.clone());
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(current + amount));
}

/// Read a member's total accumulated balance
pub fn get_balance(env: &Env, pool_id: u32, member: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::MemberBalance(pool_id, member.clone()))
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Withdrawal Flag Helpers
// ---------------------------------------------------------------------------

pub fn mark_withdrawn(env: &Env, pool_id: u32, member: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Withdrawn(pool_id, member.clone()), &true);
}

pub fn has_withdrawn(env: &Env, pool_id: u32, member: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Withdrawn(pool_id, member.clone()))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// ZK Commitment Helpers
// ---------------------------------------------------------------------------

pub fn save_commitment(env: &Env, pool_id: u32, member: &Address, commitment: BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Commitment(pool_id, member.clone()), &commitment);
}

pub fn load_commitment(env: &Env, pool_id: u32, member: &Address) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::Commitment(pool_id, member.clone()))
}
