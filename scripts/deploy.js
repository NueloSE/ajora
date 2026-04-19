#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ajora — Deploy contracts to Stellar Testnet via JS SDK
// Bypasses stellar CLI's rustls TLS certificate issues on macOS
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

// Use stellar-sdk from frontend node_modules
const SDK_PATH = path.join(__dirname, "../frontend/node_modules/@stellar/stellar-sdk");
const {
  Keypair,
  rpc: SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  xdr,
  Operation,
  Address,
  Contract,
} = require(SDK_PATH);

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const WASM_DIR = path.join(__dirname, "../target/wasm32-unknown-unknown/release");

// Read deployer secret key from stellar CLI config
const DEPLOYER_SECRET = "SC65YZHQQVVDN7GDVTWNJ63TOTCLNZINWQXODYZTIX5K2VZRTHPG2XJS";

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
const keypair = Keypair.fromSecret(DEPLOYER_SECRET);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTx(txHash) {
  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") throw new Error(`Tx failed: ${txHash}`);
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
  const wasm = fs.readFileSync(wasmPath);
  const account = await server.getAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(60)
    .build();

  const result = await sendTx(tx);
  // Extract wasm hash from return value (ScVal bytes)
  return result.returnValue.bytes().toString("hex");
}

async function deployContract(wasmHash) {
  const account = await server.getAccount(keypair.publicKey());
  const salt = Buffer.alloc(32);
  crypto.getRandomValues(salt);

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(keypair.publicKey()),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt,
      })
    )
    .setTimeout(60)
    .build();

  const result = await sendTx(tx);
  // Contract ID is an address in the return value
  return Address.fromScVal(result.returnValue).toString();
}

async function initializeReputation(contractId) {
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "initialize",
        new Address(keypair.publicKey()).toScVal()
      )
    )
    .setTimeout(60)
    .build();

  await sendTx(tx);
}

async function initializeZkVerifier(contractId) {
  const vkPath = path.join(__dirname, "../circuits/ajora_credit/target/vk");
  if (!fs.existsSync(vkPath)) {
    console.log("  VK file not found — skipping ZK init");
    return;
  }
  const vkHex = fs.readFileSync(vkPath).toString("hex");
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "initialize",
        new Address(keypair.publicKey()).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(vkHex, "hex"))
      )
    )
    .setTimeout(60)
    .build();

  await sendTx(tx);
}

function updateEnvFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");
  for (const [key, val] of Object.entries(replacements)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }
  fs.writeFileSync(filePath, content);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     Ajora — Testnet Deployment (JS)      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\nDeployer: ${keypair.publicKey()}`);

  const contracts = [
    { name: "rotating_savings", file: "rotating_savings.optimized.wasm" },
    { name: "target_savings",   file: "target_savings.optimized.wasm"   },
    { name: "zk_verifier",      file: "zk_verifier.optimized.wasm"      },
    { name: "reputation",       file: "reputation.optimized.wasm"        },
  ];

  const deployed = {};

  for (const c of contracts) {
    const wasmPath = path.join(WASM_DIR, c.file);
    if (!fs.existsSync(wasmPath)) {
      console.error(`\nERROR: ${wasmPath} not found. Run build first.`);
      process.exit(1);
    }

    console.log(`\n==> Uploading ${c.name} WASM...`);
    const wasmHash = await uploadWasm(wasmPath);
    console.log(`    Hash: ${wasmHash}`);

    console.log(`==> Deploying ${c.name}...`);
    const contractId = await deployContract(wasmHash);
    console.log(`    ID: ${contractId}`);
    deployed[c.name] = contractId;
  }

  console.log("\n==> Initializing reputation contract...");
  await initializeReputation(deployed.reputation);
  console.log("    Done ✓");

  console.log("\n==> Initializing ZK verifier...");
  await initializeZkVerifier(deployed.zk_verifier);

  // Update env files
  const frontendEnv = path.join(__dirname, "../frontend/.env.local");
  fs.writeFileSync(
    frontendEnv,
    `NEXT_PUBLIC_ROTATING_CONTRACT_ID=${deployed.rotating_savings}
NEXT_PUBLIC_TARGET_CONTRACT_ID=${deployed.target_savings}
NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID=${deployed.zk_verifier}
NEXT_PUBLIC_REPUTATION_CONTRACT_ID=${deployed.reputation}
NEXT_PUBLIC_STELLAR_RPC_URL=${RPC_URL}
NEXT_PUBLIC_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
`
  );
  console.log("\n==> Written: frontend/.env.local");

  updateEnvFile(path.join(__dirname, "../agent/.env"), {
    ROTATING_SAVINGS_CONTRACT_ID: deployed.rotating_savings,
    TARGET_SAVINGS_CONTRACT_ID:   deployed.target_savings,
    ZK_VERIFIER_CONTRACT_ID:      deployed.zk_verifier,
    REPUTATION_CONTRACT_ID:       deployed.reputation,
    USE_MOCK_DATA:                "false",
  });
  console.log("==> Updated: agent/.env");

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         Deployment Complete              ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\n  Rotating Savings : ${deployed.rotating_savings}`);
  console.log(`  Target Savings   : ${deployed.target_savings}`);
  console.log(`  ZK Verifier      : ${deployed.zk_verifier}`);
  console.log(`  Reputation       : ${deployed.reputation}`);
  console.log(`\n  Explorer: https://stellar.expert/explorer/testnet`);
}

main().catch((e) => {
  console.error("\nDeployment failed:", e.message || e);
  process.exit(1);
});
