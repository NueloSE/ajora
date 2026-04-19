use soroban_sdk::{Address, Env, contracterror, panic_with_error};
use crate::storage::{
    is_initialized, load_admin, member_has_unpaid_debt,
    member_is_locked, load_score, load_active_groups, max_groups_for_score,
};

// ---------------------------------------------------------------------------
// Contract Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    /// Contract has not been initialised yet
    NotInitialized        = 1,
    /// Contract has already been initialised
    AlreadyInitialized    = 2,
    /// Caller is not the contract admin
    NotAdmin              = 3,
    /// Member is currently locked out (third+ default, within 6-month window)
    MemberLocked          = 4,
    /// Member has at least one unpaid debt — must repay before joining
    HasUnpaidDebt         = 5,
    /// Member's score is below the group's minimum requirement
    ScoreTooLow           = 6,
    /// Member has reached the maximum number of active groups for their score
    GroupLimitReached     = 7,
    /// The specified debt record was not found (wrong group_id or cycle)
    DebtNotFound          = 8,
    /// The specified debt has already been repaid
    DebtAlreadyPaid       = 9,
    /// Active group count is already 0 — cannot decrement further
    ActiveGroupsUnderflow = 10,
}

// ---------------------------------------------------------------------------
// Guard Functions
// ---------------------------------------------------------------------------

pub fn require_initialized(env: &Env) {
    if !is_initialized(env) {
        panic_with_error!(env, Error::NotInitialized);
    }
}

pub fn require_not_initialized(env: &Env) {
    if is_initialized(env) {
        panic_with_error!(env, Error::AlreadyInitialized);
    }
}

#[allow(dead_code)]
pub fn require_admin(env: &Env, caller: &Address) {
    let admin = load_admin(env);
    if caller != &admin {
        panic_with_error!(env, Error::NotAdmin);
    }
}

/// Full join eligibility check — called by rotating_savings before join_group.
/// Checks in order: lockout → unpaid debt → score vs min_score → group limit.
#[allow(dead_code)]
pub fn require_can_join(env: &Env, member: &Address, min_score: u32) {
    // 1. Lockout check
    if member_is_locked(env, member) {
        panic_with_error!(env, Error::MemberLocked);
    }

    // 2. Unpaid debt check
    if member_has_unpaid_debt(env, member) {
        panic_with_error!(env, Error::HasUnpaidDebt);
    }

    let score = load_score(env, member);

    // 3. Score vs group minimum
    //    min_score == 0 means re-entry group — open to all non-locked, debt-free members
    if min_score > 0 && score < min_score {
        panic_with_error!(env, Error::ScoreTooLow);
    }

    // 4. Active group limit for their score band
    let max_groups = max_groups_for_score(score, min_score);
    if max_groups == 0 {
        // score < 60 and not a re-entry group
        panic_with_error!(env, Error::ScoreTooLow);
    }

    let active = load_active_groups(env, member);
    if active >= max_groups {
        panic_with_error!(env, Error::GroupLimitReached);
    }
}
