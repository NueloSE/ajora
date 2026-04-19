// ---------------------------------------------------------------------------
// Soroban read helpers — no wallet required
// ---------------------------------------------------------------------------
import {
  Contract,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  scValToNative,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const ROTATING_ID    = process.env.NEXT_PUBLIC_ROTATING_CONTRACT_ID    ?? "";
export const TARGET_ID      = process.env.NEXT_PUBLIC_TARGET_CONTRACT_ID      ?? "";
export const ZK_ID          = process.env.NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID ?? "";
export const REPUTATION_ID  = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID  ?? "";
export const TESTNET_USDC   = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

// A funded testnet account used as the fee-source for read-only simulations.
// This is a public key only — no secret is exposed.
const SIM_ACCOUNT = "GC3BYGUYPLUFX3PGUQ4SWWPHLAGRNTJ7F35KWFKXNVKVUUAMNOP5SU6Y";

export const rpc = new SorobanRpc.Server(RPC_URL);

async function simulate(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  if (!contractId) return null;
  const contract = new Contract(contractId);
  const account  = await rpc.getAccount(SIM_ACCOUNT).catch(() => null);
  if (!account) return null;

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(result)) return null;
  const retval = (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  return retval ? scValToNative(retval) : null;
}

// ---------------------------------------------------------------------------
// Types (matching Soroban contract structs after scValToNative)
// ---------------------------------------------------------------------------

export type GroupStatusTag = "Forming" | "Active" | "Completed" | "Cancelled";
export type PoolStatusTag  = "Forming" | "Active" | "Matured"   | "Cancelled";

export interface DebtRecord {
  creditor:  string;
  amount:    bigint;
  group_id:  number;
  cycle:     number;
  token:     string;
  paid:      boolean;
}

export interface ReputationData {
  score:             number;
  defaultCount:      number;
  activeGroups:      number;
  maxAllowedGroups:  number;
  isLocked:          boolean;
  lockedUntilLedger: number;
  lockedUntilDate:   Date | null;
  debts:             DebtRecord[];
  unpaidDebts:       DebtRecord[];
}

export interface OnChainGroup {
  id: number;
  admin: string;
  members: string[];
  max_members: number;
  contribution_amount: bigint;
  cycle_duration_ledgers: number;
  payout_order: string[];
  current_cycle: number;
  total_cycles: number;
  cycle_start_ledger: number;
  status: GroupStatusTag;
  token: string;
}

export interface OnChainPool {
  id: number;
  admin: string;
  members: string[];
  max_members: number;
  contribution_amount: bigint;
  cycle_duration_ledgers: number;
  total_cycles: number;
  current_cycle: number;
  cycle_start_ledger: number;
  status: PoolStatusTag;
  token: string;
}

function parseStatus(raw: unknown, numericMap?: Record<number, string>): string {
  if (typeof raw === "string") return raw;
  // Soroban enum returned as numeric discriminant (u32)
  if (typeof raw === "number" && numericMap) return numericMap[raw] ?? "Unknown";
  if (typeof raw === "bigint" && numericMap) return numericMap[Number(raw)] ?? "Unknown";
  if (raw && typeof raw === "object" && "tag" in (raw as Record<string, unknown>)) {
    return (raw as { tag: string }).tag;
  }
  return "Unknown";
}

const GROUP_STATUS_MAP: Record<number, string> = { 0: "Forming", 1: "Active", 2: "Completed", 3: "Cancelled" };
const POOL_STATUS_MAP:  Record<number, string> = { 0: "Forming", 1: "Active", 2: "Matured",   3: "Cancelled" };

// ---------------------------------------------------------------------------
// Rotating savings reads
// ---------------------------------------------------------------------------

export async function fetchGroup(groupId: number): Promise<OnChainGroup | null> {
  const raw = await simulate(ROTATING_ID, "get_group", [xdr.ScVal.scvU32(groupId)]);
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  return {
    id: groupId,
    admin:                  String(g.admin ?? ""),
    members:                (g.members as string[]) ?? [],
    max_members:            Number(g.max_members ?? 0),
    contribution_amount:    BigInt(String(g.contribution_amount ?? 0)),
    cycle_duration_ledgers: Number(g.cycle_duration_ledgers ?? 0),
    payout_order:           (g.payout_order as string[]) ?? [],
    current_cycle:          Number(g.current_cycle ?? 0),
    total_cycles:           Number(g.total_cycles ?? 0),
    cycle_start_ledger:     Number(g.cycle_start_ledger ?? 0),
    status:                 parseStatus(g.status, GROUP_STATUS_MAP) as GroupStatusTag,
    token:                  String(g.token ?? ""),
  };
}

export async function fetchAllGroups(): Promise<OnChainGroup[]> {
  const groups: OnChainGroup[] = [];
  for (let id = 1; id <= 20; id++) {
    const g = await fetchGroup(id);
    if (!g) break;
    groups.push(g);
  }
  return groups;
}

export async function fetchGroupCount(): Promise<number> {
  // Groups are created with IDs 1, 2, 3... scan until null
  let count = 0;
  for (let id = 1; id <= 20; id++) {
    const g = await simulate(ROTATING_ID, "get_group", [xdr.ScVal.scvU32(id)]);
    if (!g) break;
    count = id;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Target savings reads
// ---------------------------------------------------------------------------

export async function fetchPool(poolId: number): Promise<OnChainPool | null> {
  const raw = await simulate(TARGET_ID, "get_pool", [xdr.ScVal.scvU32(poolId)]);
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  return {
    id: poolId,
    admin:                  String(p.admin ?? ""),
    members:                (p.members as string[]) ?? [],
    max_members:            Number(p.max_members ?? 0),
    contribution_amount:    BigInt(String(p.contribution_amount ?? 0)),
    cycle_duration_ledgers: Number(p.cycle_duration_ledgers ?? 0),
    total_cycles:           Number(p.total_cycles ?? 0),
    current_cycle:          Number(p.current_cycle ?? 0),
    cycle_start_ledger:     Number(p.cycle_start_ledger ?? 0),
    status:                 parseStatus(p.status, POOL_STATUS_MAP) as PoolStatusTag,
    token:                  String(p.token ?? ""),
  };
}

export async function fetchAllPools(): Promise<OnChainPool[]> {
  const pools: OnChainPool[] = [];
  for (let id = 1; id <= 20; id++) {
    const p = await fetchPool(id);
    if (!p) break;
    pools.push(p);
  }
  return pools;
}

export async function fetchMemberBalance(poolId: number, member: string): Promise<bigint> {
  const raw = await simulate(TARGET_ID, "get_balance", [
    xdr.ScVal.scvU32(poolId),
    nativeToScVal(member, { type: "address" }),
  ]);
  return BigInt(String(raw ?? 0));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const STROOPS_PER_USDC = BigInt(10_000_000);

/** Convert stroops (i128) to a human-readable USDC amount */
export function stroopsToUsdc(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_USDC;
  const frac  = stroops % STROOPS_PER_USDC;
  if (frac === BigInt(0)) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

/** 1 USDC = 10_000_000 stroops */
export function usdcToStroops(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10_000_000));
}

/** Fetch the USDC balance of a Stellar address (smart wallet or classic). Returns stroops. */
export async function fetchUsdcBalance(address: string): Promise<bigint> {
  const raw = await simulate(TESTNET_USDC, "balance", [
    nativeToScVal(address, { type: "address" }),
  ]);
  if (raw === null || raw === undefined) return BigInt(0);
  return BigInt(String(raw));
}

// ---------------------------------------------------------------------------
// Reputation reads
// ---------------------------------------------------------------------------

export async function fetchReputationData(address: string): Promise<ReputationData | null> {
  if (!REPUTATION_ID || !address) return null;

  const addr = nativeToScVal(address, { type: "address" });

  const [score, debtsRaw, isLocked, lockedUntilRaw, activeGroups, maxAllowed, defaultCount, latestLedger] =
    await Promise.all([
      simulate(REPUTATION_ID, "get_score",         [addr]),
      simulate(REPUTATION_ID, "get_debts",         [addr]),
      simulate(REPUTATION_ID, "is_locked",         [addr]),
      simulate(REPUTATION_ID, "locked_until",      [addr]),
      simulate(REPUTATION_ID, "get_active_groups", [addr]),
      simulate(REPUTATION_ID, "max_allowed_groups",[addr]),
      simulate(REPUTATION_ID, "get_default_count", [addr]),
      rpc.getLatestLedger().catch(() => null),
    ]);

  const scoreNum            = Number(score ?? 100);
  const lockedUntilLedger   = Number(lockedUntilRaw ?? 0);
  const isLockedBool        = Boolean(isLocked);

  let lockedUntilDate: Date | null = null;
  if (isLockedBool && lockedUntilLedger > 0 && latestLedger) {
    const remaining      = Math.max(0, lockedUntilLedger - latestLedger.sequence);
    lockedUntilDate      = new Date(Date.now() + remaining * 5_000);
  }

  const rawDebts = Array.isArray(debtsRaw) ? (debtsRaw as Record<string, unknown>[]) : [];
  const debts: DebtRecord[] = rawDebts.map(d => ({
    creditor: String(d.creditor ?? ""),
    amount:   BigInt(String(d.amount ?? "0")),
    group_id: Number(d.group_id ?? 0),
    cycle:    Number(d.cycle ?? 0),
    token:    String(d.token ?? ""),
    paid:     Boolean(d.paid),
  }));

  return {
    score:            scoreNum,
    defaultCount:     Number(defaultCount ?? 0),
    activeGroups:     Number(activeGroups ?? 0),
    maxAllowedGroups: Number(maxAllowed ?? 2),
    isLocked:         isLockedBool,
    lockedUntilLedger,
    lockedUntilDate,
    debts,
    unpaidDebts: debts.filter(d => !d.paid),
  };
}

// ---------------------------------------------------------------------------
// ZK proof verification
// ---------------------------------------------------------------------------

// Public key of the kalepail fee-source account where proof commitments are stored.
// Derived from: Keypair.fromRawEd25519Seed(hash(Buffer.from("kalepail"))).publicKey()
const KALEPAIL_PK = "GC2C7AWLS2FMFTQAHW3IBUB4ZXVP4E37XNLEF2IK7IVXBB6CMEPCSXFO";

/**
 * Check whether a smart wallet address has a ZK proof commitment recorded
 * on Stellar testnet.
 *
 * Proofs are stored as manageData entries on the kalepail fee-source account:
 *   key  = "zkp:{last_12_chars_of_address}"
 *   value = 32-byte SHA-256 commitment (base64-encoded by Horizon)
 *
 * Uses the Stellar Horizon REST API — no wallet or signing required.
 */
export async function hasZkProofOnChain(address: string): Promise<boolean> {
  try {
    const key = `zkp:${address.slice(-12)}`;
    const res = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${KALEPAIL_PK}`,
      { cache: "no-store" },
    );
    if (!res.ok) return false;
    const account = await res.json() as { data?: Record<string, string> };
    // Horizon returns manageData entries as { [key: string]: base64EncodedValue }
    return key in (account.data ?? {});
  } catch {
    return false;
  }
}
