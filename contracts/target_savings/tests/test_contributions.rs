#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use target_savings::{TargetSavings, TargetSavingsClient};

/// Create and activate a 2-member pool with funded members
fn setup_active_pool(
    env: &Env,
) -> (TargetSavingsClient<'_>, u32, Address, Address) {
    let contract_id = env.register(TargetSavings, ());
    let client = TargetSavingsClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(env, &token);

    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    token_admin_client.mint(&alice, &100_000_000_i128);
    token_admin_client.mint(&bob, &100_000_000_i128);

    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &4_u32, &2_u32);
    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &bob);

    (client, pool_id, alice, bob)
}

// ---------------------------------------------------------------------------
// contribute
// ---------------------------------------------------------------------------

#[test]
fn test_balance_starts_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _) = setup_active_pool(&env);

    assert_eq!(client.get_balance(&pool_id, &alice), 0);
}

#[test]
fn test_contribution_increases_member_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _) = setup_active_pool(&env);

    client.contribute(&pool_id, &alice);

    assert_eq!(client.get_balance(&pool_id, &alice), 5_000_000);
}

#[test]
fn test_each_member_balance_is_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, bob) = setup_active_pool(&env);

    // Only alice contributes
    client.contribute(&pool_id, &alice);

    assert_eq!(client.get_balance(&pool_id, &alice), 5_000_000);
    // Bob's balance is untouched
    assert_eq!(client.get_balance(&pool_id, &bob), 0);
}

#[test]
fn test_balance_accumulates_across_cycles() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, bob) = setup_active_pool(&env);
    let admin = Address::generate(&env);

    // Cycle 0
    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Cycle 1
    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Alice has contributed twice — 2 × 5_000_000
    assert_eq!(client.get_balance(&pool_id, &alice), 10_000_000);
}

#[test]
#[should_panic]
fn test_cannot_contribute_twice_same_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _) = setup_active_pool(&env);

    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &alice); // should panic
}

#[test]
#[should_panic]
fn test_non_member_cannot_contribute() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, _, _) = setup_active_pool(&env);

    let outsider = Address::generate(&env);
    client.contribute(&pool_id, &outsider); // should panic
}

#[test]
#[should_panic]
fn test_cannot_contribute_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _) = setup_active_pool(&env);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.contribute(&pool_id, &alice); // should panic
}
