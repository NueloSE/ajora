#!/bin/bash
# ---------------------------------------------------------------------------
# Ajora — Deploy all contracts to Stellar Testnet
# ---------------------------------------------------------------------------
set -e

NETWORK="testnet"
RPC="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
DEPLOYER="ajora-deployer"

echo "╔══════════════════════════════════════════╗"
echo "║     Ajora — Testnet Deployment           ║"
echo "╚══════════════════════════════════════════╝"

# ---------------------------------------------------------------------------
# 0. Check dependencies
# ---------------------------------------------------------------------------
if ! command -v stellar &>/dev/null; then
  echo "ERROR: stellar CLI not found. Install with:"
  echo "  cargo install --locked stellar-cli"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Create & fund deployer account via Friendbot
# ---------------------------------------------------------------------------
echo ""
echo "==> Setting up deployer account..."

# Generate a new keypair if it doesn't already exist
if ! stellar keys show $DEPLOYER &>/dev/null 2>&1; then
  stellar keys generate $DEPLOYER --network $NETWORK
  echo "  Generated new keypair: $DEPLOYER"
else
  echo "  Using existing keypair: $DEPLOYER"
fi

DEPLOYER_ADDRESS=$(stellar keys address $DEPLOYER)
echo "  Address: $DEPLOYER_ADDRESS"

# Fund via Friendbot (testnet only)
echo "  Funding via Friendbot..."
curl -s "https://friendbot.stellar.org?addr=$DEPLOYER_ADDRESS" | \
  python3 -c "import sys,json; r=json.load(sys.stdin); print('  Funded:', r.get('hash','already funded'))" \
  2>/dev/null || echo "  (Friendbot skipped — may already be funded)"

# ---------------------------------------------------------------------------
# 2. Build all contracts
# ---------------------------------------------------------------------------
echo ""
echo "==> Building contracts (release, wasm32)..."
cargo build --target wasm32-unknown-unknown --release \
  -p rotating-savings -p target-savings -p zk-verifier -p reputation 2>&1 | grep -E "Compiling|Finished|error"

WASM_DIR="target/wasm32-unknown-unknown/release"
echo "  rotating_savings : $(wc -c < $WASM_DIR/rotating_savings.wasm) bytes"
echo "  target_savings   : $(wc -c < $WASM_DIR/target_savings.wasm) bytes"
echo "  zk_verifier      : $(wc -c < $WASM_DIR/zk_verifier.wasm) bytes"
echo "  reputation       : $(wc -c < $WASM_DIR/reputation.wasm) bytes"

# ---------------------------------------------------------------------------
# 2b. Optimize WASMs (required by Soroban — raw release WASMs are rejected)
# ---------------------------------------------------------------------------
echo ""
echo "==> Optimizing WASMs..."
stellar contract optimize --wasm $WASM_DIR/rotating_savings.wasm
stellar contract optimize --wasm $WASM_DIR/target_savings.wasm
stellar contract optimize --wasm $WASM_DIR/zk_verifier.wasm
stellar contract optimize --wasm $WASM_DIR/reputation.wasm
echo "  rotating_savings (opt): $(wc -c < $WASM_DIR/rotating_savings.optimized.wasm) bytes"
echo "  target_savings   (opt): $(wc -c < $WASM_DIR/target_savings.optimized.wasm) bytes"
echo "  zk_verifier      (opt): $(wc -c < $WASM_DIR/zk_verifier.optimized.wasm) bytes"
echo "  reputation       (opt): $(wc -c < $WASM_DIR/reputation.optimized.wasm) bytes"

# ---------------------------------------------------------------------------
# 3. Deploy contracts
# ---------------------------------------------------------------------------
echo ""
echo "==> Deploying rotating_savings..."
ROTATING_ID=$(stellar contract deploy \
  --wasm $WASM_DIR/rotating_savings.optimized.wasm \
  --source $DEPLOYER \
  --network $NETWORK)
echo "  ID: $ROTATING_ID"

echo ""
echo "==> Deploying target_savings..."
TARGET_ID=$(stellar contract deploy \
  --wasm $WASM_DIR/target_savings.optimized.wasm \
  --source $DEPLOYER \
  --network $NETWORK)
echo "  ID: $TARGET_ID"

echo ""
echo "==> Deploying zk_verifier..."
ZK_ID=$(stellar contract deploy \
  --wasm $WASM_DIR/zk_verifier.optimized.wasm \
  --source $DEPLOYER \
  --network $NETWORK)
echo "  ID: $ZK_ID"

echo ""
echo "==> Deploying reputation..."
REPUTATION_ID=$(stellar contract deploy \
  --wasm $WASM_DIR/reputation.optimized.wasm \
  --source $DEPLOYER \
  --network $NETWORK)
echo "  ID: $REPUTATION_ID"

# ---------------------------------------------------------------------------
# 4. Initialize ZK verifier with the circuit's Verification Key
# ---------------------------------------------------------------------------
echo ""
echo "==> Initialising ZK verifier with circuit VK..."

VK_FILE="circuits/ajora_credit/target/vk"
if [ ! -f "$VK_FILE" ]; then
  echo "  VK not found — running circuit build first..."
  bash scripts/build_circuits.sh
fi

# Convert VK bytes to hex string for the CLI invocation
VK_HEX=$(xxd -p -c 9999 "$VK_FILE")
echo "  VK size: $(wc -c < $VK_FILE) bytes"

stellar contract invoke \
  --id $ZK_ID \
  --source $DEPLOYER \
  --network $NETWORK \
  -- initialize \
  --admin $DEPLOYER_ADDRESS \
  --vk "$VK_HEX"
echo "  ZK verifier initialised ✓"

# ---------------------------------------------------------------------------
# 5. Initialize Reputation contract with deployer as admin
# ---------------------------------------------------------------------------
echo ""
echo "==> Initialising reputation contract..."
stellar contract invoke \
  --id $REPUTATION_ID \
  --source $DEPLOYER \
  --network $NETWORK \
  -- initialize \
  --admin $DEPLOYER_ADDRESS
echo "  Reputation contract initialised ✓"

# ---------------------------------------------------------------------------
# 5. Write contract IDs to frontend and agent env files
# ---------------------------------------------------------------------------
echo ""
echo "==> Writing environment files..."

cat > frontend/.env.local << ENVEOF
NEXT_PUBLIC_ROTATING_CONTRACT_ID=$ROTATING_ID
NEXT_PUBLIC_TARGET_CONTRACT_ID=$TARGET_ID
NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID=$ZK_ID
NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REPUTATION_ID
NEXT_PUBLIC_STELLAR_RPC_URL=$RPC
NEXT_PUBLIC_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE
ENVEOF
echo "  Written: frontend/.env.local"

# Update agent .env (preserve ANTHROPIC_API_KEY if it exists)
if [ -f "agent/.env" ]; then
  # Replace contract ID lines in-place, keep rest
  sed -i.bak \
    -e "s|^ROTATING_SAVINGS_CONTRACT_ID=.*|ROTATING_SAVINGS_CONTRACT_ID=$ROTATING_ID|" \
    -e "s|^TARGET_SAVINGS_CONTRACT_ID=.*|TARGET_SAVINGS_CONTRACT_ID=$TARGET_ID|" \
    -e "s|^ZK_VERIFIER_CONTRACT_ID=.*|ZK_VERIFIER_CONTRACT_ID=$ZK_ID|" \
    -e "s|^REPUTATION_CONTRACT_ID=.*|REPUTATION_CONTRACT_ID=$REPUTATION_ID|" \
    -e "s|^USE_MOCK_DATA=.*|USE_MOCK_DATA=false|" \
    agent/.env
  # Add REPUTATION_CONTRACT_ID if it doesn't exist yet
  grep -q "^REPUTATION_CONTRACT_ID=" agent/.env || \
    echo "REPUTATION_CONTRACT_ID=$REPUTATION_ID" >> agent/.env
  rm -f agent/.env.bak
else
  # Create from scratch (user must add ANTHROPIC_API_KEY manually)
  cat > agent/.env << ENVEOF
ANTHROPIC_API_KEY=                    # <-- add your key here
STELLAR_RPC_URL=$RPC
STELLAR_NETWORK=$NETWORK_PASSPHRASE
AGENT_SECRET_KEY=$(stellar keys show $DEPLOYER --show-secret 2>/dev/null | grep -o 'S[A-Z0-9]*' | head -1)
ROTATING_SAVINGS_CONTRACT_ID=$ROTATING_ID
TARGET_SAVINGS_CONTRACT_ID=$TARGET_ID
ZK_VERIFIER_CONTRACT_ID=$ZK_ID
POLL_INTERVAL_MS=60000
USE_MOCK_DATA=false
ENVEOF
fi
echo "  Written: agent/.env"

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Deployment Complete              ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Rotating Savings : $ROTATING_ID"
echo "  Target Savings   : $TARGET_ID"
echo "  ZK Verifier      : $ZK_ID"
echo "  Reputation       : $REPUTATION_ID"
echo ""
echo "  Explorer:"
echo "  https://stellar.expert/explorer/testnet/account/$DEPLOYER_ADDRESS"
echo ""
echo "  Next steps:"
echo "  1. cd frontend && npm run dev"
echo "  2. cd agent    && npm start"
echo ""
