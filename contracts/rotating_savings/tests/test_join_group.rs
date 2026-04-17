#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};
use rotating_savings::storage::GroupStatus;

fn setup(env: &Env) -> (RotatingSavingsClient, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);
    let token = Address::generate(env);
    let admin = Address::generate(env);
    (client, admin, token)
}

// ---------------------------------------------------------------------------
// join_group
// ---------------------------------------------------------------------------

#[test]
fn test_members_can_join_forming_group() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &3_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    let group = client.get_group(&group_id);
    assert_eq!(group.members.len(), 2);
    // Still forming — not full yet
    assert_eq!(group.status, GroupStatus::Forming);
}

#[test]
fn test_group_activates_when_full() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    // max_members = 2 so the second join fills it
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &2_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.join_group(&group_id, &alice);
    // Group should still be forming after one member
    assert_eq!(client.get_group(&group_id).status, GroupStatus::Forming);

    client.join_group(&group_id, &bob);
    // Second member fills the group — should now be Active
    assert_eq!(client.get_group(&group_id).status, GroupStatus::Active);
}

#[test]
#[should_panic]
fn test_cannot_join_full_group() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &2_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);
    // Third join should panic — group is full
    client.join_group(&group_id, &carol);
}

#[test]
#[should_panic]
fn test_cannot_join_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &5_u32);

    let alice = Address::generate(&env);

    client.join_group(&group_id, &alice);
    // Same address joining again should panic
    client.join_group(&group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_join_active_group() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &2_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);
    // Group is now Active — carol's join should panic with InvalidGroupStatus
    client.join_group(&group_id, &carol);
}

#[test]
fn test_payout_order_matches_join_order() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &3_u32);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);
    client.join_group(&group_id, &carol);

    let group = client.get_group(&group_id);

    assert_eq!(group.payout_order.get(0).unwrap(), alice);
    assert_eq!(group.payout_order.get(1).unwrap(), bob);
    assert_eq!(group.payout_order.get(2).unwrap(), carol);
}
