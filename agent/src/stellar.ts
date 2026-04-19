// ---------------------------------------------------------------------------
// Stellar / Soroban client helpers
// ---------------------------------------------------------------------------
// Wraps the raw Stellar SDK calls so the rest of the agent stays clean.
// All contract IDs come from environment variables set by deploy.sh.

import {
  Contract,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  scValToNative,
  xdr,
  Keypair,
} from "@stellar/stellar-sdk";
import { AgentObservation, SavingsGroup, MemberContribution } from "./types.js";

const RPC_URL   = process.env.STELLAR_RPC_URL   ?? "https://soroban-testnet.stellar.org";
const NETWORK   = process.env.STELLAR_NETWORK   ?? Networks.TESTNET;
const AGENT_KEY = process.env.AGENT_SECRET_KEY  ?? "";   // funded testnet keypair

const ROTATING_CONTRACT_ID  = process.env.ROTATING_SAVINGS_CONTRACT_ID ?? "";
const TARGET_CONTRACT_ID    = process.env.TARGET_SAVINGS_CONTRACT_ID   ?? "";
const REPUTATION_CONTRACT_ID = process.env.REPUTATION_CONTRACT_ID      ?? "";

const LEDGERS_PER_HOUR = 720; // ~5 s/ledger on Stellar

export const rpc = new SorobanRpc.Server(RPC_URL);

// ---------------------------------------------------------------------------
// Read helpers — query contract state without signing
// ---------------------------------------------------------------------------

/**
 * Call a read-only contract function and return the native JS value.
 * Uses the agent keypair as the source account for simulation — the agent
 * key must be funded on testnet for reads to work.
 */
async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  if (!contractId || !AGENT_KEY) return null;

  const contract = new Contract(contractId);
  const keypair  = Keypair.fromSecret(AGENT_KEY);
  const account  = await rpc.getAccount(keypair.publicKey()).catch(() => null);
  if (!account) return null;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(result)) return null;

  const retval = result.result?.retval;
  return retval ? scValToNative(retval) : null;
}

/**
 * Return the current ledger sequence number.
 */
export async function getCurrentLedger(): Promise<number> {
  const info = await rpc.getLatestLedger();
  return info.sequence;
}

/**
 * Return the reputation score for a member (0–100).
 * Returns 100 (default) if the reputation contract is not configured or the
 * member has no record yet.
 */
export async function fetchMemberReputationScore(member: string): Promise<number> {
  if (!REPUTATION_CONTRACT_ID) return 100;
  const result = await readContract(REPUTATION_CONTRACT_ID, "get_score", [
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromPublicKey(member).xdrAccountId(),
      ),
    ),
  ]);
  return typeof result === "number" ? result : Number(result ?? 100);
}

/**
 * Return the number of unpaid debts a member has.
 * Used to warn in reminder messages.
 */
export async function fetchMemberUnpaidDebtCount(member: string): Promise<number> {
  if (!REPUTATION_CONTRACT_ID) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debts = await readContract(REPUTATION_CONTRACT_ID, "get_debts", [
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromPublicKey(member).xdrAccountId(),
      ),
    ),
  ]) as unknown[];
  if (!Array.isArray(debts)) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return debts.filter((d: any) => !d?.paid).length;
}

/**
 * Check whether a member has contributed this cycle.
 */
export async function hasMemberContributed(
  contractId: string,
  groupId: number,
  member: string,
): Promise<boolean> {
  const result = await readContract(contractId, "has_contributed", [
    xdr.ScVal.scvU32(groupId),
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromPublicKey(member).xdrAccountId(),
      ),
    ),
  ]);
  return Boolean(result);
}

// ---------------------------------------------------------------------------
// Live observation builder — reads real state from deployed contracts
// ---------------------------------------------------------------------------

/**
 * Parse the raw scValToNative output of a rotating Group struct into
 * our SavingsGroup type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGroupStatus(raw: any): SavingsGroup["status"] {
  if (!raw || typeof raw !== "object") return "forming";
  const key = Object.keys(raw)[0]?.toLowerCase() ?? "forming";
  if (key === "active")    return "active";
  if (key === "completed") return "completed";
  if (key === "cancelled") return "cancelled";
  if (key === "matured")   return "matured";
  return "forming";
}

/**
 * Scan groups/pools from a contract by probing IDs 1..MAX_SCAN.
 * Stops at the first ID that returns null (no group at that ID).
 * contractType: "rotating" uses get_group; "target" uses get_pool.
 */
async function fetchAllFromContract(
  contractId: string,
  contractType: "rotating" | "target",
): Promise<SavingsGroup[]> {
  if (!contractId) return [];

  const method   = contractType === "rotating" ? "get_group" : "get_pool";
  const MAX_SCAN = 50;
  const groups: SavingsGroup[] = [];

  for (let id = 1; id <= MAX_SCAN; id++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await readContract(contractId, method, [xdr.ScVal.scvU32(id)]) as any;
    if (!raw || typeof raw !== "object") break; // no more groups

    const members: string[] = Array.isArray(raw.members)
      ? raw.members.map(String)
      : [];

    groups.push({
      id,
      name: contractType === "rotating"
        ? `Rotating Group #${id}`
        : `Savings Pool #${id}`,
      type: contractType,
      members,
      maxMembers:           Number(raw.max_members   ?? 0),
      contributionAmount:   BigInt(raw.contribution_amount ?? 0),
      cycleDurationLedgers: Number(raw.cycle_duration_ledgers ?? 0),
      currentCycle:         Number(raw.current_cycle  ?? 0),
      totalCycles:          Number(raw.total_cycles   ?? 0),
      cycleStartLedger:     Number(raw.cycle_start_ledger ?? 0),
      status:               parseGroupStatus(raw.status),
      token:                String(raw.token ?? ""),
    });
  }

  return groups;
}

/**
 * Build a live AgentObservation by reading all active groups and their
 * contribution state from the deployed Soroban contracts.
 */
export async function buildLiveObservation(): Promise<AgentObservation> {
  const currentLedger = await getCurrentLedger();

  // Fetch all groups from both contracts in parallel
  const [rotatingGroups, targetGroups] = await Promise.all([
    fetchAllFromContract(ROTATING_CONTRACT_ID, "rotating"),
    fetchAllFromContract(TARGET_CONTRACT_ID,   "target"),
  ]);

  const allGroups = [...rotatingGroups, ...targetGroups];
  const contributions: MemberContribution[] = [];
  const deadlinesInLedgers: Record<number, number> = {};

  // For each active group, read contribution state and deadline
  await Promise.all(
    allGroups
      .filter(g => g.status === "active")
      .map(async group => {
        const contractId = group.type === "rotating"
          ? ROTATING_CONTRACT_ID
          : TARGET_CONTRACT_ID;

        // Read deadline ledger from contract
        const deadlineMethod = group.type === "rotating" ? "cycle_deadline" : "cycle_deadline";
        const deadlineLedger = await readContract(contractId, deadlineMethod, [
          xdr.ScVal.scvU32(group.id),
        ]);
        const deadline = Number(deadlineLedger ?? 0);
        // Use group ID as key; target pools get an offset to avoid key collisions
        const key = group.type === "rotating" ? group.id : group.id + 1000;
        deadlinesInLedgers[key] = Math.max(0, deadline - currentLedger);

        // Check contribution state for each member
        await Promise.all(
          group.members.map(async member => {
            const contributed = await hasMemberContributed(contractId, group.id, member);
            contributions.push({
              groupId:     group.id,
              member,
              contributed,
              cycle:       group.currentCycle,
            });
          }),
        );
      }),
  );

  console.log(
    `[stellar] Live read: ${allGroups.length} groups, ` +
    `${contributions.length} contribution records, ` +
    `ledger ${currentLedger}`,
  );

  return { currentLedger, groups: allGroups, contributions, deadlinesInLedgers };
}

// ---------------------------------------------------------------------------
// Write helpers — submit signed transactions
// ---------------------------------------------------------------------------

/**
 * Build, sign, and submit a contract invocation.
 * Returns the transaction hash on success, throws on failure.
 */
async function invokeContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  if (!contractId || !AGENT_KEY) {
    throw new Error("Contract ID or agent key not configured");
  }

  const keypair  = Keypair.fromSecret(AGENT_KEY);
  const account  = await rpc.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  const sendResult = await rpc.sendTransaction(preparedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submission failed: ${sendResult.errorResult}`);
  }

  const hash = sendResult.hash;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const status = await rpc.getTransaction(hash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${hash}`);
    }
  }
  throw new Error(`Transaction timed out: ${hash}`);
}

/**
 * Call close_cycle on the rotating savings contract.
 */
export async function closeCycle(groupId: number): Promise<string> {
  return invokeContract(ROTATING_CONTRACT_ID, "close_cycle", [
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromSecret(AGENT_KEY).xdrAccountId(),
      ),
    ),
    xdr.ScVal.scvU32(groupId),
  ]);
}

/**
 * Call flag_default on either contract.
 */
export async function flagDefault(
  contractType: "rotating" | "target",
  groupId: number,
  member: string,
): Promise<string> {
  const contractId = contractType === "rotating"
    ? ROTATING_CONTRACT_ID
    : TARGET_CONTRACT_ID;

  return invokeContract(contractId, "flag_default", [
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromSecret(AGENT_KEY).xdrAccountId(),
      ),
    ),
    xdr.ScVal.scvU32(groupId),
    xdr.ScVal.scvAddress(
      xdr.ScAddress.scAddressTypeAccount(
        Keypair.fromPublicKey(member).xdrAccountId(),
      ),
    ),
  ]);
}
