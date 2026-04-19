#![allow(unused)]

use soroban_sdk::{contracttype, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Constants — score mechanics
// ---------------------------------------------------------------------------

pub const SCORE_MAX:          u32 = 100;
pub const SCORE_FLOOR:        u32 = 0;
pub const COMPLETE_BONUS:     u32 = 5;   // honest cycle completion
pub const REENTRY_BONUS:      u32 = 10;  // honest cycle when score < 60
pub const REPAY_BONUS:        u32 = 8;   // per debt repaid
pub const DEFAULT_1_PENALTY:  u32 = 20;  // first default
pub const DEFAULT_2_PENALTY:  u32 = 25;  // second default
pub const DEFAULT_3_PENALTY:  u32 = 30;  // third+ default + lockout

/// ~6 months in ledgers (720 ledgers/hour × 24h × 180 days)
pub const LOCKOUT_LEDGERS: u64 = 720 * 24 * 180;

// ---------------------------------------------------------------------------
// Group limit bands
// ---------------------------------------------------------------------------
// Score 80–100 → max 2 active groups
// Score 60–79  → max 1 active group
// Score < 60   → cannot join (unless re-entry group, min_score = 0)
// Locked       → cannot join anything

pub const BAND_HIGH_MIN:  u32 = 80;
pub const BAND_MID_MIN:   u32 = 60;
pub const MAX_GROUPS_HIGH: u32 = 2;
pub const MAX_GROUPS_MID:  u32 = 1;
pub const MAX_GROUPS_REENTRY: u32 = 1; // re-entry members capped at 1

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Current reputation score for an address (u32, 0–100)
    Score(Address),
    /// Total number of defaults ever recorded for an address (u32)
    DefaultCount(Address),
    /// Ledger number when the lockout expires — 0 means not locked (u64)
    LockedUntil(Address),
    /// Number of savings groups this address is currently active in (u32)
    ActiveGroups(Address),
    /// All debt records for an address (Vec<DebtRecord>)
    Debts(Address),
    /// Contract administrator address
    Admin,
}

// ---------------------------------------------------------------------------
// Data Types
// ---------------------------------------------------------------------------

/// A single unpaid debt owed by a defaulting member to the cycle recipient
#[contracttype]
#[derive(Clone)]
pub struct DebtRecord {
    /// The address that was supposed to receive the payout that cycle
    pub creditor:  Address,
    /// Amount owed in stroops (same as group.contribution_amount)
    pub amount:    i128,
    /// Which savings group this debt originated from
    pub group_id:  u32,
    /// Which cycle within that group
    pub cycle:     u32,
    /// USDC token contract address — needed to execute repayment transfer
    pub token:     Address,
    /// True once the debtor has repaid this specific debt
    pub paid:      bool,
}

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

/// Store the admin address — called once during initialize()
pub fn save_admin(env: &Env, admin: &Address) {
    env.storage().persistent().set(&DataKey::Admin, admin);
}

/// Load the admin address
pub fn load_admin(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get(&DataKey::Admin)
        .expect("Not initialised")
}

/// Returns true if the contract has been initialised
pub fn is_initialized(env: &Env) -> bool {
    env.storage().persistent().has(&DataKey::Admin)
}

/// Load a member's reputation score — defaults to 100 for new members
pub fn load_score(env: &Env, member: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Score(member.clone()))
        .unwrap_or(SCORE_MAX)
}

/// Save a member's reputation score
pub fn save_score(env: &Env, member: &Address, score: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::Score(member.clone()), &score);
}

/// Load total default count for a member — 0 for new members
pub fn load_default_count(env: &Env, member: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::DefaultCount(member.clone()))
        .unwrap_or(0)
}

/// Save total default count for a member
pub fn save_default_count(env: &Env, member: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::DefaultCount(member.clone()), &count);
}

/// Load the lockout expiry ledger — 0 means not locked
pub fn load_locked_until(env: &Env, member: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::LockedUntil(member.clone()))
        .unwrap_or(0u64)
}

/// Save the lockout expiry ledger
pub fn save_locked_until(env: &Env, member: &Address, ledger: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::LockedUntil(member.clone()), &ledger);
}

/// Load the number of active groups a member is currently in — 0 for new
pub fn load_active_groups(env: &Env, member: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ActiveGroups(member.clone()))
        .unwrap_or(0)
}

/// Save the active group count for a member
pub fn save_active_groups(env: &Env, member: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::ActiveGroups(member.clone()), &count);
}

/// Load all debt records for a member — empty Vec for new members
pub fn load_debts(env: &Env, member: &Address) -> Vec<DebtRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Debts(member.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Save the full debt list for a member
pub fn save_debts(env: &Env, member: &Address, debts: &Vec<DebtRecord>) {
    env.storage()
        .persistent()
        .set(&DataKey::Debts(member.clone()), debts);
}

/// Return true if any debt record for this member is unpaid
pub fn member_has_unpaid_debt(env: &Env, member: &Address) -> bool {
    let debts = load_debts(env, member);
    debts.iter().any(|d| !d.paid)
}

/// Return true if the member is currently within a lockout period
pub fn member_is_locked(env: &Env, member: &Address) -> bool {
    let locked_until = load_locked_until(env, member);
    if locked_until == 0 {
        return false;
    }
    (env.ledger().sequence() as u64) < locked_until
}

/// Determine max active groups allowed based on score and whether the
/// group is a re-entry group (min_score == 0).
pub fn max_groups_for_score(score: u32, min_score: u32) -> u32 {
    if score >= BAND_HIGH_MIN {
        MAX_GROUPS_HIGH
    } else if score >= BAND_MID_MIN {
        MAX_GROUPS_MID
    } else if min_score == 0 {
        // Re-entry group — below-60 members allowed but capped at 1
        MAX_GROUPS_REENTRY
    } else {
        0 // cannot join non-re-entry groups
    }
}
