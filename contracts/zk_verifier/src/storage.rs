use soroban_sdk::{contracttype, Address, Bytes, BytesN, Env};

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The circuit's Verification Key — set once at deployment, never changes.
    /// Anyone with this key can verify proofs for the Ajora credit circuit.
    VerificationKey,

    /// Whether the contract has been initialised with a VK.
    /// Prevents double-initialization.
    Initialized,

    /// Proof record keyed by (member_address, group_id).
    /// Stores the result of a verified proof so it can be queried later
    /// without re-verifying.
    ProofRecord(Address, u32),

    /// The admin account allowed to initialise the contract.
    Admin,
}

// ---------------------------------------------------------------------------
// Data Types
// ---------------------------------------------------------------------------

/// The outcome of a submitted proof
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum ProofStatus {
    /// Proof was submitted and verified valid
    Valid,
    /// Proof was submitted but verification failed
    Invalid,
}

/// On-chain record of a verified proof submission
#[contracttype]
#[derive(Clone)]
pub struct ProofRecord {
    /// The member who generated the proof
    pub member: Address,
    /// Which group (or pool) the proof relates to
    pub group_id: u32,
    /// The public input: on-chain commitment the proof was checked against
    /// = poseidon(wallet_address, cycles_completed), stored by the savings contract
    pub group_commitment: BytesN<32>,
    /// The public input: minimum cycles the member claimed to have completed
    pub cycles_claimed: u32,
    /// Whether the proof checked out
    pub status: ProofStatus,
    /// Ledger number when this proof was submitted
    pub submitted_at_ledger: u32,
}

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

/// Store the verification key on first initialization
pub fn save_vk(env: &Env, vk: &Bytes) {
    env.storage().persistent().set(&DataKey::VerificationKey, vk);
    env.storage().persistent().set(&DataKey::Initialized, &true);
}

/// Load the stored verification key
pub fn load_vk(env: &Env) -> Bytes {
    env.storage()
        .persistent()
        .get(&DataKey::VerificationKey)
        .expect("VK not initialised")
}

/// Check whether the contract has been initialised
pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Initialized)
        .unwrap_or(false)
}

/// Save a proof record after verification
pub fn save_proof_record(env: &Env, member: &Address, group_id: u32, record: &ProofRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::ProofRecord(member.clone(), group_id), record);
}

/// Load an existing proof record, if any
pub fn load_proof_record(env: &Env, member: &Address, group_id: u32) -> Option<ProofRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::ProofRecord(member.clone(), group_id))
}

/// Store the admin address
pub fn save_admin(env: &Env, admin: &Address) {
    env.storage().persistent().set(&DataKey::Admin, admin);
}

/// Load the admin address
pub fn load_admin(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get(&DataKey::Admin)
        .expect("Admin not set")
}
