#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

use zk_verifier::{ZkVerifier, ZkVerifierClient};

/// Returns a non-empty dummy VK (just needs to be non-zero bytes).
/// In production this is the real circuit VK from `bb write_vk`.
fn dummy_vk(env: &Env) -> Bytes {
    let mut vk = Bytes::new(env);
    // Fill with 32 recognisable bytes
    for b in 0u8..32 {
        vk.push_back(b);
    }
    vk
}

fn setup(env: &Env) -> ZkVerifierClient<'_> {
    let contract_id = env.register(ZkVerifier, ());
    ZkVerifierClient::new(env, &contract_id)
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let admin = Address::generate(&env);

    assert!(!client.is_initialized());

    client.initialize(&admin, &dummy_vk(&env));

    assert!(client.is_initialized());
}

#[test]
fn test_vk_hash_reflects_stored_key() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let admin = Address::generate(&env);
    let vk = dummy_vk(&env);

    client.initialize(&admin, &vk);

    // The hash is deterministic — calling twice gives the same value
    let h1 = client.get_vk_hash();
    let h2 = client.get_vk_hash();
    assert_eq!(h1, h2);
}

#[test]
#[should_panic]
fn test_cannot_initialize_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let admin = Address::generate(&env);

    client.initialize(&admin, &dummy_vk(&env));
    // Second call should panic "Contract already initialised"
    client.initialize(&admin, &dummy_vk(&env));
}

#[test]
#[should_panic]
fn test_cannot_initialize_with_empty_vk() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let admin = Address::generate(&env);

    // Empty VK should panic
    client.initialize(&admin, &Bytes::new(&env));
}

#[test]
#[should_panic]
fn test_verify_proof_panics_if_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup(&env);
    let member = Address::generate(&env);

    let commitment = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let proof = Bytes::new(&env);
    // Contract not initialised — should panic immediately
    client.verify_proof(&member, &0_u32, &commitment, &1_u32, &proof);
}
