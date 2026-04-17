#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use target_savings::{TargetSavings, TargetSavingsClient};
use target_savings::storage::PoolStatus;

fn setup(env: &Env) -> (TargetSavingsClient<'_>, Address, Address) {
    let contract_id = env.register(TargetSavings, ());
    let client = TargetSavingsClient::new(env, &contract_id);
    let token_admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let admin = Address::generate(env);
    (client, admin, token)
}

// ---------------------------------------------------------------------------
// create_pool
// ---------------------------------------------------------------------------

#[test]
fn test_create_pool_returns_id_1() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);

    let pool_id = client.create_pool(
        &admin, &token,
        &5_000_000_i128,  // 0.5 USDC per cycle
        &100_u32,         // 100 ledgers per cycle
        &12_u32,          // 12 cycles total
        &5_u32,           // 5 members max
    );

    assert_eq!(pool_id, 1);
}

#[test]
fn test_create_pool_initial_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let pool_id = client.create_pool(&admin, &token, &10_000_000_i128, &100_u32, &8_u32, &4_u32);

    let pool = client.get_pool(&pool_id);

    assert_eq!(pool.admin, admin);
    assert_eq!(pool.contribution_amount, 10_000_000);
    assert_eq!(pool.total_cycles, 8);
    assert_eq!(pool.max_members, 4);
    assert_eq!(pool.current_cycle, 0);
    assert_eq!(pool.members.len(), 0);
    assert_eq!(pool.status, PoolStatus::Forming);
}

#[test]
fn test_pool_activates_when_full() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    // max_members = 2
    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &4_u32, &2_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.join_pool(&pool_id, &alice);
    assert_eq!(client.get_pool(&pool_id).status, PoolStatus::Forming);

    client.join_pool(&pool_id, &bob);
    assert_eq!(client.get_pool(&pool_id).status, PoolStatus::Active);
}

#[test]
#[should_panic]
fn test_cannot_join_full_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &4_u32, &2_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &bob);
    // Third join — pool is full, should panic
    client.join_pool(&pool_id, &carol);
}

#[test]
#[should_panic]
fn test_cannot_join_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let pool_id = client.create_pool(&admin, &token, &5_000_000_i128, &100_u32, &4_u32, &5_u32);

    let alice = Address::generate(&env);
    client.join_pool(&pool_id, &alice);
    client.join_pool(&pool_id, &alice); // should panic
}

#[test]
#[should_panic]
fn test_get_nonexistent_pool_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup(&env);
    client.get_pool(&99_u32);
}
