// ---------------------------------------------------------------------------
// Contract write helpers — build, WebAuthn-sign auth entries, submit
// ---------------------------------------------------------------------------
// Each transaction:
//   1. Built with kalepail (testnet fee source) as the Stellar source account
//   2. Simulated to get Soroban auth entries
//   3. Auth entries for the Smart Wallet are signed via WebAuthn (biometric prompt)
//   4. Outer transaction envelope signed by kalepail
//   5. Submitted to Stellar RPC
//
// The user's private key NEVER appears in this file.
// ---------------------------------------------------------------------------

import {
  Contract,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  StrKey,
  hash,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

import { rpc, ROTATING_ID, TARGET_ID } from "./soroban";
import { getSession, primePasskeyKit } from "./passkey";

const NETWORK   = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const RPC_URL   = process.env.NEXT_PUBLIC_STELLAR_RPC_URL    ?? "https://soroban-testnet.stellar.org";
const WASM_HASH = "ecd990f0b45ca6817149b6175f79b32efb442f35731985a084131e8265c4cd90";

export const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

// Kalepail's testnet keypair — public, funded, used as the fee source.
// The USER's key is never here.
const feeKeypair = Keypair.fromRawEd25519Seed(hash(Buffer.from("kalepail")));

// ---------------------------------------------------------------------------
// Core: build → simulate → WebAuthn-sign auth entries → submit
// ---------------------------------------------------------------------------

async function buildAndSubmit(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const session = getSession();
  if (!session) throw new Error("Not signed in");

  // Build transaction with kalepail as the fee-paying source account
  const contract = new Contract(contractId);
  const account  = await rpc.getAccount(feeKeypair.publicKey());

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get footprint + auth entries
  const simResult = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${(simResult as SorobanRpc.Api.SimulateTransactionErrorResponse).error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(
    tx,
    simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse,
  ).build();

  // Sign auth entries for the smart wallet using WebAuthn (triggers biometric)
  const authEntries: xdr.SorobanAuthorizationEntry[] =
    ((preparedTx.operations[0] as unknown) as { auth?: xdr.SorobanAuthorizationEntry[] }).auth ?? [];

  if (authEntries.length > 0) {
    const kit = await primePasskeyKit(session.contractId, session.keyIdBase64);

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      // Only sign entries that require credentials (Soroban address-based auth)
      if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;

      const addrCreds = entry.credentials().address();
      const scAddr    = addrCreds.address();
      if (scAddr.switch().name !== "scAddressTypeContract") continue;

      // Check the entry is for this user's smart wallet
      const entryContractId = StrKey.encodeContract(Buffer.from(scAddr.contractId() as unknown as Uint8Array));
      if (entryContractId !== session.contractId) continue;

      // Sign via WebAuthn — prompts biometric on device
      authEntries[i] = await kit.signAuthEntry(entry, { keyId: session.keyIdBase64 });
    }
  }

  // Sign the outer transaction envelope with the fee source keypair
  preparedTx.sign(feeKeypair);

  const sendResult = await rpc.sendTransaction(preparedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submission failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const txHash = sendResult.hash;
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await rpc.getTransaction(txHash);
    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return txHash;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Transaction failed: ${txHash}`);
  }
  throw new Error(`Transaction timed out: ${txHash}`);
}

function addressArg(addr: string): xdr.ScVal {
  return nativeToScVal(addr, { type: "address" });
}

// ---------------------------------------------------------------------------
// Rotating savings
// ---------------------------------------------------------------------------

export async function createGroup(
  caller: string,
  contributionUsdc: number,
  cycleDays: number,
  maxMembers: number,
): Promise<string> {
  const stroops = BigInt(Math.round(contributionUsdc * 10_000_000));
  const ledgers = Math.round(cycleDays * 17_280);
  return buildAndSubmit(ROTATING_ID, "create_group", [
    addressArg(caller),
    addressArg(TESTNET_USDC),
    nativeToScVal(stroops, { type: "i128" }),
    nativeToScVal(ledgers, { type: "u32" }),
    nativeToScVal(maxMembers, { type: "u32" }),
  ]);
}

export async function joinGroup(caller: string, groupId: number): Promise<string> {
  return buildAndSubmit(ROTATING_ID, "join_group", [
    nativeToScVal(groupId, { type: "u32" }),
    addressArg(caller),
  ]);
}

export async function contribute(caller: string, groupId: number): Promise<string> {
  return buildAndSubmit(ROTATING_ID, "contribute", [
    nativeToScVal(groupId, { type: "u32" }),
    addressArg(caller),
  ]);
}

// ---------------------------------------------------------------------------
// Target savings
// ---------------------------------------------------------------------------

export async function createPool(
  caller: string,
  contributionUsdc: number,
  cycleDays: number,
  totalCycles: number,
  maxMembers: number,
): Promise<string> {
  const stroops = BigInt(Math.round(contributionUsdc * 10_000_000));
  const ledgers = Math.round(cycleDays * 17_280);
  return buildAndSubmit(TARGET_ID, "create_pool", [
    addressArg(caller),
    addressArg(TESTNET_USDC),
    nativeToScVal(stroops, { type: "i128" }),
    nativeToScVal(ledgers, { type: "u32" }),
    nativeToScVal(totalCycles, { type: "u32" }),
    nativeToScVal(maxMembers, { type: "u32" }),
  ]);
}

export async function joinPool(caller: string, poolId: number): Promise<string> {
  return buildAndSubmit(TARGET_ID, "join_pool", [
    nativeToScVal(poolId, { type: "u32" }),
    addressArg(caller),
  ]);
}

export async function withdrawFromPool(caller: string, poolId: number): Promise<string> {
  return buildAndSubmit(TARGET_ID, "withdraw", [
    nativeToScVal(poolId, { type: "u32" }),
    addressArg(caller),
  ]);
}

// ---------------------------------------------------------------------------
// USDC transfer — move funds from the user's smart wallet to any address
// ---------------------------------------------------------------------------

/**
 * Transfer USDC from the user's smart wallet to any Stellar address.
 * Calls the USDC token contract's `transfer(from, to, amount)` method.
 * The auth entry for `from` is signed via WebAuthn (biometric prompt).
 */
export async function transferUsdc(
  from: string,
  to: string,
  amountUsdc: number,
): Promise<string> {
  const stroops = BigInt(Math.round(amountUsdc * 10_000_000));
  return buildAndSubmit(TESTNET_USDC, "transfer", [
    addressArg(from),
    addressArg(to),
    nativeToScVal(stroops, { type: "i128" }),
  ]);
}
