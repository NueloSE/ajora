#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use reputation::{Reputation, ReputationClient};

// ---------------------------------------------------------------------------
// Setup helper — call at the start of each test
// ---------------------------------------------------------------------------

/// Deploy + initialize the reputation contract.
/// Returns (contract_id, admin) — callers create the client themselves so
/// the client's lifetime is tied to the caller's `env`.
fn deploy_reputation(env: &Env) -> (Address, Address) {
    let contract_id = env.register(Reputation, ());
    let client = ReputationClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (contract_id, admin)
}

// ---------------------------------------------------------------------------
// Score Mechanics — defaults
// ---------------------------------------------------------------------------

#[test]
fn test_new_member_starts_at_100() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);

    let member = Address::generate(&env);
    assert_eq!(client.get_score(&member), 100);
}

#[test]
fn test_first_default_deducts_20() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);

    assert_eq!(client.get_score(&member), 80); // 100 − 20
    assert_eq!(client.get_default_count(&member), 1);
    assert!(!client.is_locked(&member));
}

#[test]
fn test_second_default_deducts_25() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &1);

    assert_eq!(client.get_score(&member), 55); // 100 − 20 − 25
    assert_eq!(client.get_default_count(&member), 2);
    assert!(!client.is_locked(&member));
}

#[test]
fn test_third_default_deducts_30_and_triggers_lockout() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &1);
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &2);

    assert_eq!(client.get_score(&member), 25); // 100 − 20 − 25 − 30
    assert_eq!(client.get_default_count(&member), 3);
    assert!(client.is_locked(&member));
    assert!(client.locked_until(&member) > 0);
}

#[test]
fn test_score_floors_at_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    // 4 defaults: 100−20=80, −25=55, −30=25, −30=0 (floor)
    for i in 0..4_u32 {
        client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &(i + 1), &i);
    }
    assert_eq!(client.get_score(&member), 0);
}

// ---------------------------------------------------------------------------
// Score Mechanics — completion bonuses
// ---------------------------------------------------------------------------

#[test]
fn test_completion_at_high_score_awards_5() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    // One default → score 80, then complete one cycle
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);
    assert_eq!(client.get_score(&member), 80);

    client.record_completion(&caller, &member);
    assert_eq!(client.get_score(&member), 85); // +5
}

#[test]
fn test_completion_below_60_awards_reentry_bonus_10() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    // Two defaults → score 55 (re-entry zone)
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);
    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &1);
    assert_eq!(client.get_score(&member), 55);

    // First completion: re-entry bonus +10
    client.record_completion(&caller, &member);
    assert_eq!(client.get_score(&member), 65);

    // Second completion: score now ≥ 60, regular bonus +5
    client.record_completion(&caller, &member);
    assert_eq!(client.get_score(&member), 70);
}

#[test]
fn test_score_caps_at_100() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);

    // Multiple completions at 100 — must stay at 100
    for _ in 0..5 {
        client.record_completion(&caller, &member);
    }
    assert_eq!(client.get_score(&member), 100);
}

// ---------------------------------------------------------------------------
// Debt System
// ---------------------------------------------------------------------------

#[test]
fn test_default_creates_debt_record() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token, &1, &0);

    let debts = client.get_debts(&member);
    assert_eq!(debts.len(), 1);
    let debt = debts.get(0).unwrap();
    assert_eq!(debt.creditor, creditor);
    assert_eq!(debt.amount, 5_000_000);
    assert_eq!(debt.group_id, 1);
    assert_eq!(debt.cycle, 0);
    assert!(!debt.paid);
    assert!(client.has_unpaid_debt(&member));
}

#[test]
fn test_multiple_debts_tracked_independently() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token, &1, &0);
    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token, &2, &1);

    let debts = client.get_debts(&member);
    assert_eq!(debts.len(), 2);
    assert_eq!(debts.get(0).unwrap().group_id, 1);
    assert_eq!(debts.get(1).unwrap().group_id, 2);
}

#[test]
fn test_repay_debt_marks_paid_and_adds_8_to_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(&env, &token_address);
    token_admin_client.mint(&member, &20_000_000_i128);

    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token_address, &1, &0);
    assert_eq!(client.get_score(&member), 80); // 100 − 20
    assert!(client.has_unpaid_debt(&member));

    client.repay_debt(&member, &1, &0);

    assert!(!client.has_unpaid_debt(&member));
    assert_eq!(client.get_score(&member), 88); // 80 + 8
}

// ---------------------------------------------------------------------------
// Lockout Expiry
// ---------------------------------------------------------------------------

#[test]
fn test_lockout_expires_after_ledger_window() {
    let env = Env::default();
    env.mock_all_auths();
    // Give all persistent entries a very long TTL so they survive when we
    // advance the ledger sequence number past the 6-month lockout (~3.1M ledgers).
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });

    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    for i in 0..3_u32 {
        client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &(i + 1), &i);
    }
    assert!(client.is_locked(&member));

    let locked_until = client.locked_until(&member);
    env.ledger().with_mut(|l| {
        l.sequence_number = locked_until as u32 + 1;
    });

    assert!(!client.is_locked(&member));
}

// ---------------------------------------------------------------------------
// can_join Gate Checks
// ---------------------------------------------------------------------------

#[test]
fn test_fresh_member_can_join_any_group() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let member = Address::generate(&env);

    assert!(client.can_join(&member, &0));   // re-entry group
    assert!(client.can_join(&member, &60));  // mid-tier min
    assert!(client.can_join(&member, &80));  // high-tier min
}

#[test]
fn test_locked_member_cannot_join_anything() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    for i in 0..3_u32 {
        client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &(i + 1), &i);
    }

    assert!(!client.can_join(&member, &0));
    assert!(!client.can_join(&member, &60));
}

#[test]
fn test_unpaid_debt_blocks_joining() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);
    let token = Address::generate(&env);

    client.record_default(&caller, &member, &creditor, &1_000_000_i128, &token, &1, &0);
    // Score is 80, would be eligible by score, but has unpaid debt
    assert!(!client.can_join(&member, &60));
    assert!(!client.can_join(&member, &0));
}

#[test]
fn test_score_below_60_cannot_join_normal_group() {
    let env = Env::default();
    env.mock_all_auths();
    // Extend TTL so entries survive ledger advances past the lockout window.
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 10_000_000;
        l.max_entry_ttl = 10_000_000;
    });
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(&env, &token_address);
    token_admin_client.mint(&member, &20_000_000_i128);

    // Two defaults → score 55, repay both so debt is clear
    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token_address, &1, &0);
    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token_address, &1, &1);
    client.repay_debt(&member, &1, &0);
    client.repay_debt(&member, &1, &1);
    // Score: 55 + 8 + 8 = 71 (mid-tier now — can join 60+ groups)
    // Let's test at exactly score 55 before repayment:
    // We need a member at score < 60 with no debt.
    // The only way to get score < 60 without debt is to never repay.
    // Here after repayment score is 71, which is mid-tier.
    // So let's use a third default scenario instead to test sub-60:

    let member2 = Address::generate(&env);
    let creditor2 = Address::generate(&env);
    token_admin_client.mint(&member2, &20_000_000_i128);

    // Three defaults → score 25 (below 60), locked
    for i in 0..3_u32 {
        client.record_default(&caller, &member2, &creditor2, &1_000_000_i128, &token_address, &(i + 10), &i);
    }
    // Unlock by advancing ledger
    let locked_until = client.locked_until(&member2);
    env.ledger().with_mut(|l| {
        l.sequence_number = locked_until as u32 + 1;
    });
    // Repay all three debts
    for i in 0..3_u32 {
        client.repay_debt(&member2, &(i + 10), &i);
    }
    // Score after 3 repayments: 25 + 8 + 8 + 8 = 49 — still below 60
    assert_eq!(client.get_score(&member2), 49);
    assert!(!client.has_unpaid_debt(&member2));
    assert!(!client.is_locked(&member2));

    // Cannot join a normal group (score 49 < 60)
    assert!(!client.can_join(&member2, &60));
    assert!(!client.can_join(&member2, &80));

    // CAN join a re-entry group (min_score = 0)
    assert!(client.can_join(&member2, &0));
}

// ---------------------------------------------------------------------------
// Group Limit Bands
// ---------------------------------------------------------------------------

#[test]
fn test_high_tier_allows_2_active_groups() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);

    // Score 100 — max 2 groups
    assert_eq!(client.max_allowed_groups(&member), 2);

    client.increment_active(&caller, &member);
    assert!(client.can_join(&member, &80));

    client.increment_active(&caller, &member);
    assert!(!client.can_join(&member, &80)); // at limit
    assert_eq!(client.get_active_groups(&member), 2);
}

#[test]
fn test_decrement_restores_slot() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);

    client.increment_active(&caller, &member);
    client.increment_active(&caller, &member);
    assert!(!client.can_join(&member, &80));

    // One group ends
    client.decrement_active(&caller, &member);
    assert!(client.can_join(&member, &80));
}

#[test]
fn test_decrement_is_safe_at_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);

    // Calling decrement when at 0 must not panic
    client.decrement_active(&caller, &member);
    assert_eq!(client.get_active_groups(&member), 0);
}

// ---------------------------------------------------------------------------
// Full Recovery Path
// ---------------------------------------------------------------------------

#[test]
fn test_full_recovery_after_one_default_and_repayment() {
    let env = Env::default();
    env.mock_all_auths();
    let (cid, _) = deploy_reputation(&env);
    let client = ReputationClient::new(&env, &cid);
    let caller = Address::generate(&env);
    let member = Address::generate(&env);
    let creditor = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(&env, &token_address);
    token_admin_client.mint(&member, &50_000_000_i128);

    // One default → score 80
    client.record_default(&caller, &member, &creditor, &5_000_000_i128, &token_address, &1, &0);
    assert_eq!(client.get_score(&member), 80);

    // Repay → score 88
    client.repay_debt(&member, &1, &0);
    assert_eq!(client.get_score(&member), 88);

    // Three more completions → 88 + 5 + 5 + 5 = 103, capped at 100
    client.record_completion(&caller, &member);
    client.record_completion(&caller, &member);
    client.record_completion(&caller, &member);
    assert_eq!(client.get_score(&member), 100);

    // Fully eligible: can join any group and be in 2 at once
    assert!(client.can_join(&member, &80));
    assert_eq!(client.max_allowed_groups(&member), 2);
}
