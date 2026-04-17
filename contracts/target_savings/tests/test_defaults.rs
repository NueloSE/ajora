#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use target_savings::{TargetSavings, TargetSavingsClient};

fn setup_active_pool(env: &Env) -> (TargetSavingsClient<'_>, u32, Address, Address, Address) {
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

    (client, pool_id, alice, bob, admin)
}

// ---------------------------------------------------------------------------
// flag_default
// ---------------------------------------------------------------------------

#[test]
fn test_can_flag_member_who_missed_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, bob, admin) = setup_active_pool(&env);

    // Bob contributes, alice does not
    client.contribute(&pool_id, &bob);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Should succeed — alice did not contribute
    client.flag_default(&admin, &pool_id, &alice);
}

#[test]
fn test_defaulting_member_balance_does_not_increase() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _bob, admin) = setup_active_pool(&env);

    // Alice does NOT contribute
    env.ledger().with_mut(|l| { l.sequence_number += 101; });
    client.close_cycle(&admin, &pool_id);

    // Alice's balance should remain zero
    assert_eq!(client.get_balance(&pool_id, &alice), 0);
}

#[test]
#[should_panic]
fn test_cannot_flag_member_who_contributed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _bob, admin) = setup_active_pool(&env);

    client.contribute(&pool_id, &alice);
    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Alice contributed — should panic with MemberContributed
    client.flag_default(&admin, &pool_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_before_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, alice, _bob, admin) = setup_active_pool(&env);

    // Deadline not reached — should panic with CycleNotOver
    client.flag_default(&admin, &pool_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_non_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, pool_id, _alice, _bob, admin) = setup_active_pool(&env);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    let outsider = Address::generate(&env);
    client.flag_default(&admin, &pool_id, &outsider); // should panic
}
