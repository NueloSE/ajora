#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient as TokenAdminClient, TokenClient},
    Address, Env,
};

use target_savings::{TargetSavings, TargetSavingsClient};
use target_savings::storage::PoolStatus;

/// Create a 2-member pool, run all cycles, return matured client
fn setup_matured_pool(
    env: &Env,
) -> (TargetSavingsClient<'_>, u32, Address, Address, Address) {
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

    // Pool with 2 cycles total so we can mature it quickly in tests
    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &2_u32, &2_u32);
    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &bob);

    // Cycle 0
    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Cycle 1 — final cycle, matures the pool
    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    (client, pool_id, alice, bob, token)
}

// ---------------------------------------------------------------------------
// withdraw
// ---------------------------------------------------------------------------

#[test]
fn test_pool_is_matured_after_all_cycles() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, _, _, _) = setup_matured_pool(&env);

    assert_eq!(client.get_pool(&pool_id).status, PoolStatus::Matured);
}

#[test]
fn test_member_receives_full_balance_on_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _, token) = setup_matured_pool(&env);
    let token_client = TokenClient::new(&env, &token);

    let balance_before = token_client.balance(&alice);

    client.withdraw(&pool_id, &alice);

    let balance_after = token_client.balance(&alice);
    // Alice contributed 2 cycles × 5_000_000 = 10_000_000
    assert_eq!(balance_after - balance_before, 10_000_000);
}

#[test]
fn test_each_member_withdraws_their_own_savings() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, bob, token) = setup_matured_pool(&env);
    let token_client = TokenClient::new(&env, &token);

    let alice_before = token_client.balance(&alice);
    let bob_before = token_client.balance(&bob);

    client.withdraw(&pool_id, &alice);
    client.withdraw(&pool_id, &bob);

    let alice_gain = token_client.balance(&alice) - alice_before;
    let bob_gain = token_client.balance(&bob) - bob_before;

    // Both contributed equally — both receive the same amount
    assert_eq!(alice_gain, 10_000_000);
    assert_eq!(bob_gain, 10_000_000);
}

#[test]
fn test_partial_saver_receives_only_what_they_contributed() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TargetSavings, ());
    let client = TargetSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    token_admin_client.mint(&alice, &100_000_000_i128);
    token_admin_client.mint(&bob, &100_000_000_i128);

    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &2_u32, &2_u32);
    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &bob);

    // Cycle 0: only alice contributes, bob defaults
    client.contribute(&pool_id, &alice);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Cycle 1: both contribute
    client.contribute(&pool_id, &alice);
    client.contribute(&pool_id, &bob);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    let alice_before = token_client.balance(&alice);
    let bob_before = token_client.balance(&bob);

    client.withdraw(&pool_id, &alice);
    client.withdraw(&pool_id, &bob);

    // Alice contributed 2 cycles: 10_000_000
    assert_eq!(token_client.balance(&alice) - alice_before, 10_000_000);
    // Bob only contributed 1 cycle: 5_000_000
    assert_eq!(token_client.balance(&bob) - bob_before, 5_000_000);
}

#[test]
#[should_panic]
fn test_cannot_withdraw_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _, _) = setup_matured_pool(&env);

    client.withdraw(&pool_id, &alice);
    client.withdraw(&pool_id, &alice); // should panic
}

#[test]
#[should_panic]
fn test_cannot_withdraw_before_maturity() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TargetSavings, ());
    let client = TargetSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(&env, &token);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    token_admin_client.mint(&alice, &100_000_000_i128);
    token_admin_client.mint(&bob, &100_000_000_i128);

    // 4-cycle pool — we only run 1 cycle so it stays Active
    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &4_u32, &2_u32);
    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &bob);

    client.contribute(&pool_id, &alice);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Pool is still Active — withdrawal should panic with PoolNotMatured
    client.withdraw(&pool_id, &alice);
}

#[test]
#[should_panic]
fn test_non_member_cannot_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, _, _, _) = setup_matured_pool(&env);

    let outsider = Address::generate(&env);
    client.withdraw(&pool_id, &outsider); // should panic
}
