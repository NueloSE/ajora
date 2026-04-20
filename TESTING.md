# Ajora — Judge Testing Guide

Live app: **https://ajora.vercel.app** (replace with your deployed URL)

---

## Before You Start

### Browser Requirements

Ajora uses **WebAuthn / Passkeys** for authentication. Use one of the following:

| Browser | Platform | Works? |
|---------|----------|--------|
| Chrome (latest) | Mac / Windows / Android | ✅ Yes |
| Safari (latest) | Mac / iPhone / iPad | ✅ Yes |
| Edge (latest) | Windows | ✅ Yes |
| Firefox | Any | ⚠️ Limited — not recommended |

> **Important:** Your passkey is bound to the browser and device you register with. Do not switch browsers mid-test or your wallet will not be accessible.

### To Test the Full Flow (Two Accounts)

You will need **two separate browser profiles or two different browsers** to simulate two members:

- **Account A** — Chrome (normal profile)
- **Account B** — Safari, or a second Chrome profile (`chrome://settings/manageProfile`)

Each browser registers a separate wallet with its own passkey.

---

## Step 1 — Register Your Wallet

1. Open the app in your browser
2. Click **Get Started** on the landing page
3. Enter any phone number (e.g. `08012345678` for Account A, `08087654321` for Account B)
4. When prompted, authenticate with your **fingerprint, Face ID, or device PIN** — this creates your Stellar wallet
5. You will land on the dashboard. Your wallet address is shown at the top

> Your wallet is non-custodial. The private key never leaves your device.

---

## Step 2 — Fund Your Wallet

After registering, your dashboard will show a **"Get USDC →"** banner at the top (visible when your balance is zero).

1. Click the **"Get USDC →"** button
2. Wait ~15–20 seconds while the app:
   - Requests free testnet XLM from Stellar Friendbot
   - Adds a USDC trustline to your wallet
   - Swaps XLM → USDC on the testnet DEX
   - Transfers the USDC directly into your smart wallet
3. When it shows **"Done! Wallet funded."** your balance will update automatically

> No external tools, no copy-pasting addresses — the faucet handles everything in one click.

Repeat for Account B in your second browser.

---

## Step 4 — Create a Group (Account A)

1. In the Ajora app, go to **Groups** in the sidebar
2. Click **Create Group**
3. Fill in the form:
   - **Name**: e.g. `Test Ajo Group`
   - **Contribution amount**: `10` (USDC)
   - **Max members**: `2`
   - **Cycle duration**: `4` → select **Minutes** from the dropdown (this keeps the demo fast)
   - **Min reputation score**: `0` (open to all)
4. Click **Create** and authenticate with your passkey when prompted
5. Wait for the transaction to confirm — you will see a success message with a transaction link

---

## Step 5 — Join the Group (Account B)

1. Switch to your second browser (Account B)
2. Go to **Groups** — the group created in Step 4 should appear
3. Click **Join** on the group
4. Authenticate with Account B's passkey
5. Wait for confirmation

> Both Account A and Account B are now members of the group.

---

## Step 6 — Make Contributions

### Account A
1. Go to **Groups**, find the active group
2. Click **Contribute**
3. Authenticate with your passkey — the 10 USDC contribution is submitted on-chain

### Account B
1. Switch to the second browser
2. Repeat the same steps — click **Contribute** and authenticate

Both members have now contributed for Cycle 1.

---

## Step 7 — Wait for Cycle Close and Payout

The AI agent runs every 2 minutes. After the 4-minute cycle duration:

- The agent detects the cycle deadline has passed
- It calls `close_cycle` on the smart contract
- The pooled funds (20 USDC) are automatically released to the designated payout recipient
- The recipient's balance updates on the dashboard

> You can watch the agent logs at your Railway deployment or check the group status refreshing the Groups page.

---

## Step 8 — Test Default Detection (Optional)

To see what happens when a member does not contribute:

1. Create a new group (repeat Step 4)
2. Have both accounts join
3. Only **Account A** contributes — Account B does not
4. Wait for the cycle to expire (4 minutes)
5. The agent flags Account B as defaulted on-chain
6. Account B's reputation score drops on their dashboard
7. Account B now has an unpaid debt — visible on their dashboard

---

## Step 9 — Generate a ZK Proof (Account A)

After completing a cycle without defaulting:

1. Go to **ZK Proof** in the sidebar (Account A)
2. Select the group you completed
3. Click **Generate Proof**
4. Wait ~10 seconds while the server computes the Pedersen commitment
5. The proof is submitted to the on-chain ZK verifier contract
6. You will see a success message with the transaction hash

This proof records: *"This wallet completed N cycles with no unpaid debts"* — without revealing the wallet address or any transaction details.

---

## Step 10 — Verify the Proof (Group Join Gate)

To see the ZK gate in action:

1. Create a new group with **Min reputation score: 60** or higher
2. Try joining with Account B (the account that defaulted in Step 8)
3. Account B will be blocked — their score is below the threshold
4. Account A (with a clean record and ZK proof) can join successfully

---

## Deployed Contracts (Stellar Testnet)

All contracts are live and verifiable on [Stellar Expert](https://stellar.expert/explorer/testnet):

| Contract | Address |
|----------|---------|
| Rotating Savings (ajo/esusu) | `CADYC5VTWEOYOW7BLZ6OKNIGNY4SJV6KVAVJJX7QWFJGNKK6ZVVHVDC2` |
| Target Savings | `CA7GRA676ZANWAYZIK3VBEACRV7ZJ6TWKXAMVK3HEOA3OOODPFWZT55H` |
| ZK Credit Verifier | `CDOEPMQB3T3MJNG2GQRUKPPSXJO7ZC3TKOFGNTN4TJ2OC2ZR523S6EXH` |
| Reputation | `CA4DRJPKRRQMO6C7X4WDHBCWTF2SO5VAKZUUQ3JDZNTC7GOC3TRXNOIN` |

Network: `Test SDF Network ; September 2015`

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Passkey prompt does not appear | Make sure you are on HTTPS (not localhost) or use Chrome on localhost with a flag |
| Transaction fails with "insufficient balance" | Fund with XLM via Friendbot and get testnet USDC (Steps 2–3) |
| Groups page shows empty | Testnet RPC can be slow — wait 5 seconds and refresh |
| Contribution button disabled | You may have already contributed this cycle, or the group is not yet active |
| ZK proof fails | You must have at least one completed cycle with no unpaid debts |
| Cycle does not close automatically | The AI agent runs every 2 minutes — wait and refresh |

---

## Contact

Questions during judging: **akalo.emmanuel18@gmail.com**
