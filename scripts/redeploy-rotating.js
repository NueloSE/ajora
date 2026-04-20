#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Redeploy only the rotating_savings contract (after a bug fix).
// Keeps target_savings, zk_verifier, and reputation contracts unchanged.
// Updates frontend/.env.local and agent/.env with the new contract ID.
// ---------------------------------------------------------------------------

const fs   = require("fs");
const path = require("path");

const SDK_PATH = path.join(__dirname, "../frontend/node_modules/@stellar/stellar-sdk");
const {
  Keypair,
  rpc: SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Operation,
  Address,
  Contract,
} = require(SDK_PATH);

const RPC_URL            = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const DEPLOYER_SECRET    = "SC65YZHQQVVDN7GDVTWNJ63TOTCLNZINWQXODYZTIX5K2VZRTHPG2XJS";

const WASM_PATH = path.join(
  __dirname,
  "../target/wasm32-unknown-unknown/release/rotating_savings.optimized.wasm",
);

const server  = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
const keypair = Keypair.fromSecret(DEPLOYER_SECRET);

const sleep   = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForTx(txHash) {
  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED")  throw new Error(`Tx failed: ${txHash}`);
    await sleep(2000);
  }
  throw new Error(`Tx timeout: ${txHash}`);
}

async function sendTx(tx) {
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const resp = await server.sendTransaction(prepared);
  if (resp.status === "ERROR") throw new Error(`Send error: ${JSON.stringify(resp)}`);
  return await waitForTx(resp.hash);
}

async function uploadWasm(wasmPath) {
  const wasm    = fs.readFileSync(wasmPath);
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(60)
    .build();

  const result = await sendTx(tx);
  return result.returnValue.bytes().toString("hex");
}

async function deployContract(wasmHash) {
  const account = await server.getAccount(keypair.publicKey());
  const salt    = Buffer.alloc(32);
  crypto.getRandomValues(salt);

  const tx = new TransactionBuilder(account, {
    fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.createCustomContract({
      address:  new Address(keypair.publicKey()),
      wasmHash: Buffer.from(wasmHash, "hex"),
      salt,
    }))
    .setTimeout(60)
    .build();

  const result = await sendTx(tx);
  return Address.fromScVal(result.returnValue).toString();
}

function updateEnvKey(filePath, key, value) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(filePath, content);
  console.log(`  Updated ${key} in ${path.basename(filePath)}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Redeploy rotating_savings (bug fix)     ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`Deployer: ${keypair.publicKey()}\n`);

  if (!fs.existsSync(WASM_PATH)) {
    console.error(`ERROR: WASM not found at:\n  ${WASM_PATH}`);
    console.error("\nBuild first:\n  cargo build -p rotating-savings --target wasm32-unknown-unknown --release");
    console.error("  stellar contract optimize --wasm target/wasm32-unknown-unknown/release/rotating_savings.wasm");
    process.exit(1);
  }

  console.log("==> Uploading rotating_savings WASM...");
  const wasmHash = await uploadWasm(WASM_PATH);
  console.log(`    Hash: ${wasmHash}`);

  console.log("==> Deploying rotating_savings...");
  const contractId = await deployContract(wasmHash);
  console.log(`    New ID: ${contractId}`);

  console.log("\n==> Updating env files...");
  updateEnvKey(path.join(__dirname, "../frontend/.env.local"), "NEXT_PUBLIC_ROTATING_CONTRACT_ID", contractId);
  updateEnvKey(path.join(__dirname, "../agent/.env"),          "ROTATING_SAVINGS_CONTRACT_ID",     contractId);

  console.log(`
╔══════════════════════════════════════════╗
║  Done! New rotating_savings contract:    ║
╚══════════════════════════════════════════╝

  ${contractId}

  Next steps:
  1. Restart the Next.js dev server (Ctrl+C then npm run dev)
     OR push to GitHub to trigger a Vercel redeploy
  2. Restart the agent (Ctrl+C then npm run start in agent/)
  3. Create a new test group — old groups are on the old contract
`);
}

main().catch(e => {
  console.error("\nFailed:", e.message || e);
  process.exit(1);
});
