#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient as TokenAdminClient,
    Address, Env,
};

use rotating_savings::{RotatingSavings, RotatingSavingsClient};

fn setup_active_group(
    env: &Env,
) -> (RotatingSavingsClient<'_>, u32, Address, Address, Address) {
    let contract_id = env.register(RotatingSavings, ());
    let client = RotatingSavingsClient::new(env, &contract_id);

    let token_admin = Address::generate(env);
    let token_address = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_admin_client = TokenAdminClient::new(env, &token_address);

    let admin = Address::generate(env);
    let alice = Address::generate(env);
    let bob = Address::generate(env);

    token_admin_client.mint(&alice, &20_000_000_i128);
    token_admin_client.mint(&bob, &20_000_000_i128);

    let group_id = client.create_group(&admin, &token_address, &5_000_000_i128, &100_u32, &2_u32);
    client.join_group(&group_id, &alice);
    client.join_group(&group_id, &bob);

    (client, group_id, alice, bob, admin)
}

// ---------------------------------------------------------------------------
// flag_default
// ---------------------------------------------------------------------------

#[test]
fn test_can_flag_member_who_missed_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, bob, admin) = setup_active_group(&env);

    // Only bob contributes — alice misses the deadline
    client.contribute(&group_id, &bob);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Flagging alice (who did NOT contribute) should succeed
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_member_who_contributed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _bob, admin) = setup_active_group(&env);

    client.contribute(&group_id, &alice);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    // Alice contributed — should panic with MemberContributed
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_default_before_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, alice, _bob, admin) = setup_active_group(&env);

    // Deadline has NOT passed — should panic with CycleNotOver
    client.flag_default(&admin, &group_id, &alice);
}

#[test]
#[should_panic]
fn test_cannot_flag_non_member() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, group_id, _alice, _bob, admin) = setup_active_group(&env);

    env.ledger().with_mut(|l| { l.sequence_number += 101; });

    let outsider = Address::generate(&env);
    // Outsider is not in the group — should panic with NotAMember
    client.flag_default(&admin, &group_id, &outsider);
}
