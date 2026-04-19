use soroban_sdk::{Address, Env, panic_with_error, contracterror};
use crate::storage::{Group, GroupStatus, group_exists, has_contributed};

// ---------------------------------------------------------------------------
// Contract Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    /// group_id does not exist
    GroupNotFound         = 1,
    /// Group is not in the expected status for this operation
    InvalidGroupStatus    = 2,
    /// Caller is not a member of this group
    NotAMember            = 3,
    /// Caller is not the group admin
    NotAdmin              = 4,
    /// Group has reached its maximum member count
    GroupFull             = 5,
    /// Address is already a member of this group
    AlreadyMember         = 6,
    /// Member has already contributed this cycle
    AlreadyContributed    = 7,
    /// Contribution amount does not match the group requirement
    WrongAmount           = 8,
    /// Cycle deadline has not passed yet — too early to close
    CycleNotOver          = 9,
    /// Cycle deadline has already passed — too late to contribute
    DeadlinePassed        = 10,
    /// All cycles already completed
    GroupCompleted        = 11,
    /// Attempted to default a member who already contributed
    MemberContributed     = 12,
    /// No pending payout recipient found
    NoRecipient           = 13,
    /// Reputation contract rejected this member (locked, unpaid debt, score too low, or at group limit)
    ReputationCheckFailed = 14,
}

// ---------------------------------------------------------------------------
// Guard Functions
// ---------------------------------------------------------------------------
// Each function either passes silently or panics with a typed error.
// Call these at the top of every contract function before doing any work.
// ---------------------------------------------------------------------------

/// Ensure a group with this ID exists
pub fn require_group_exists(env: &Env, group_id: u32) {
    if !group_exists(env, group_id) {
        panic_with_error!(env, Error::GroupNotFound);
    }
}

/// Ensure the group is in the Forming state (accepting members)
pub fn require_forming(env: &Env, group: &Group) {
    if group.status != GroupStatus::Forming {
        panic_with_error!(env, Error::InvalidGroupStatus);
    }
}

/// Ensure the group is Active (contributions and payouts running)
pub fn require_active(env: &Env, group: &Group) {
    if group.status != GroupStatus::Active {
        panic_with_error!(env, Error::InvalidGroupStatus);
    }
}

/// Ensure the caller is the group admin
pub fn require_admin(env: &Env, group: &Group, caller: &Address) {
    if &group.admin != caller {
        panic_with_error!(env, Error::NotAdmin);
    }
}

/// Ensure the address is a current member of the group
pub fn require_member(env: &Env, group: &Group, address: &Address) {
    let is_member = group.members.iter().any(|m| &m == address);
    if !is_member {
        panic_with_error!(env, Error::NotAMember);
    }
}

/// Ensure the address is NOT already a member (used during join)
pub fn require_not_member(env: &Env, group: &Group, address: &Address) {
    let already = group.members.iter().any(|m| &m == address);
    if already {
        panic_with_error!(env, Error::AlreadyMember);
    }
}

/// Ensure the group still has room for new members
pub fn require_not_full(env: &Env, group: &Group) {
    if group.members.len() >= group.max_members {
        panic_with_error!(env, Error::GroupFull);
    }
}

/// Ensure the member has NOT contributed this cycle yet
pub fn require_not_contributed(env: &Env, group_id: u32, member: &Address) {
    if has_contributed(env, group_id, member) {
        panic_with_error!(env, Error::AlreadyContributed);
    }
}

/// Ensure the contribution amount matches the group's required amount
pub fn require_correct_amount(env: &Env, group: &Group, amount: i128) {
    if amount != group.contribution_amount {
        panic_with_error!(env, Error::WrongAmount);
    }
}

/// Ensure the cycle deadline has NOT passed (member can still contribute)
pub fn require_before_deadline(env: &Env, group: &Group) {
    let deadline = group.cycle_start_ledger + group.cycle_duration_ledgers;
    if env.ledger().sequence() >= deadline {
        panic_with_error!(env, Error::DeadlinePassed);
    }
}

/// Ensure the cycle deadline HAS passed (cycle can be closed)
pub fn require_after_deadline(env: &Env, group: &Group) {
    let deadline = group.cycle_start_ledger + group.cycle_duration_ledgers;
    if env.ledger().sequence() < deadline {
        panic_with_error!(env, Error::CycleNotOver);
    }
}

/// Ensure the member has NOT contributed — used when flagging a default
pub fn require_not_contributed_for_default(env: &Env, group_id: u32, member: &Address) {
    if has_contributed(env, group_id, member) {
        panic_with_error!(env, Error::MemberContributed);
    }
}

/// Ensure the group has not already completed all cycles
pub fn require_not_completed(env: &Env, group: &Group) {
    if group.status == GroupStatus::Completed {
        panic_with_error!(env, Error::GroupCompleted);
    }
}
