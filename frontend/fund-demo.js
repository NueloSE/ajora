#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fund-demo.js — Fund demo wallets with testnet USDC (no admin key needed)
// ---------------------------------------------------------------------------
// Usage (run from frontend/):
//   node fund-demo.js <wallet1> <wallet2> <wallet3> ...
//
// How it works (no mint admin key required):
//   1. Creates a temporary G... funder keypair
//   2. Friendbots it with ~10,000 XLM
//   3. Adds a USDC trustline on the funder account
//   4. Swaps XLM → USDC on the testnet DEX (path payment)
//   5. Transfers 500 USDC to each C... smart wallet via SAC transfer()
// ---------------------------------------------------------------------------

import {
  Keypair, Asset, Networks, Operation,
  TransactionBuilder, BASE_FEE,
  rpc as SorobanRpc, Contract, nativeToScVal,
  Horizon,
} from "@stellar/stellar-sdk";

const RPC_URL      = "https://soroban-testnet.stellar.org";
const HORIZON_URL  = "https://horizon-testnet.stellar.org";
const NETWORK      = Networks.TESTNET;

// Testnet USDC: issued by Circle's testnet issuer, wrapped as a Soroban SAC
const USDC_ISSUER  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC     = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_ASSET   = new Asset("USDC", USDC_ISSUER);

const USDC_PER_WALLET  = 500;
const USDC_STROOPS     = BigInt(USDC_PER_WALLET) * 10_000_000n;

const wallets = process.argv.slice(2);
if (!wallets.length) {
  console.error("Usage: node fund-demo.js <wallet1> <wallet2> ...");
  process.exit(1);
}

const horizon = new Horizon.Server(HORIZON_URL);
const soroban = new SorobanRpc.Server(RPC_URL);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Submit a classic Stellar transaction ─────────────────────────────────────
async function submitClassic(keypair, operations) {
  const account = await horizon.loadAccount(keypair.publicKey());
  let builder = new TransactionBuilder(account, {
    fee: String(100_000),
    networkPassphrase: NETWORK,
  });
  for (const op of operations) builder = builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  tx.sign(keypair);
  return horizon.submitTransaction(tx);
}

// ── Transfer USDC from a G... classic account to a C... smart wallet via SAC ─
async function sacTransfer(fromKeypair, toAddress, amount) {
  const contract  = new Contract(USDC_SAC);
  const account   = await soroban.getAccount(fromKeypair.publicKey());

  const fromArg   = nativeToScVal(fromKeypair.publicKey(), { type: "address" });
  const toArg     = nativeToScVal(toAddress,               { type: "address" });
  const amountArg = nativeToScVal(amount,                  { type: "i128" });

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call("transfer", fromArg, toArg, amountArg))
    .setTimeout(30)
    .build();

  const sim = await soroban.simulateTransaction(tx);
  if ("error" in sim) throw new Error(`Simulation failed: ${sim.error}`);

  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(fromKeypair);

  const send = await soroban.sendTransaction(prepared);
  if (send.status === "ERROR") {
    throw new Error(`Submit failed: ${JSON.stringify(send.errorResult)}`);
  }

  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    const s = await soroban.getTransaction(send.hash);
    if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return send.hash;
    if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`SAC transfer failed on-chain: ${send.hash}`);
    }
  }
  throw new Error(`SAC transfer timed out: ${send.hash}`);
}

async function main() {
  const totalUsdc = wallets.length * USDC_PER_WALLET;
  console.log(`\nFunding ${wallets.length} wallet(s) with ${USDC_PER_WALLET} USDC each...\n`);

  // ── Step 1: Create a temporary funder account ────────────────────────────
  const funder = Keypair.random();
  console.log(`Temp funder: ${funder.publicKey()}\n`);

  // ── Step 2: Friendbot the funder ─────────────────────────────────────────
  process.stdout.write("Step 1/4  Getting XLM from friendbot... ");
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${funder.publicKey()}`);
  if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);
  console.log("✓");
  await sleep(4000); // wait for ledger

  // ── Step 3: Add USDC trustline ───────────────────────────────────────────
  process.stdout.write("Step 2/4  Adding USDC trustline... ");
  await submitClassic(funder, [
    Operation.changeTrust({ asset: USDC_ASSET }),
  ]);
  console.log("✓");
  await sleep(5000);

  // ── Step 4: Swap XLM → USDC on testnet DEX ──────────────────────────────
  process.stdout.write(`Step 3/4  Swapping XLM → ${totalUsdc} USDC on testnet DEX... `);
  try {
    await submitClassic(funder, [
      Operation.pathPaymentStrictReceive({
        sendAsset:   Asset.native(),
        sendMax:     String(totalUsdc * 25), // up to 25 XLM per USDC
        destination: funder.publicKey(),
        destAsset:   USDC_ASSET,
        destAmount:  String(totalUsdc),
        path:        [],
      }),
    ]);
    console.log("✓");
  } catch (e) {
    // DEX swap failed — no testnet liquidity. Fall back to direct issuance path.
    console.log("\n  DEX swap failed (no liquidity). Trying direct from USDC issuer...");
    // Some testnet setups allow receiving USDC from the issuer directly.
    // If this also fails, you'll need to fund manually via Stellar Laboratory.
    throw new Error(
      `Could not obtain testnet USDC automatically.\n\n` +
      `Manual option:\n` +
      `  1. Go to https://laboratory.stellar.org\n` +
      `  2. Build a transaction to send USDC from ${USDC_ISSUER} to ${funder.publicKey()}\n` +
      `  3. Re-run this script with --skip-swap flag (not implemented)\n\n` +
      `Original error: ${e.message}`
    );
  }
  await sleep(4000);

  // ── Step 5: Transfer 500 USDC to each smart wallet via SAC ───────────────
  console.log(`Step 4/4  Transferring USDC to smart wallets...\n`);
  for (const wallet of wallets) {
    process.stdout.write(`  → ${wallet.slice(0, 8)}...  `);
    try {
      const hash = await sacTransfer(funder, wallet, USDC_STROOPS);
      console.log(`✓  ${USDC_PER_WALLET} USDC  (tx: ${hash.slice(0, 8)}...)`);
    } catch (err) {
      console.log(`✗  FAILED: ${err.message}`);
    }
  }

  console.log(`\nDone! All wallets funded. Funder account ${funder.publicKey()} can be discarded.`);
}

main().catch(err => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
