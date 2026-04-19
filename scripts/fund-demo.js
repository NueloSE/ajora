#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fund-demo.js — Mint testnet USDC to demo wallets before a live demo
// ---------------------------------------------------------------------------
// Usage:
//   node scripts/fund-demo.js <wallet1> <wallet2> <wallet3> ...
//
// Example:
//   node scripts/fund-demo.js CAAAA... CBBBB... CCCCC...
//
// What it does:
//   1. Friendbots each wallet with testnet XLM (for gas)
//   2. Mints 500 testnet USDC to each wallet via the USDC contract's mint()
//      The agent keypair (AGENT_SECRET_KEY) must be the USDC contract admin.
//
// Prerequisites:
//   - Run from the repo root: node scripts/fund-demo.js ...
//   - agent/.env must have AGENT_SECRET_KEY set
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  Keypair,
  Contract,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";

// ── Load env from agent/.env ──────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "../agent/.env");
const envLines = readFileSync(envPath, "utf8").split("\n");
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const AGENT_SECRET = env.AGENT_SECRET_KEY;
const RPC_URL      = env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK      = env.STELLAR_NETWORK ?? Networks.TESTNET;

// Soroban testnet USDC contract — same one used by the app
const USDC_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

// Amount to mint per wallet: 500 USDC (500 * 10_000_000 stroops)
const MINT_AMOUNT = BigInt(500 * 10_000_000);

if (!AGENT_SECRET) {
  console.error("ERROR: AGENT_SECRET_KEY not found in agent/.env");
  process.exit(1);
}

const wallets = process.argv.slice(2);
if (wallets.length === 0) {
  console.error("Usage: node scripts/fund-demo.js <wallet1> <wallet2> ...");
  console.error("Example: node scripts/fund-demo.js CAAAA... CBBBB...");
  process.exit(1);
}

const agentKeypair = Keypair.fromSecret(AGENT_SECRET);
const server = new SorobanRpc.Server(RPC_URL);

async function friendbot(address) {
  const url = `https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Friendbot returns 400 if account already exists — that's fine
    const body = await res.text().catch(() => "");
    if (body.includes("createAccountAlreadyExist")) {
      console.log(`  XLM: ${address.slice(0,8)}... already funded, skipping`);
      return;
    }
    console.warn(`  XLM friendbot warning for ${address.slice(0,8)}...: ${res.status}`);
    return;
  }
  console.log(`  XLM: friendbotted ${address.slice(0,8)}...`);
}

async function buildAndSubmit(method, args) {
  const contract = new Contract(USDC_CONTRACT);
  const account  = await server.getAccount(agentKeypair.publicKey());

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(`Sim failed: ${sim.error}`);

  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(agentKeypair);

  const send = await server.sendTransaction(prepared);
  if (send.status === "ERROR") throw new Error(`Submit failed: ${JSON.stringify(send.errorResult)}`);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const s = await server.getTransaction(send.hash);
    if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return send.hash;
    if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED)
      throw new Error(`Transaction failed: ${send.hash}`);
  }
  throw new Error(`Timed out: ${send.hash}`);
}

async function mintUsdc(toAddress) {
  const toArg     = nativeToScVal(toAddress, { type: "address" });
  const amountArg = nativeToScVal(MINT_AMOUNT, { type: "i128" });
  const hash = await buildAndSubmit("mint", [toArg, amountArg]);
  console.log(`  USDC: minted 500 USDC to ${toAddress.slice(0,8)}... (${hash.slice(0,8)}...)`);
}

async function main() {
  console.log(`\nFunding ${wallets.length} demo wallet(s) with XLM + USDC...\n`);
  console.log(`Agent:  ${agentKeypair.publicKey()}`);
  console.log(`USDC:   ${USDC_CONTRACT}\n`);

  for (const wallet of wallets) {
    console.log(`Wallet: ${wallet}`);
    try {
      await friendbot(wallet);
      await mintUsdc(wallet);
      console.log(`  Done.\n`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
    }
  }

  console.log("All done. Wallets are ready for the demo.");
}

main().catch(err => { console.error(err); process.exit(1); });
