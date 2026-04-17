#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

// Pull in the contract + types
use rotating_savings::{RotatingSavings, RotatingSavingsClient};
use rotating_savings::storage::GroupStatus;

/// Register the contract and return a client + a fake USDC token address
fn setup(env: &Env) -> (RotatingSavingsClient, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);
    let token = Address::generate(env);   // mock token address for unit tests
    let admin = Address::generate(env);
    (client, admin, token)
}

// ---------------------------------------------------------------------------
// create_group
// ---------------------------------------------------------------------------

#[test]
fn test_create_group_returns_id_1() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);

    let group_id = client.create_group(
        &admin,
        &token,
        &5_000_000_i128,  // 0.5 USDC per cycle
        &100_u32,         // 100 ledgers per cycle
        &5_u32,           // 5 members
    );

    assert_eq!(group_id, 1, "First group should have ID 1");
}

#[test]
fn test_create_group_sequential_ids() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);

    let id1 = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &5_u32);
    let id2 = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &3_u32);
    let id3 = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &10_u32);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[test]
fn test_create_group_initial_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);

    let group_id = client.create_group(
        &admin,
        &token,
        &10_000_000_i128,   // 1 USDC
        &120_960_u32,        // ~1 week in ledgers
        &10_u32,
    );

    let group = client.get_group(&group_id);

    assert_eq!(group.admin, admin);
    assert_eq!(group.max_members, 10);
    assert_eq!(group.contribution_amount, 10_000_000);
    assert_eq!(group.cycle_duration_ledgers, 120_960);
    assert_eq!(group.total_cycles, 10);
    assert_eq!(group.current_cycle, 0);
    assert_eq!(group.members.len(), 0);
    assert_eq!(group.status, GroupStatus::Forming);
}

#[test]
#[should_panic]
fn test_get_nonexistent_group_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _) = setup(&env);

    // Should panic — group 99 does not exist
    client.get_group(&99_u32);
}
