#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};

fn setup_active_group(
    env: &Env,
) -> (RotatingSavingsClient<'_>, u32, Address, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(env, &token_address);

    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob, &20_000_000_i128);

    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &None);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    (client, group_id, alice, bob, admin)
}

// ---------------------------------------------------------------------------
// flag_default
// ---------------------------------------------------------------------------

#[test]
fn test_can_flag_member_who_missed_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin) = setup_active_group(&env);

    // Only bob contributes — alice misses the deadline
    client.contribute(&group_id, &bob);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Flagging alice (who did NOT contribute) should succeed
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_member_who_contributed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _bob, admin) = setup_active_group(&env);

    client.contribute(&group_id, &alice);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Alice contributed — should panic with MemberContributed
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_default_before_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _bob, admin) = setup_active_group(&env);

    // Deadline has NOT passed — should panic with CycleNotOver
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_non_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, _alice, _bob, admin) = setup_active_group(&env);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    let outsider = Address::generate(&env);
    // Outsider is not in the group — should panic with NotAMember
    client.flag_default(&admin, &group_id, &outsider);
}

// ---------------------------------------------------------------------------
// Payout demotion on default
// ---------------------------------------------------------------------------

/// A 3-member group: alice (slot 0), bob (slot 1), carol (slot 2).
/// Bob defaults in cycle 0. His slot (1) > current_cycle (0) → demoted to last.
/// After demotion: payout_order = [alice, carol, bob].
#[test]
fn test_default_moves_future_payout_slot_to_last() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);
    let carol = Address::generate(&env);

    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob,   &20_000_000_i128);
    token_admin_client.mint(&carol, &20_000_000_i128);

    // 3-member group → 3 cycles; cycle duration 100 ledgers
    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &3_u32, &0_u32, &None);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);
    client.join_group(&group_id, &carol);

    // Initial payout_order: [alice(0), bob(1), carol(2)]
    let group_before = client.get_group(&group_id);
    assert_eq!(group_before.payout_order.get(0).unwrap(), alice);
    assert_eq!(group_before.payout_order.get(1).unwrap(), bob);
    assert_eq!(group_before.payout_order.get(2).unwrap(), carol);

    // Cycle 0: alice and carol contribute, bob does NOT
    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &carol);

    // Advance past deadline
    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Flag bob as defaulted — his slot (1) > current_cycle (0) → should be demoted
    client.flag_default(&admin, &group_id, &bob);

    // After demotion: payout_order should be [alice, carol, bob]
    let group_after = client.get_group(&group_id);
    assert_eq!(group_after.payout_order.get(0).unwrap(), alice,  "alice stays at slot 0");
    assert_eq!(group_after.payout_order.get(1).unwrap(), carol,  "carol moves up to slot 1");
    assert_eq!(group_after.payout_order.get(2).unwrap(), bob,    "bob demoted to last slot 2");
}

/// The current cycle's designated recipient defaults (they are at slot == current_cycle).
/// Their slot is NOT moved — they are the current recipient and will receive
/// the reduced payout when close_cycle is called.
#[test]
fn test_default_does_not_move_current_cycle_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);

    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob,   &20_000_000_i128);

    // 2-member group; cycle 0: alice is recipient (slot 0), bob is slot 1
    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &2_u32, &0_u32, &None);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    // alice (slot 0 = current_cycle 0) defaults — slot == current_cycle, no demotion
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.flag_default(&admin, &group_id, &alice);

    // payout_order unchanged: [alice, bob]
    let group = client.get_group(&group_id);
    assert_eq!(group.payout_order.get(0).unwrap(), alice);
    assert_eq!(group.payout_order.get(1).unwrap(), bob);
}

/// Members who have already received their payout (slot < current_cycle)
/// are not affected even if they default in a later cycle.
#[test]
fn test_default_does_not_move_already_paid_member() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob   = Address::generate(&env);
    let carol = Address::generate(&env);

    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob,   &20_000_000_i128);
    token_admin_client.mint(&carol, &20_000_000_i128);

    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &3_u32, &0_u32, &None);
    client.join_group(&group_id, &alice);  // slot 0
    client.join_group(&group_id, &bob);    // slot 1
    client.join_group(&group_id, &carol);  // slot 2

    // Cycle 0: all contribute → close → alice gets paid; current_cycle → 1
    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    client.contribute(&group_id, &carol);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &group_id);

    // Cycle 1: bob and carol contribute, alice does NOT
    client.contribute(&group_id, &bob);
    client.contribute(&group_id, &carol);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // alice defaults in cycle 1 — her slot (0) < current_cycle (1), already paid → no move
    client.flag_default(&admin, &group_id, &alice);

    // payout_order unchanged
    let group = client.get_group(&group_id);
    assert_eq!(group.payout_order.get(0).unwrap(), alice);
    assert_eq!(group.payout_order.get(1).unwrap(), bob);
    assert_eq!(group.payout_order.get(2).unwrap(), carol);
}
