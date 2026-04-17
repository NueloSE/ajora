#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};
use rotating_savings::storage::GroupStatus;

/// Set up a 2-member group that is Active, with tokens minted to members.
fn setup_active_group(
    env: &Env,
) -> (RotatingSavingsClient<'_>, u32, Address, Address, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(env, &token_address);

    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    // Mint enough for each member to cover multiple cycles
    token_admin_client.mint(&alice, &50_000_000_i128);
    token_admin_client.mint(&bob, &50_000_000_i128);

    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &2_u32);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    (client, group_id, alice, bob, admin, token_address)
}

fn advance_past_deadline(env: &Env) {
    env.ledger().with_mut(|l| {
        l.sequence_number += 101; // cycle_duration_ledgers = 100
    });
}

// ---------------------------------------------------------------------------
// close_cycle
// ---------------------------------------------------------------------------

#[test]
fn test_close_cycle_advances_cycle_counter() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    advance_past_deadline(&env);

    assert_eq!(client.current_cycle(&group_id), 0);
    client.close_cycle(&admin, &group_id);
    assert_eq!(client.current_cycle(&group_id), 1);
}

#[test]
fn test_first_cycle_payout_goes_to_first_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    advance_past_deadline(&env);

    // Alice joined first — she gets cycle 0 payout
    let recipient = client.close_cycle(&admin, &group_id);
    assert_eq!(recipient, alice);
}

#[test]
fn test_second_cycle_payout_goes_to_second_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    // Cycle 0
    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    advance_past_deadline(&env);
    client.close_cycle(&admin, &group_id);

    // Cycle 1
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    let recipient = client.close_cycle(&admin, &group_id);
    assert_eq!(recipient, bob);
}

#[test]
fn test_group_completes_after_all_cycles() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    // Cycle 0
    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    advance_past_deadline(&env);
    client.close_cycle(&admin, &group_id);

    // Cycle 1
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &group_id);

    assert_eq!(client.get_group(&group_id).status, GroupStatus::Completed);
}

#[test]
#[should_panic]
fn test_cannot_close_cycle_before_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);

    // Deadline has NOT passed — should panic with CycleNotOver
    client.close_cycle(&admin, &group_id);
}

#[test]
#[should_panic]
fn test_cannot_close_cycle_on_completed_group() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin, _) = setup_active_group(&env);

    // Complete all cycles
    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);
    advance_past_deadline(&env);
    client.close_cycle(&admin, &group_id);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &group_id);

    // Group is now Completed — this third call should panic
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &group_id);
}
