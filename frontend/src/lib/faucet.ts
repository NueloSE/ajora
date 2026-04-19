// ---------------------------------------------------------------------------
// Testnet USDC in-app faucet
// ---------------------------------------------------------------------------
// Creates a throwaway keypair, friendbots it, swaps XLM→USDC on the
// testnet DEX, then transfers USDC to the user's smart wallet via SAC.
// No admin key required — uses only public testnet infrastructure.
// ---------------------------------------------------------------------------

const HORIZON_URL  = "https://horizon-testnet.stellar.org";
const RPC_URL      = "https://soroban-testnet.stellar.org";
const USDC_ISSUER  = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC     = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const USDC_AMOUNT  = 200; // USDC per tap

export type FaucetStep =
  | "idle"
  | "funding"    // friendbotting temp account
  | "trustline"  // adding USDC trustline
  | "swap"       // DEX swap XLM → USDC
  | "transfer"   // SAC transfer to smart wallet
  | "done"
  | "error";

export const FAUCET_STEP_LABELS: Record<FaucetStep, string> = {
  idle:      "",
  funding:   "Getting testnet XLM…",
  trustline: "Setting up USDC trustline…",
  swap:      "Swapping XLM → USDC on testnet DEX…",
  transfer:  "Sending USDC to your wallet…",
  done:      "Done! Wallet funded.",
  error:     "Faucet failed.",
};

export async function getTestUsdc(
  recipientAddress: string,
  onStep: (step: FaucetStep) => void,
): Promise<void> {
  const sdk = await import("@stellar/stellar-sdk");
  const { Keypair, Asset, Networks, Operation, TransactionBuilder, BASE_FEE,
          Contract, nativeToScVal, Horizon } = sdk;
  const SorobanRpc = sdk.rpc;

  const NETWORK    = Networks.TESTNET;
  const USDC_ASSET = new Asset("USDC", USDC_ISSUER);
  const horizon    = new Horizon.Server(HORIZON_URL);
  const soroban    = new SorobanRpc.Server(RPC_URL);
  const sleep      = (ms: number) => new Promise(r => setTimeout(r, ms));

  // ── 1. Create a throwaway funder keypair and friendbot it ─────────────────
  onStep("funding");
  const funder = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${funder.publicKey()}`);
  if (!fb.ok) throw new Error("Friendbot failed — testnet may be down. Try again in a moment.");
  await sleep(4000); // wait for ledger close

  // ── 2. Add USDC trustline to the funder account ───────────────────────────
  onStep("trustline");
  const acct1 = await horizon.loadAccount(funder.publicKey());
  const trustTx = new TransactionBuilder(acct1, {
    fee: String(100_000), networkPassphrase: NETWORK,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(60)
    .build();
  trustTx.sign(funder);
  await horizon.submitTransaction(trustTx);
  await sleep(5000);

  // ── 3. Swap XLM → USDC on the testnet DEX ────────────────────────────────
  onStep("swap");
  const acct2 = await horizon.loadAccount(funder.publicKey());
  const swapTx = new TransactionBuilder(acct2, {
    fee: String(100_000), networkPassphrase: NETWORK,
  })
    .addOperation(Operation.pathPaymentStrictReceive({
      sendAsset:   Asset.native(),
      sendMax:     String(USDC_AMOUNT * 25), // offer up to 25 XLM per USDC
      destination: funder.publicKey(),
      destAsset:   USDC_ASSET,
      destAmount:  String(USDC_AMOUNT),
      path:        [],
    }))
    .setTimeout(60)
    .build();
  swapTx.sign(funder);
  try {
    await horizon.submitTransaction(swapTx);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not get USDC from testnet DEX — no liquidity right now. ` +
      `Try again in a few minutes. (${detail})`
    );
  }
  await sleep(4000);

  // ── 4. Transfer USDC from funder to recipient smart wallet via SAC ────────
  onStep("transfer");
  const amount     = BigInt(USDC_AMOUNT) * 10_000_000n;
  const contract   = new Contract(USDC_SAC);
  const sorobanAcct = await soroban.getAccount(funder.publicKey());

  const fromArg   = nativeToScVal(funder.publicKey(), { type: "address" });
  const toArg     = nativeToScVal(recipientAddress,   { type: "address" });
  const amountArg = nativeToScVal(amount,             { type: "i128" });

  const transferTx = new TransactionBuilder(sorobanAcct, {
    fee: BASE_FEE, networkPassphrase: NETWORK,
  })
    .addOperation(contract.call("transfer", fromArg, toArg, amountArg))
    .setTimeout(30)
    .build();

  const sim = await soroban.simulateTransaction(transferTx);
  if ("error" in sim) {
    throw new Error(`SAC simulation failed: ${(sim as { error: string }).error}`);
  }

  const prepared = SorobanRpc.assembleTransaction(transferTx, sim).build();
  prepared.sign(funder);

  const send = await soroban.sendTransaction(prepared);
  if (send.status === "ERROR") {
    throw new Error(`Transfer submission failed: ${JSON.stringify(send.errorResult)}`);
  }

  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    const s = await soroban.getTransaction(send.hash);
    if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      onStep("done");
      return;
    }
    if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`SAC transfer rejected on-chain: ${send.hash}`);
    }
  }
  throw new Error("Transfer timed out waiting for confirmation.");
}
