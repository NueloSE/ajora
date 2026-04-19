#![cfg(test)]

//! Integration tests verifying rotating_savings ↔ reputation cross-contract behaviour.
//!
//! These tests register BOTH contracts in the same Soroban test environment so
//! the cross-contract calls happen for real — no mocks.

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};
use rotating_savings::storage::GroupStatus;
use reputation::{Reputation, ReputationClient};

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/// Deploy both contracts and initialize the reputation contract.
fn setup_both(
    env: &Env,
) -> (
    RotatingSavingsClient<'_>,
    ReputationClient<'_>,
    Address, // reputation contract id
    Address, // group admin
) {
    let rep_id = env.register(Reputation, ());
    let rep_client = ReputationClient::new(env, &rep_id);
    let rep_admin = Address::generate(env);
    rep_client.initialize(&rep_admin);

    let sav_id = env.register(RotatingSavings, ());
    let sav_client = RotatingSavingsClient::new(env, &sav_id);

    let group_admin = Address::generate(env);
    (sav_client, rep_client, rep_id, group_admin)
}

/// Register a mock USDC token and return (token_address, token_admin_client).
fn make_token<'a>(env: &'a Env) -> (Address, TokenAdminClient<'a>) {
    let token_admin = Address::generate(env);
    let addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let client = TokenAdminClient::new(env, &addr);
    (addr, client)
}

/// Create a group that uses the reputation contract.
fn create_rep_group(
    sav_client: &RotatingSavingsClient,
    admin: &Address,
    token: &Address,
    max_members: u32,
    min_score: u32,
    rep_id: &Address,
) -> u32 {
    sav_client.create_group(
        admin,
        token,
        &5_000_000_i128,
        &1_000_u32,
        &max_members,
        &min_score,
        &Some(rep_id.clone()),
    )
}

/// Build a **re-entry member** — score < 60, no unpaid debt, not locked.
///
/// Strategy: apply N defaults → lockout triggered on 3rd → advance ledger
/// past lockout → repay all N debts.
///
/// After this helper returns the ledger sequence has been bumped; callers
/// that share an `env` must be aware of this.
///
/// `group_base` must be unique per call to avoid group_id / cycle collisions
/// in the debt records.
///
/// Returns (member_address, final_score):
///   n=3 → score 25+24=49   (3 repayments of +8 each)
///   n=4 → score  0+32=32   (4 repayments; 4th default floors at 0)
fn make_reentry(
    env: &Env,
    rep_client: &ReputationClient,
    real_token: &Address,
    token_admin_client: &TokenAdminClient,
    n_defaults: u32,
    group_base: u32, // unique base to avoid key collisions
) -> (Address, u32) {
    let member = Address::generate(env);
    let caller = Address::generate(env);
    let creditor = Address::generate(env);
    token_admin_client.mint(&member, &200_000_000_i128);

    for i in 0..n_defaults {
        rep_client.record_default(
            &caller,
            &member,
            &creditor,
            &5_000_000_i128,
            real_token,
            &(group_base + i),
            &i,
        );
    }

    // Advance past the 6-month lockout (set on 3rd default)
    let locked_until = rep_client.locked_until(&member);
    env.ledger().with_mut(|l| {
        l.sequence_number = locked_until as u32 + 1;
    });

    // Repay all debts
    for i in 0..n_defaults {
        rep_client.repay_debt(&member, &(group_base + i), &i);
    }

    let score = rep_client.get_score(&member);
    assert!(score < 60, "Expected re-entry score < 60, got {}", score);
    assert!(!rep_client.has_unpaid_debt(&member));
    assert!(!rep_client.is_locked(&member));

    (member, score)
}

// ---------------------------------------------------------------------------
// create_group
// ---------------------------------------------------------------------------

#[test]
fn test_create_group_stores_reputation_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, _, rep_id, admin) = setup_both(&env);
    let (token, _) = make_token(&env);

    let group_id = create_rep_group(&sav_client, &admin, &token, 3, 0, &rep_id);

    let group = sav_client.get_group(&group_id);
    assert_eq!(group.reputation_contract, Some(rep_id));
    assert_eq!(group.min_score, 0);
    assert_eq!(group.normal_member_count, 0);
}

// ---------------------------------------------------------------------------
// join_group — normal members
// ---------------------------------------------------------------------------

#[test]
fn test_normal_members_keep_join_order_in_payout() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, _, rep_id, admin) = setup_both(&env);
    let (token, _) = make_token(&env);

    let group_id = create_rep_group(&sav_client, &admin, &token, 3, 80, &rep_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);
    sav_client.join_group(&group_id, &carol);

    let group = sav_client.get_group(&group_id);
    assert_eq!(group.payout_order.get(0).unwrap(), alice);
    assert_eq!(group.payout_order.get(1).unwrap(), bob);
    assert_eq!(group.payout_order.get(2).unwrap(), carol);
    assert_eq!(group.normal_member_count, 3);
}

#[test]
fn test_join_group_increments_reputation_active_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (token, _) = make_token(&env);

    let group_id = create_rep_group(&sav_client, &admin, &token, 3, 80, &rep_id);
    let member = Address::generate(&env);

    assert_eq!(rep_client.get_active_groups(&member), 0);
    sav_client.join_group(&group_id, &member);
    assert_eq!(rep_client.get_active_groups(&member), 1);
}

// ---------------------------------------------------------------------------
// join_group — re-entry member payout positioning
// ---------------------------------------------------------------------------
//
// A "re-entry member" has score < 60 AND is joining a group with min_score=0.
// To reach that state with no unpaid debt:
//   3 defaults → score 25, locked → advance past lockout → repay all 3 → score 49
//   4 defaults → score 0,  locked → advance past lockout → repay all 4 → score 32

#[test]
fn test_reentry_member_placed_after_normal_members() {
    let env = Env::default();
    env.mock_all_auths();
    // High TTL so contract instances survive the ledger advance needed to clear lockout.
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (real_token, token_admin_client) = make_token(&env);

    // alice and bob are normal members (score 100)
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // dave is a re-entry member (score 49, no debt, not locked)
    let (dave, dave_score) = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 3, 500);
    assert_eq!(dave_score, 49);

    let (token2, _) = make_token(&env);
    let group_id = create_rep_group(&sav_client, &admin, &token2, 4, 0, &rep_id);

    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);
    sav_client.join_group(&group_id, &dave);

    let group = sav_client.get_group(&group_id);
    assert_eq!(group.normal_member_count, 2);
    assert_eq!(group.payout_order.get(0).unwrap(), alice); // normal
    assert_eq!(group.payout_order.get(1).unwrap(), bob);   // normal
    assert_eq!(group.payout_order.get(2).unwrap(), dave);  // re-entry (only one)
}

#[test]
fn test_reentry_members_sorted_by_score_highest_first() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (real_token, token_admin_client) = make_token(&env);

    let alice = Address::generate(&env); // normal (score 100)

    // m_high: 3 defaults + repay → score 49
    let (m_high, score_high) = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 3, 600);
    // m_low:  4 defaults + repay → score 32
    let (m_low, score_low) = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 4, 700);

    assert_eq!(score_high, 49);
    assert_eq!(score_low, 32);

    let (token2, _) = make_token(&env);
    let group_id = create_rep_group(&sav_client, &admin, &token2, 5, 0, &rep_id);

    // Join order: alice, then m_low (lower score), then m_high (higher score)
    // m_high should still end up BEFORE m_low in payout_order because 49 > 32
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &m_low);   // score 32 — goes to re-entry position 1
    sav_client.join_group(&group_id, &m_high);  // score 49 — should jump ahead of m_low(32)

    let group = sav_client.get_group(&group_id);
    assert_eq!(group.normal_member_count, 1);
    assert_eq!(group.payout_order.get(0).unwrap(), alice);  // normal
    assert_eq!(group.payout_order.get(1).unwrap(), m_high); // re-entry, higher score → earlier payout
    assert_eq!(group.payout_order.get(2).unwrap(), m_low);  // re-entry, lower score → last
}

#[test]
fn test_lowest_score_reentry_goes_last_among_reentry() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (real_token, token_admin_client) = make_token(&env);

    // Three re-entry members with different scores
    // m_49a and m_49b both have score 49; m_32 has score 32 (lowest → last)
    let (m_49a, _) = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 3, 800);
    let (m_49b, _) = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 3, 900);
    let (m_32, _)  = make_reentry(&env, &rep_client, &real_token, &token_admin_client, 4, 1000);

    let (token2, _) = make_token(&env);
    let group_id = create_rep_group(&sav_client, &admin, &token2, 5, 0, &rep_id);

    // m_49a joins first, then m_32, then m_49b
    sav_client.join_group(&group_id, &m_49a);
    sav_client.join_group(&group_id, &m_32);   // score 32 → goes to end
    sav_client.join_group(&group_id, &m_49b);  // score 49 → jumps before m_32

    let group = sav_client.get_group(&group_id);
    assert_eq!(group.normal_member_count, 0);
    // Payout: [m_49a(49), m_49b(49), m_32(32)]
    // Equal scores: first-joined stays first (stable insert)
    assert_eq!(group.payout_order.get(0).unwrap(), m_49a);
    assert_eq!(group.payout_order.get(1).unwrap(), m_49b);
    assert_eq!(group.payout_order.get(2).unwrap(), m_32); // lowest score — always last
}

// ---------------------------------------------------------------------------
// join_group — eligibility gate
// ---------------------------------------------------------------------------

#[test]
#[should_panic]
fn test_join_blocked_when_reputation_check_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (token, _) = make_token(&env);

    // Group requiring min_score = 60
    let group_id = create_rep_group(&sav_client, &admin, &token, 3, 60, &rep_id);

    let bad_member = Address::generate(&env);
    let caller = Address::generate(&env);
    let creditor = Address::generate(&env);
    let fake_token = Address::generate(&env); // debt stored but never repaid

    // Two defaults → score 55 + unpaid debt → can_join(60) = false
    rep_client.record_default(&caller, &bad_member, &creditor, &1_000_000_i128, &fake_token, &1, &0);
    rep_client.record_default(&caller, &bad_member, &creditor, &1_000_000_i128, &fake_token, &1, &1);
    assert_eq!(rep_client.get_score(&bad_member), 55);

    // Should panic with ReputationCheckFailed (error #14)
    sav_client.join_group(&group_id, &bad_member);
}

#[test]
#[should_panic]
fn test_join_blocked_when_member_is_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);
    let (token, _) = make_token(&env);

    let group_id = create_rep_group(&sav_client, &admin, &token, 3, 0, &rep_id);

    let locked_member = Address::generate(&env);
    let caller = Address::generate(&env);
    let creditor = Address::generate(&env);
    let fake_token = Address::generate(&env);

    // 3 defaults → locked
    for i in 0..3_u32 {
        rep_client.record_default(&caller, &locked_member, &creditor, &1_000_000_i128, &fake_token, &(i + 1), &i);
    }
    assert!(rep_client.is_locked(&locked_member));

    // Should panic — locked members cannot join even a re-entry group
    sav_client.join_group(&group_id, &locked_member);
}

// ---------------------------------------------------------------------------
// flag_default — reputation side-effects
// ---------------------------------------------------------------------------

#[test]
fn test_flag_default_reduces_reputation_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);

    let (real_token, token_admin_client) = make_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &Some(rep_id),
    );
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);

    // Bob contributes, Alice misses the deadline
    sav_client.contribute(&group_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    assert_eq!(rep_client.get_score(&alice), 100);
    sav_client.flag_default(&admin, &group_id, &alice);

    assert_eq!(rep_client.get_score(&alice), 80); // first default: −20
    assert_eq!(rep_client.get_default_count(&alice), 1);
    assert!(rep_client.has_unpaid_debt(&alice));
}

#[test]
fn test_flag_default_records_correct_creditor() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);

    let (real_token, token_admin_client) = make_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &Some(rep_id),
    );
    sav_client.join_group(&group_id, &alice); // payout_order[0] = alice (cycle 0 recipient)
    sav_client.join_group(&group_id, &bob);

    // Bob defaults in cycle 0; the creditor (payout recipient for cycle 0) is alice
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    sav_client.flag_default(&admin, &group_id, &bob);

    let debts = rep_client.get_debts(&bob);
    assert_eq!(debts.len(), 1);
    assert_eq!(debts.get(0).unwrap().creditor, alice); // alice was the cycle 0 payout recipient
    assert_eq!(debts.get(0).unwrap().cycle, 0);
}

// ---------------------------------------------------------------------------
// close_cycle — reputation side-effects
// ---------------------------------------------------------------------------

#[test]
fn test_close_cycle_awards_completion_to_honest_members() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);

    let (real_token, token_admin_client) = make_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &Some(rep_id),
    );
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);

    sav_client.contribute(&group_id, &alice);
    sav_client.contribute(&group_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    sav_client.close_cycle(&admin, &group_id);

    // Both contributed honestly — record_completion should have been called for both.
    // Since both start at 100 (capped), we can't see +5 numerically, but the call must not panic.
    assert_eq!(rep_client.get_score(&alice), 100);
    assert_eq!(rep_client.get_score(&bob), 100);
}

#[test]
fn test_close_cycle_does_not_award_defaulters() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);

    let (real_token, token_admin_client) = make_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    // Pre-condition: give alice a default + repay so her score is visible < 100
    // (so we can verify the +5 completion bonus is applied vs not)
    let pre_caller = Address::generate(&env);
    let pre_creditor = Address::generate(&env);
    rep_client.record_default(
        &pre_caller, &alice, &pre_creditor, &5_000_000_i128, &real_token, &9999, &0,
    );
    // Alice has unpaid debt — repay it so she can join
    rep_client.repay_debt(&alice, &9999, &0);
    // Alice score: 100 - 20 + 8 = 88
    assert_eq!(rep_client.get_score(&alice), 88);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &Some(rep_id),
    );
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);

    // Only alice contributes; bob defaults (does not contribute)
    sav_client.contribute(&group_id, &alice);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    sav_client.close_cycle(&admin, &group_id);

    // Alice contributed honestly → +5 bonus: 88 → 93
    assert_eq!(rep_client.get_score(&alice), 93);
    // Bob did NOT contribute → record_completion not called for bob → score unchanged
    assert_eq!(rep_client.get_score(&bob), 100);
}

#[test]
fn test_group_completion_decrements_active_for_all() {
    let env = Env::default();
    env.mock_all_auths();
    let (sav_client, rep_client, rep_id, admin) = setup_both(&env);

    let (real_token, token_admin_client) = make_token(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &Some(rep_id),
    );
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);

    assert_eq!(rep_client.get_active_groups(&alice), 1);
    assert_eq!(rep_client.get_active_groups(&bob), 1);

    // Run both cycles to completion (2-member group = 2 cycles)
    sav_client.contribute(&group_id, &alice);
    sav_client.contribute(&group_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    sav_client.close_cycle(&admin, &group_id); // cycle 0

    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    sav_client.close_cycle(&admin, &group_id); // cycle 1 — group completes

    assert_eq!(sav_client.get_group(&group_id).status, GroupStatus::Completed);
    assert_eq!(rep_client.get_active_groups(&alice), 0);
    assert_eq!(rep_client.get_active_groups(&bob), 0);
}

// ---------------------------------------------------------------------------
// Backward compatibility — groups without reputation contract
// ---------------------------------------------------------------------------

#[test]
fn test_group_without_reputation_works_normally() {
    let env = Env::default();
    env.mock_all_auths();

    let sav_id = env.register(RotatingSavings, ());
    let sav_client = RotatingSavingsClient::new(&env, &sav_id);

    let (real_token, token_admin_client) = make_token(&env);
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = sav_client.create_group(
        &admin, &real_token, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &None,
    );
    sav_client.join_group(&group_id, &alice);
    sav_client.join_group(&group_id, &bob);

    sav_client.contribute(&group_id, &alice);
    sav_client.contribute(&group_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    let recipient = sav_client.close_cycle(&admin, &group_id);
    assert_eq!(recipient, alice); // alice joined first → cycle 0 payout
}
