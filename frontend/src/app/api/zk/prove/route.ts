// ---------------------------------------------------------------------------
// ZK Proof Generation API Route — proxy to Railway ZK server
// ---------------------------------------------------------------------------
// In production (Vercel) this route simply forwards the request to the
// Railway-hosted ZK server where nargo + bb binaries are available.
//
// In local dev, if ZK_SERVER_URL is not set, it falls back to running
// nargo/bb directly (requires local installation).
//
// Environment variable:
//   ZK_SERVER_URL — Railway internal URL, e.g. https://ajora-zk.up.railway.app
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import {
  Contract, Networks, rpc as SorobanRpc, TransactionBuilder,
  BASE_FEE, nativeToScVal, xdr, scValToNative, StrKey,
} from "@stellar/stellar-sdk";
import { execFile }   from "child_process";
import { promisify }  from "util";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir }     from "os";
import { join }       from "path";

const execFileAsync = promisify(execFile);

const ZK_SERVER_URL = process.env.ZK_SERVER_URL ?? "";   // set on Vercel → Railway

const RPC_URL       = process.env.NEXT_PUBLIC_STELLAR_RPC_URL      ?? "https://soroban-testnet.stellar.org";
const ROTATING_ID   = process.env.NEXT_PUBLIC_ROTATING_CONTRACT_ID    ?? "";
const REPUTATION_ID = process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID  ?? "";
const NETWORK       = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE       ?? Networks.TESTNET;
const SIM_ACCOUNT   = "GC3BYGUYPLUFX3PGUQ4SWWPHLAGRNTJ7F35KWFKXNVKVUUAMNOP5SU6Y";

const NARGO_BIN    = process.env.NARGO_BIN    ?? `${process.env.HOME}/.nargo/bin/nargo`;
const BB_BIN       = process.env.BB_BIN       ?? `${process.env.HOME}/.bb/bin/bb`;
const CIRCUIT_DIR  = process.env.CIRCUIT_DIR  ??
  join(process.cwd(), "..", "circuits", "ajora_credit");

const server = new SorobanRpc.Server(RPC_URL);

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = await req.json() as { walletAddress?: string; groupId?: number };

  // ── Production path: forward to Railway ZK server ──────────────────────
  if (ZK_SERVER_URL) {
    try {
      const upstream = await fetch(`${ZK_SERVER_URL}/prove`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    } catch (err) {
      console.error("[ZK prove proxy]", err);
      return NextResponse.json(
        { error: "ZK server unreachable", verified: false },
        { status: 502 },
      );
    }
  }

  // ── Local dev fallback: run nargo + bb directly ─────────────────────────
  try {
    const { walletAddress, groupId } = body;

    if (!walletAddress || !groupId) {
      return NextResponse.json(
        { error: "Missing walletAddress or groupId" },
        { status: 400 },
      );
    }

    const defaultCount    = await getDefaultCount(walletAddress);
    const onChainCycles   = await getGroupCycleCount(groupId);
    const cyclesCompleted = defaultCount === 0 && onChainCycles >= 1 ? onChainCycles : 0;

    if (cyclesCompleted === 0) {
      return NextResponse.json({
        verified:        false,
        reason:          defaultCount > 0
          ? `Cannot generate proof: ${defaultCount} default(s) on record. Repay your debts first.`
          : "Cannot generate proof: no completed cycles in this group yet.",
        cyclesCompleted: 0,
        commitment:      null,
        proof:           null,
      });
    }

    const { commitBytes, commitDecimal, walletHex } =
      await computeCommitment(walletAddress, cyclesCompleted);

    const proofBytes = await generateProof(walletHex, cyclesCompleted, commitDecimal);

    return NextResponse.json({
      verified:        true,
      cyclesCompleted,
      commitment:      bufToHex(commitBytes),
      proof:           bufToHex(proofBytes),
    });

  } catch (err) {
    console.error("[ZK prove]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proof generation failed", verified: false },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Soroban read helpers (used in local dev fallback only)
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
// Pedersen hash + proof generation (local dev fallback)
// ---------------------------------------------------------------------------

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

  const bb       = await Barretenberg.new({ threads: 1 });
  const walletFr = new Fr(walletBytes);
  const cyclesFr = new Fr(BigInt(cyclesCompleted));
  const commitFr = await bb.pedersenHash([walletFr, cyclesFr], 0);
  await bb.destroy();

  const commitDecimal = BigInt("0x" + bufToHex(commitFr.value)).toString();
  const walletHex     = "0x" + bufToHex(walletFr.value);

  return { commitBytes: commitFr.value, commitDecimal, walletHex };
}

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
