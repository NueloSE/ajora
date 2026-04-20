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
import { execFile }  from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir }    from "os";
import { join }      from "path";
import { fileURLToPath } from "url";
import { dirname }   from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config — all overridable via Railway env vars
// ---------------------------------------------------------------------------

const PORT          = parseInt(process.env.PORT ?? "3001");
const RPC_URL       = process.env.STELLAR_RPC_URL      ?? "https://soroban-testnet.stellar.org";
const ROTATING_ID   = process.env.ROTATING_CONTRACT_ID    ?? "";
const REPUTATION_ID = process.env.REPUTATION_CONTRACT_ID  ?? "";
const NETWORK       = process.env.NETWORK_PASSPHRASE       ?? Networks.TESTNET;

// Paths — Railway sets HOME, binaries will be installed via nixpacks
const NARGO_BIN   = process.env.NARGO_BIN   ?? `${process.env.HOME}/.nargo/bin/nargo`;
const BB_BIN      = process.env.BB_BIN      ?? `${process.env.HOME}/.bb/bin/bb`;
// Default: circuits/ lives inside the zk-server package (copied at deploy time)
// so __dirname (dist/) → ../ (zk-server root) → circuits/ajora_credit
const CIRCUIT_DIR = process.env.CIRCUIT_DIR ?? join(__dirname, "..", "circuits", "ajora_credit");

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
// Proof generation — nargo execute + bb prove
// ---------------------------------------------------------------------------

async function generateProof(
  walletHex:       string,
  cyclesCompleted: number,
  commitDecimal:   string,
): Promise<Uint8Array> {
  const tmpDir = await mkdtemp(join(tmpdir(), "ajora-zk-"));

  try {
    const proverToml = [
      `wallet_address   = "${walletHex}"`,
      `cycles_completed = "${cyclesCompleted}"`,
      `group_commitment = "${commitDecimal}"`,
      `min_cycles       = "1"`,
    ].join("\n");

    const circuitProverPath = join(CIRCUIT_DIR, "Prover.toml");
    const originalProver = await readFile(circuitProverPath, "utf8").catch(() => "");
    await writeFile(circuitProverPath, proverToml, "utf8");

    let witnessFileName: string;
    try {
      witnessFileName = "ajora_api_witness";
      await execFileAsync(NARGO_BIN, ["execute", witnessFileName], {
        cwd: CIRCUIT_DIR,
        timeout: 30_000,
      });
    } finally {
      if (originalProver) await writeFile(circuitProverPath, originalProver, "utf8");
    }

    const witnessPath = join(CIRCUIT_DIR, "target", `${witnessFileName}.gz`);
    const proveOutDir = join(tmpDir, "out");

    await execFileAsync(BB_BIN, [
      "prove",
      "-s", "ultra_honk",
      "-b", join(CIRCUIT_DIR, "target", "ajora_credit.json"),
      "-w", witnessPath,
      "-o", proveOutDir,
    ], { timeout: 60_000 });

    return await readFile(join(proveOutDir, "proof"));

  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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

    const defaultCount    = await getDefaultCount(walletAddress);
    const onChainCycles   = await getGroupCycleCount(groupId);
    const cyclesCompleted = defaultCount === 0 && onChainCycles >= 1 ? onChainCycles : 0;

    if (cyclesCompleted === 0) {
      res.json({
        verified:        false,
        reason:          defaultCount > 0
          ? `Cannot generate proof: ${defaultCount} default(s) on record. Repay your debts first.`
          : "Cannot generate proof: no completed cycles in this group yet.",
        cyclesCompleted: 0,
        commitment:      null,
        proof:           null,
      });
      return;
    }

    const { commitBytes, commitDecimal, walletHex } =
      await computeCommitment(walletAddress, cyclesCompleted);

    const proofBytes = await generateProof(walletHex, cyclesCompleted, commitDecimal);

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
  console.log(`NARGO_BIN:   ${NARGO_BIN}`);
  console.log(`BB_BIN:      ${BB_BIN}`);
  console.log(`CIRCUIT_DIR: ${CIRCUIT_DIR}`);
});
