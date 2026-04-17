#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};

/// Set up: deploy the contract, register a real mock USDC token,
/// create alice + bob, mint them tokens, fill the group to Active.
fn setup_active_group(
    env: &Env,
) -> (RotatingSavingsClient<'_>, u32, Address, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);

    // Register a real mock USDC token so token::Client calls succeed
    let token_admin = Address::generate(env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(env, &token_address);

    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    // Mint enough tokens for 3 contributions each (generous)
    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob, &20_000_000_i128);

    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &2_u32);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    // Group is now Active
    (client, group_id, alice, bob, token_address)
}

// ---------------------------------------------------------------------------
// contribute
// ---------------------------------------------------------------------------

#[test]
fn test_has_contributed_is_false_before_contribution() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _, _) = setup_active_group(&env);

    assert!(!client.has_contributed(&group_id, &alice));
}

#[test]
fn test_has_contributed_is_true_after_contribution() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);

    assert!(client.has_contributed(&group_id, &alice));
}

#[test]
fn test_both_members_can_contribute_same_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);
    client.contribute(&group_id, &bob);

    assert!(client.has_contributed(&group_id, &alice));
    assert!(client.has_contributed(&group_id, &bob));
}

#[test]
#[should_panic]
fn test_cannot_contribute_twice_in_same_cycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _, _) = setup_active_group(&env);

    client.contribute(&group_id, &alice);
    // Second contribution in the same cycle should panic with AlreadyContributed
    client.contribute(&group_id, &alice);
}

#[test]
#[should_panic]
fn test_non_member_cannot_contribute() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, _, _, _) = setup_active_group(&env);

    let outsider = Address::generate(&env);
    // Outsider is not a member — should panic with NotAMember
    client.contribute(&group_id, &outsider);
}

#[test]
#[should_panic]
fn test_cannot_contribute_after_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _, _) = setup_active_group(&env);

    // Advance ledger past the cycle deadline (cycle_duration_ledgers = 100)
    env.ledger().with_mut(|l| {
        l.sequence_number += 101;
    });

    // Deadline has passed — should panic with DeadlinePassed
    client.contribute(&group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_contribute_to_forming_group() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_admin_client = TokenAdminClient::new(&env, &token_address);

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    token_admin_client.mint(&alice, &20_000_000_i128);

    // Create group but don't fill it — stays Forming
    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &5_u32);
    client.join_group(&group_id, &alice);

    // Group is still Forming — contribution should panic with InvalidGroupStatus
    client.contribute(&group_id, &alice);
}
