#![allow(dead_code)]

use soroban_sdk::{Address, Env, panic_with_error, contracterror};
use crate::storage::{SavingsPool, PoolStatus, pool_exists, has_contributed, has_withdrawn};

// ---------------------------------------------------------------------------
// Contract Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    PoolNotFound          = 1,
    InvalidPoolStatus     = 2,
    NotAMember            = 3,
    NotAdmin              = 4,
    PoolFull              = 5,
    AlreadyMember         = 6,
    AlreadyContributed    = 7,
    WrongAmount           = 8,
    CycleNotOver          = 9,
    DeadlinePassed        = 10,
    PoolNotMatured        = 11,
    AlreadyWithdrawn      = 12,
    NothingToWithdraw     = 13,
    MemberContributed     = 14,
}

// ---------------------------------------------------------------------------
// Guard Functions
// ---------------------------------------------------------------------------

pub fn require_pool_exists(env: &Env, pool_id: u32) {
    if !pool_exists(env, pool_id) {
        panic_with_error!(env, Error::PoolNotFound);
    }
}

pub fn require_forming(env: &Env, pool: &SavingsPool) {
    if pool.status != PoolStatus::Forming {
        panic_with_error!(env, Error::InvalidPoolStatus);
    }
}

pub fn require_active(env: &Env, pool: &SavingsPool) {
    if pool.status != PoolStatus::Active {
        panic_with_error!(env, Error::InvalidPoolStatus);
    }
}

/// Pool must be Matured before withdrawals are allowed
pub fn require_matured(env: &Env, pool: &SavingsPool) {
    if pool.status != PoolStatus::Matured {
        panic_with_error!(env, Error::PoolNotMatured);
    }
}

pub fn require_admin(env: &Env, pool: &SavingsPool, caller: &Address) {
    if &pool.admin != caller {
        panic_with_error!(env, Error::NotAdmin);
    }
}

pub fn require_member(env: &Env, pool: &SavingsPool, address: &Address) {
    let is_member = pool.members.iter().any(|m| &m == address);
    if !is_member {
        panic_with_error!(env, Error::NotAMember);
    }
}

pub fn require_not_member(env: &Env, pool: &SavingsPool, address: &Address) {
    let already = pool.members.iter().any(|m| &m == address);
    if already {
        panic_with_error!(env, Error::AlreadyMember);
    }
}

pub fn require_not_full(env: &Env, pool: &SavingsPool) {
    if pool.members.len() >= pool.max_members {
        panic_with_error!(env, Error::PoolFull);
    }
}

pub fn require_not_contributed(env: &Env, pool_id: u32, member: &Address) {
    if has_contributed(env, pool_id, member) {
        panic_with_error!(env, Error::AlreadyContributed);
    }
}

pub fn require_before_deadline(env: &Env, pool: &SavingsPool) {
    let deadline = pool.cycle_start_ledger + pool.cycle_duration_ledgers;
    if env.ledger().sequence() >= deadline {
        panic_with_error!(env, Error::DeadlinePassed);
    }
}

pub fn require_after_deadline(env: &Env, pool: &SavingsPool) {
    let deadline = pool.cycle_start_ledger + pool.cycle_duration_ledgers;
    if env.ledger().sequence() < deadline {
        panic_with_error!(env, Error::CycleNotOver);
    }
}

/// Member must not have already withdrawn — withdrawal is one-time only
pub fn require_not_withdrawn(env: &Env, pool_id: u32, member: &Address) {
    if has_withdrawn(env, pool_id, member) {
        panic_with_error!(env, Error::AlreadyWithdrawn);
    }
}

/// Member who contributed cannot be flagged as defaulted
pub fn require_not_contributed_for_default(env: &Env, pool_id: u32, member: &Address) {
    if has_contributed(env, pool_id, member) {
        panic_with_error!(env, Error::MemberContributed);
    }
}
