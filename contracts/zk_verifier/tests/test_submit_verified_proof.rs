#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env};

use zk_verifier::{ProofStatus, ZkVerifier, ZkVerifierClient};

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

/// Build a fake group_commitment (32 arbitrary bytes).
fn fake_commitment(env: &Env, seed: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = seed;
    BytesN::from_array(env, &arr)
}

// ---------------------------------------------------------------------------
// submit_verified_proof — the off-chain attested path
// ---------------------------------------------------------------------------

#[test]
fn test_submit_valid_proof_records_valid_status() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);
    let commitment = fake_commitment(&env, 42);

    client.submit_verified_proof(&member, &1_u32, &commitment, &3_u32, &true);

    let record = client.get_proof_record(&member, &1_u32).unwrap();
    assert_eq!(record.status, ProofStatus::Valid);
    assert_eq!(record.cycles_claimed, 3);
    assert_eq!(record.group_id, 1);
}

#[test]
fn test_submit_invalid_proof_records_invalid_status() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);
    let commitment = fake_commitment(&env, 7);

    client.submit_verified_proof(&member, &2_u32, &commitment, &5_u32, &false);

    let record = client.get_proof_record(&member, &2_u32).unwrap();
    assert_eq!(record.status, ProofStatus::Invalid);
}

#[test]
fn test_proof_record_stores_correct_group_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);
    let commitment = fake_commitment(&env, 99);

    client.submit_verified_proof(&member, &3_u32, &commitment, &4_u32, &true);

    let record = client.get_proof_record(&member, &3_u32).unwrap();
    assert_eq!(record.group_commitment, commitment);
}

#[test]
fn test_get_proof_record_returns_none_before_submission() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);

    // No proof submitted yet
    assert!(client.get_proof_record(&member, &0_u32).is_none());
}

#[test]
fn test_later_submission_overwrites_earlier_record() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);
    let commitment = fake_commitment(&env, 1);

    // First submit: invalid
    client.submit_verified_proof(&member, &1_u32, &commitment, &2_u32, &false);
    let r1 = client.get_proof_record(&member, &1_u32).unwrap();
    assert_eq!(r1.status, ProofStatus::Invalid);

    // Re-submit with a valid proof (e.g. after the backend re-verified)
    client.submit_verified_proof(&member, &1_u32, &commitment, &2_u32, &true);
    let r2 = client.get_proof_record(&member, &1_u32).unwrap();
    assert_eq!(r2.status, ProofStatus::Valid);
}

#[test]
fn test_different_members_have_separate_records() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let commitment = fake_commitment(&env, 5);

    client.submit_verified_proof(&alice, &1_u32, &commitment, &3_u32, &true);
    client.submit_verified_proof(&bob, &1_u32, &commitment, &3_u32, &false);

    let alice_record = client.get_proof_record(&alice, &1_u32).unwrap();
    let bob_record = client.get_proof_record(&bob, &1_u32).unwrap();

    assert_eq!(alice_record.status, ProofStatus::Valid);
    assert_eq!(bob_record.status, ProofStatus::Invalid);
}

#[test]
fn test_same_member_different_groups_are_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);

    // Group 1: valid proof, 5 cycles
    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 1), &5_u32, &true);
    // Group 2: invalid proof, 3 cycles
    client.submit_verified_proof(&member, &2_u32, &fake_commitment(&env, 2), &3_u32, &false);

    let r1 = client.get_proof_record(&member, &1_u32).unwrap();
    let r2 = client.get_proof_record(&member, &2_u32).unwrap();

    assert_eq!(r1.status, ProofStatus::Valid);
    assert_eq!(r1.cycles_claimed, 5);
    assert_eq!(r2.status, ProofStatus::Invalid);
    assert_eq!(r2.cycles_claimed, 3);
}

#[test]
fn test_submitted_at_ledger_is_current_ledger() {
    let env = Env::default();
    env.mock_all_auths();

    let client = setup_initialized(&env);
    let member = Address::generate(&env);

    client.submit_verified_proof(&member, &1_u32, &fake_commitment(&env, 0), &2_u32, &true);

    let record = client.get_proof_record(&member, &1_u32).unwrap();
    // Default ledger sequence is 0 in test env
    assert_eq!(record.submitted_at_ledger, env.ledger().sequence());
}
