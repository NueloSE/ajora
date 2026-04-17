#!/bin/bash
set -e

export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

CIRCUIT_DIR="circuits/ajora_credit"
FRONTEND_PUBLIC="frontend/public/circuits"

echo "==> Building Ajora credit circuit..."
cd $CIRCUIT_DIR

# Compile the circuit to ACIR bytecode
nargo compile
echo "  Circuit compiled -> target/ajora_credit.json"

# Generate witness using Prover.toml values
# In CI/testing these are dummy values; on the client side the real wallet
# address and cycles_completed are supplied by the frontend ZK prover flow.
nargo execute
echo "  Witness generated -> target/ajora_credit.gz"

# Generate the UltraHonk Verification Key
# This is the on-chain artifact — it goes into the zk_verifier Soroban contract
bb write_vk -b target/ajora_credit.json -o target --scheme ultra_honk
echo "  Verification key generated -> target/vk ($(wc -c < target/vk) bytes)"

# Optionally verify the proof round-trip to confirm the VK is correct
bb prove -b target/ajora_credit.json -w target/ajora_credit.gz -o target --scheme ultra_honk
bb verify -k target/vk -p target/proof --scheme ultra_honk
echo "  Proof round-trip verified"

# Copy artifacts to frontend so the browser prover can use them
cd ../..
mkdir -p $FRONTEND_PUBLIC
cp $CIRCUIT_DIR/target/vk $FRONTEND_PUBLIC/ajora_credit_vk
cp $CIRCUIT_DIR/target/ajora_credit.json $FRONTEND_PUBLIC/ajora_credit.json
echo "  Artifacts copied to $FRONTEND_PUBLIC"

echo ""
echo "==> Circuit build complete"
echo "    VK size  : $(wc -c < $CIRCUIT_DIR/target/vk) bytes"
echo "    Proof size: $(wc -c < $CIRCUIT_DIR/target/proof) bytes"
echo ""
echo "Next: upload the VK to the zk_verifier Soroban contract:"
echo "  stellar contract invoke --id <ZK_VERIFIER_ID> --source admin \\"
echo "    -- initialize --admin <ADMIN_ADDRESS> --vk \$(xxd -p -c 9999 $CIRCUIT_DIR/target/vk)"
