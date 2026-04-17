#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

use zk_verifier::{ZkVerifier, ZkVerifierClient};

fn dummy_vk(env: &Env) -> Bytes {
    let mut vk = Bytes::new(env);
    for b in 0u8..32 {
        vk.push_back(b);
    }
    vk
}

fn setup_initialized(env: &Env) -> ZkVerifierClient<'_> {
    let contract_id = env.register(ZkVerifier, ());
    let client = ZkVerifierClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &dummy_vk(env));
    client
}

fn fake_commitment(env: &Env, seed: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = seed;
    BytesN::from_array(env, &arr)
}

// ---------------------------------------------------------------------------
// check_credit
// ---------------------------------------------------------------------------

#[test]
fn test_check_credit_returns_false_with_no_record() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // No proof ever submitted — should be false
    let result = client.check_credit(&checker, &member, &1_u32, &1_u32);
    assert!(!result);
}

#[test]
fn test_check_credit_returns_false_for_invalid_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Submit an invalid proof
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 1), &5_u32, &false);

    let result = client.check_credit(&checker, &member, &1_u32, &3_u32);
    assert!(!result);
}

#[test]
fn test_check_credit_returns_true_when_cycles_match() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Valid proof for exactly 5 cycles
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 1), &5_u32, &true);

    // New group also requires 5 — should pass
    let result = client.check_credit(&checker, &member, &1_u32, &5_u32);
    assert!(result);
}

#[test]
fn test_check_credit_returns_true_when_cycles_exceed_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Member proved 8 completed cycles
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 2), &8_u32, &true);

    // New group only requires 3
    let result = client.check_credit(&checker, &member, &1_u32, &3_u32);
    assert!(result);
}

#[test]
fn test_check_credit_returns_false_when_cycles_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Member only proved 2 cycles
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 3), &2_u32, &true);

    // New group requires 5 — member falls short
    let result = client.check_credit(&checker, &member, &1_u32, &5_u32);
    assert!(!result);
}

#[test]
fn test_check_credit_zero_min_cycles_always_passes_for_valid_proof() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Any valid proof satisfies min_cycles=0 (open group)
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 4), &1_u32, &true);

    let result = client.check_credit(&checker, &member, &1_u32, &0_u32);
    assert!(result);
}

#[test]
fn test_check_credit_looks_up_correct_group_id() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let member = Address::generate(&env);

    // Valid record for group 10 but NOT group 20
    client.submit_verified_proof(&member, &10_u32, &fake_commitment(&env, 5), &4_u32, &true);

    assert!(client.check_credit(&checker, &member, &10_u32, &4_u32));
    assert!(!client.check_credit(&checker, &member, &20_u32, &4_u32));
}

#[test]
fn test_check_credit_is_per_member() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let checker = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Only Alice has a valid record
    client.submit_verified_proof(&alice, &1_u32, &fake_commitment(&env, 6), &5_u32, &true);

    assert!(client.check_credit(&checker, &alice, &1_u32, &5_u32));
    assert!(!client.check_credit(&checker, &bob, &1_u32, &5_u32));
}
