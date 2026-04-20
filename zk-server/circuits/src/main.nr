// Ajora Credit Proof Circuit
// Proves: "I completed N savings cycles without defaulting"
// Without revealing: wallet address, balance, or identity
//
// Public inputs (verifier knows these - stored on Stellar blockchain):
//   group_commitment: pedersen_hash(wallet_address, cycles_completed)
//   min_cycles:       minimum cycles required by the new group
//
// Private inputs (only the prover knows these - never leaves their device):
//   wallet_address:   the member's Stellar account encoded as a Field element
//   cycles_completed: how many cycles they actually completed

fn main(
    // Private inputs - never revealed to verifier
    wallet_address: Field,
    cycles_completed: u32,

    // Public inputs - stored on-chain and visible to everyone
    group_commitment: pub Field,
    min_cycles: pub u32
) {
    // Constraint 1: member completed enough cycles for this group
    assert(cycles_completed >= min_cycles);

    // Constraint 2: their private savings record matches the on-chain commitment
    // The savings contract stores pedersen_hash(wallet, cycles) when a member
    // completes a cycle. The prover knows the pre-image (wallet, cycles).
    // This proves they ARE that member without revealing which address they are.
    let computed = std::hash::pedersen_hash([wallet_address, cycles_completed as Field]);
    assert(computed == group_commitment);
}
