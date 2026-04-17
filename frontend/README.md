# Ajora

A mobile-first savings and credit app built on the Stellar blockchain, secured entirely by device biometrics — no seed phrases, no passwords.

Users register with a phone number and their device's Secure Enclave (Touch ID / Face ID / Windows Hello). A Stellar Smart Wallet is deployed on-chain and all transactions require a biometric prompt. Keys never leave the device.

---

## Features

- **Rotating Savings (Chama)** — Join or create a group savings pool where members contribute each cycle and take turns receiving the full pot.
- **Target Savings** — Set a savings goal with a deadline and contribute incrementally. Funds locked until target or deadline.
- **Backup Device** — Register a second device as a co-signer on your Smart Wallet so you can recover access without a seed phrase.
- **ZK Credit Proof** — Generate a zero-knowledge proof of your savings history to prove creditworthiness without revealing your balance.
- **Send USDC** — Transfer USDC to any Stellar address directly from the dashboard.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Wallet | [passkey-kit](https://github.com/kalepail/passkey-kit) — Stellar Smart Wallet secured by WebAuthn |
| Blockchain | Stellar Testnet · Soroban smart contracts (Rust) |
| Auth | WebAuthn (device biometrics) — no passwords, no seed phrases |
| ZK Proofs | Noir circuits for credit score verification |

---

## Local Development

### Prerequisites

- Node.js 20+
- A browser that supports WebAuthn (Chrome, Safari, Firefox — any modern browser on a device with biometrics)

### Setup

```bash
cd frontend
npm install
```

Copy the environment variables:

```bash
cp .env.local.example .env.local
```

Then fill in the contract IDs (or use the testnet defaults provided).

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** WebAuthn requires either `localhost` or a valid HTTPS domain. The dev server on `localhost` works without any extra setup.

---

## Environment Variables

Create a `.env.local` file in the `frontend/` directory:

```env
# Stellar Testnet — Soroban contract addresses
NEXT_PUBLIC_ROTATING_CONTRACT_ID=<rotating_savings_contract_id>
NEXT_PUBLIC_TARGET_CONTRACT_ID=<target_savings_contract_id>
NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID=<zk_verifier_contract_id>

# Stellar network (defaults to testnet if omitted)
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

All variables are prefixed `NEXT_PUBLIC_` — they are embedded at build time and safe to expose (no private keys are ever stored).

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. In the [Vercel dashboard](https://vercel.com/new), import the repo and set the **Root Directory** to `frontend/`.
3. Add the five environment variables above under **Project Settings → Environment Variables**.
4. Deploy. Vercel auto-detects Next.js and uses the correct build command.

> **Build command:** `next build` (configured in `package.json`)  
> **Output directory:** `.next` (Vercel default for Next.js)

---

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Landing page
│   │   ├── signin/                   # Phone + biometric sign-in
│   │   ├── dashboard/                # Protected dashboard (auth gate in layout.tsx)
│   │   │   ├── page.tsx              # Overview / wallet home
│   │   │   ├── groups/               # Rotating savings (Chama)
│   │   │   ├── savings/              # Target savings
│   │   │   ├── proof/                # ZK credit proof
│   │   │   └── backup/               # Add backup device
│   │   └── backup/
│   │       └── activate/             # Backup device activation (public, no auth)
│   ├── components/
│   │   └── Sidebar.tsx               # Navigation + wallet identity
│   ├── context/
│   │   └── WalletContext.tsx         # Global wallet state (address, keyId, name)
│   └── lib/
│       ├── passkey.ts                # WebAuthn + Stellar Smart Wallet logic
│       ├── soroban.ts                # Soroban RPC helpers (balance, etc.)
│       └── contracts.ts             # USDC transfer + contract calls
├── next.config.ts                    # Webpack config (SDK transpilation + alias)
└── .env.local                        # Environment variables (not committed)
```

---

## How Passkey Auth Works

1. **Register** — `kit.createWallet()` triggers a biometric prompt. The device Secure Enclave generates a P-256 keypair. The public key is submitted to Stellar to deploy a Smart Wallet contract.
2. **Sign in** — A WebAuthn challenge is signed by the Secure Enclave. The credential is verified client-side, session is restored from `localStorage`.
3. **Transact** — Every on-chain operation calls `kit.signAuthEntry()`, which triggers a biometric prompt. The Soroban auth entry is signed with the P-256 private key and verified by the Smart Wallet contract on-chain.
4. **Backup** — A second passkey is registered (optionally on another device). `kit.addSecp256r1()` adds it as a co-signer. Both devices can then sign independently.

The private key **never leaves the device** — not in `localStorage`, not in memory, not in any network request.

---

## Contracts

Smart contracts live in `/contracts` (Soroban / Rust):

| Contract | Description |
|----------|-------------|
| `rotating_savings` | Chama-style group savings with payout rotation |
| `target_savings` | Goal-based savings pool with deadline enforcement |
| `zk_verifier` | On-chain Noir proof verifier for credit score attestation |

ZK circuits are in `/circuits/ajora_credit` (Noir).

---

## Notes

- This project runs on **Stellar Testnet**. No real funds are at risk.
- The fee keypair used for transaction submission is the `kalepail` testnet faucet key — standard for passkey-kit testnet development.
- WebAuthn cross-device registration (scanning a QR code from another phone) requires Bluetooth to be enabled on both devices and works best within 1 meter.
