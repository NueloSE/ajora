#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, BytesN, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};

fn setup_active_group(env: &Env) -> (RotatingSavingsClient<'_>, u32, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);
    let token = Address::generate(env);
    let admin = Address::generate(env);

    let group_id = client.create_group(&admin, &token, &5_000_000_i128, &100_u32, &2_u32);

    let alice = Address::generate(env);
    let bob = Address::generate(env);

    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    (client, group_id, alice, bob)
}

/// Helper: produce a dummy 32-byte commitment for testing
fn dummy_commitment(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

// ---------------------------------------------------------------------------
// store_commitment / get_commitment
// ---------------------------------------------------------------------------

#[test]
fn test_commitment_is_none_before_storing() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _) = setup_active_group(&env);

    // No commitment stored yet
    assert!(client.get_commitment(&group_id, &alice).is_none());
}

#[test]
fn test_store_and_retrieve_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _) = setup_active_group(&env);
    let commitment = dummy_commitment(&env, 0xab);

    client.store_commitment(&group_id, &alice, &commitment);

    let stored = client.get_commitment(&group_id, &alice)
        .expect("Commitment should be stored");

    assert_eq!(stored, commitment);
}

#[test]
fn test_commitment_is_per_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob) = setup_active_group(&env);

    let alice_commitment = dummy_commitment(&env, 0xaa);
    let bob_commitment = dummy_commitment(&env, 0xbb);

    client.store_commitment(&group_id, &alice, &alice_commitment);
    client.store_commitment(&group_id, &bob, &bob_commitment);

    assert_eq!(
        client.get_commitment(&group_id, &alice).unwrap(),
        alice_commitment
    );
    assert_eq!(
        client.get_commitment(&group_id, &bob).unwrap(),
        bob_commitment
    );
    // Confirm they are different — each member has their own commitment
    assert_ne!(
        client.get_commitment(&group_id, &alice).unwrap(),
        client.get_commitment(&group_id, &bob).unwrap()
    );
}

#[test]
fn test_commitment_can_be_updated() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _) = setup_active_group(&env);

    let first = dummy_commitment(&env, 0x01);
    let second = dummy_commitment(&env, 0x02);

    client.store_commitment(&group_id, &alice, &first);
    assert_eq!(client.get_commitment(&group_id, &alice).unwrap(), first);

    // After another cycle completes, alice submits an updated commitment
    client.store_commitment(&group_id, &alice, &second);
    assert_eq!(client.get_commitment(&group_id, &alice).unwrap(), second);
}

#[test]
#[should_panic]
fn test_non_member_cannot_store_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, _, _) = setup_active_group(&env);

    let outsider = Address::generate(&env);
    let commitment = dummy_commitment(&env, 0xff);

    // Outsider is not a member — should panic with NotAMember
    client.store_commitment(&group_id, &outsider, &commitment);
}
