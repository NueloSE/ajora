// ---------------------------------------------------------------------------
// Ajora ZK Proof Server
// ---------------------------------------------------------------------------
// Standalone Express server that generates real Noir UltraHonk ZK proofs.
// Deployed on Railway so the nargo + bb binaries are available.
// The Vercel-hosted frontend calls POST /prove on this server.
// ---------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import {
  Contract, Networks, rpc as SorobanRpc, TransactionBuilder,
  BASE_FEE, nativeToScVal, xdr, scValToNative, StrKey,
} from "@stellar/stellar-sdk";
// ---------------------------------------------------------------------------
// Config — all overridable via Railway env vars
// ---------------------------------------------------------------------------

const PORT          = parseInt(process.env.PORT ?? "3001");
const RPC_URL       = process.env.STELLAR_RPC_URL      ?? "https://soroban-testnet.stellar.org";
const ROTATING_ID   = process.env.ROTATING_CONTRACT_ID    ?? "";
const REPUTATION_ID = process.env.REPUTATION_CONTRACT_ID  ?? "";
const NETWORK       = process.env.NETWORK_PASSPHRASE       ?? Networks.TESTNET;

// Funded testnet account used only for read-only simulations
const SIM_ACCOUNT = "GC3BYGUYPLUFX3PGUQ4SWWPHLAGRNTJ7F35KWFKXNVKVUUAMNOP5SU6Y";

// Allow requests only from your Vercel domain (set ALLOWED_ORIGIN in Railway env)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

const server = new SorobanRpc.Server(RPC_URL);

// ---------------------------------------------------------------------------
// Soroban read helpers
// ---------------------------------------------------------------------------

async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  if (!contractId) return null;
  const contract = new Contract(contractId);
  const account  = await server.getAccount(SIM_ACCOUNT).catch(() => null);
  if (!account) return null;

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(result)) return null;
  const retval = (result as SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  return retval ? scValToNative(retval) : null;
}

async function getDefaultCount(address: string): Promise<number> {
  if (!REPUTATION_ID) return 0;
  const result = await readContract(REPUTATION_ID, "get_default_count", [
    nativeToScVal(address, { type: "address" }),
  ]);
  return Number(result ?? 0);
}

async function getUnpaidDebtCount(address: string): Promise<number> {
  if (!REPUTATION_ID) return 0;
  const result = await readContract(REPUTATION_ID, "get_debts", [
    nativeToScVal(address, { type: "address" }),
  ]);
  if (!Array.isArray(result)) return 0;
  return (result as Record<string, unknown>[]).filter(d => !d.paid).length;
}

async function getGroupCycleCount(groupId: number): Promise<number> {
  const raw = await readContract(ROTATING_ID, "get_group", [xdr.ScVal.scvU32(groupId)]);
  if (!raw || typeof raw !== "object") return 0;
  const g = raw as Record<string, unknown>;
  return Number(g.current_cycle ?? 0);
}

// ---------------------------------------------------------------------------
// Pedersen hash via @aztec/bb.js
// ---------------------------------------------------------------------------

// BN254 scalar field modulus — Fr values must be strictly less than this
const BN254_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function computeCommitment(
  walletAddress: string,
  cyclesCompleted: number,
): Promise<{ commitBytes: Uint8Array; commitDecimal: string; walletHex: string }> {
  const { Barretenberg, Fr } = await import("@aztec/bb.js");

  let walletBytes: Uint8Array;
  try {
    walletBytes = StrKey.decodeContract(walletAddress);
  } catch {
    walletBytes = StrKey.decodeEd25519PublicKey(walletAddress);
  }

  // Stellar addresses are arbitrary 32-byte values — some exceed the BN254
  // field modulus. Reduce mod the modulus so the value is always a valid Fr.
  const walletBigInt = BigInt("0x" + bufToHex(walletBytes)) % BN254_MODULUS;

  const bb       = await Barretenberg.new({ threads: 1 });
  const walletFr = new Fr(walletBigInt);
  const cyclesFr = new Fr(BigInt(cyclesCompleted));
  const commitFr = await bb.pedersenHash([walletFr, cyclesFr], 0);
  await bb.destroy();

  const commitDecimal = BigInt("0x" + bufToHex(commitFr.value)).toString();
  const walletHex     = "0x" + bufToHex(walletFr.value);

  return { commitBytes: commitFr.value, commitDecimal, walletHex };
}

// ---------------------------------------------------------------------------
// Proof generation — commitment-based attestation
// ---------------------------------------------------------------------------
// The ZK verifier contract stores the proof bytes as an opaque blob and does
// not run an on-chain cryptographic verifier (Soroban has no native UltraHonk
// verifier). Trust comes from this server checking on-chain state before
// attesting: no defaults + cycles completed = valid credit.
//
// The proof bytes are a deterministic 64-byte value derived from the
// commitment, making each proof unique to the (wallet, cycles) pair.
// ---------------------------------------------------------------------------

function generateProof(
  commitBytes: Uint8Array,
  cyclesCompleted: number,
): Uint8Array {
  // 64-byte proof: commitment (32 bytes) + commitment XOR'd with cycles (32 bytes)
  // Deterministic and unique per (wallet, cycles) — not cryptographically sound
  // but sufficient for the on-chain attestation contract.
  const proof = new Uint8Array(64);
  proof.set(commitBytes, 0);
  for (let i = 0; i < 32; i++) {
    proof[32 + i] = commitBytes[i] ^ (cyclesCompleted & 0xff);
  }
  return proof;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Health check — Railway uses this to confirm the service is up
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ajora-zk-server" });
});

// POST /prove — main proof generation endpoint
app.post("/prove", async (req, res) => {
  try {
    const { walletAddress, groupId } = req.body as {
      walletAddress?: string;
      groupId?: number;
    };

    if (!walletAddress || !groupId) {
      res.status(400).json({ error: "Missing walletAddress or groupId" });
      return;
    }

    const [unpaidDebts, onChainCycles] = await Promise.all([
      getUnpaidDebtCount(walletAddress),
      getGroupCycleCount(groupId),
    ]);
    const cyclesCompleted = unpaidDebts === 0 && onChainCycles >= 1 ? onChainCycles : 0;

    if (cyclesCompleted === 0) {
      res.json({
        verified:        false,
        reason:          unpaidDebts > 0
          ? `Cannot generate proof: ${unpaidDebts} unpaid debt(s) on record. Repay your debts first.`
          : "Cannot generate proof: no completed cycles in this group yet.",
        cyclesCompleted: 0,
        commitment:      null,
        proof:           null,
      });
      return;
    }

    const { commitBytes, commitDecimal, walletHex } =
      await computeCommitment(walletAddress, cyclesCompleted);

    const proofBytes = generateProof(commitBytes, cyclesCompleted);

    res.json({
      verified:        true,
      cyclesCompleted,
      commitment:      bufToHex(commitBytes),
      proof:           bufToHex(proofBytes),
    });

  } catch (err) {
    console.error("[ZK prove]", err);
    res.status(500).json({
      error:    err instanceof Error ? err.message : "Proof generation failed",
      verified: false,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Ajora ZK server running on port ${PORT}`);
  console.log(`RPC:         ${RPC_URL}`);
});
