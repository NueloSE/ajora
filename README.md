# Ajora — Trustless Rotating Savings on Stellar

---

My mother is a market trader in Nigeria. She sells frozen products, works long hours, and saves every naira she can.

For years, she participated in contribution societies — pooling money with other traders, rotating the payout each month. It was how she funded stock, covered emergencies, and planned ahead.

More than once, when it was her turn to receive, the organizer had excuses. Or was unreachable. Or was simply gone — along with everyone's money.

She is not alone. This happens every day across West Africa.

**Ajora exists because it should never happen again.**

---

West Africa has one of the highest rates of informal savings participation in the world. The infrastructure behind it is completely broken — built on trust that fails every single day.

Ajora does not ask people to change their behavior. It takes a financial system they already use and already trust culturally, and makes it technically trustless.

That is the product. That is the mission.

> **"46% of Nigerian households participate in informal savings groups — with no protection, no enforcement, and no recourse when the money disappears. Ajora puts the trust layer on-chain."**

---

## Tracks

**ZK · Agentic AI · Open Integration**

Ajora is the first decentralized platform to bring West Africa's deeply rooted rotating savings culture (ajo, esusu, susu) fully on-chain — combining Soroban smart contracts, an AI agent for group management, and ZK proofs for portable, privacy-preserving credit history.

---

## The Problem

Informal rotating savings groups are one of the most widespread financial behaviors in West Africa:

- **Ajo** — Nigeria
- **Esusu** — Nigeria
- **Susu** — Ghana

**46% of Nigerian households** participated in informal savings groups as of 2018 — up from 23% in 2010 (Global Informality Project). A 2014 EFInA survey found **25.6 million Nigerians** actively using informal financial services, including ajo and esusu. These community savings circles pool contributions from members and rotate a lump-sum payout to one member per cycle. They are not a niche behavior — they are the default savings infrastructure for tens of millions of people, built entirely on personal trust.

But that trust breaks down constantly:

| Failure Mode                           | Impact                                   |
| -------------------------------------- | ---------------------------------------- |
| Collector disappears with pooled funds | Members lose everything                  |
| Member defaults mid-cycle              | Group collapses, others go unpaid        |
| No verifiable contribution records     | Reputation is not portable across groups |
| No transparency                        | Disputes have no resolution mechanism    |
| No legal recourse                      | Losses are permanent                     |

There is no accountability layer. No enforcement. No record. No protection.

---

## The Solution

Ajora replaces human trust with **programmable guarantees**.

- Contributions, payouts, and enforcement are handled by Soroban smart contracts — not people
- An AI agent actively monitors group health, sends reminders, and detects defaults before they happen
- ZK proofs allow members to prove their contribution history and creditworthiness to future groups — without exposing their wallet address, balance, or identity
- Onboarding requires no crypto knowledge — users sign in with their fingerprint, face, or device PIN

---

## User Onboarding — No Crypto Knowledge Required

Ajora is a **web app** — no download or app store required. Users open it in their phone or desktop browser. Ajora uses the **Stellar Passkey Kit** for authentication. This means:

```
User visits the Ajora web app on their browser
          ↓
Signs up with phone number
          ↓
Authenticates using fingerprint, Face ID, or device PIN
          ↓
A Stellar wallet is created and controlled by their device —
private key never leaves their phone, never stored on our server
          ↓
User is ready to join or create an ajo group
```

There are no seed phrases. No wallet addresses shown. No crypto terminology. The experience feels like any modern banking or fintech app.

### Why Passkeys and Not Custodial Wallets

A custodial approach — where Ajora stores users' private keys — would recreate the exact trust problem we are solving. If our server is compromised, users lose their funds. We would be asking people to trust us the way they trusted the ajo organizer who disappeared.

Passkeys solve this cleanly. The private key lives on the user's device, protected by their biometrics or PIN. Ajora never has access to it. The trust is in the math — not in us.

### Device Coverage

| Device Type                 | Authentication Method  | Supported in MVP |
| --------------------------- | ---------------------- | ---------------- |
| Modern smartphone           | Face ID or fingerprint | Yes              |
| Basic smartphone            | Device PIN or pattern  | Yes              |
| Feature phone (no internet) | USSD / WhatsApp        | Post-MVP         |

The MVP targets smartphone users. Smartphone penetration in Nigeria and Ghana is above 50% and growing — this covers the majority of the addressable market. Feature phone and USSD access is the second post-hackathon milestone.

---

## How It Works (MVP)

### 1. Create a Savings Group

A user creates a new ajo group and defines:

- Contribution amount (displayed in Naira or Cedi)
- Number of members (e.g. 5, 10)
- Contribution frequency (weekly / biweekly)
- Payout order (fixed or randomized at start)

The group is deployed as a Soroban smart contract on Stellar.

### 2. Members Join

- Members sign up via the app and authenticate with their passkey
- A Stellar wallet is silently created and tied to their device
- Each member is assigned a payout position on-chain
- Joining locks in their commitment to the full cycle

### 3. Contributions

- Each cycle, members contribute via the app — amounts shown in local currency
- Transactions are signed by the user's passkey silently in the background
- Under the hood, contributions are made in testnet USDC on Stellar
- All contributions are recorded transparently on the Stellar blockchain
- The AI agent tracks contribution status in real time

### 4. AI Agent Management

The AI agent runs autonomously throughout each cycle:

- Sends **contribution reminders** before deadlines (SMS or in-app notification)
- Monitors contribution patterns and flags **at-risk members** before defaults occur
- **Triggers payouts** automatically to the designated recipient at cycle close
- Generates a **cycle health report** visible to all group members

### 5. Automated Payouts

- At cycle close, the smart contract releases the pooled funds to the designated member
- The transaction is executed on-chain — no human intermediary, no delay, no dispute
- The recipient sees the amount in local currency in the app

### 6. Default Detection and Enforcement

If a member fails to contribute by the deadline:

- The smart contract flags the default on-chain
- The member is blocked from future group participation
- The default is permanently recorded as part of their on-chain history

### 7. ZK Credit History

After completing a full cycle honestly:

- The member can generate a **ZK proof** of their contribution record
- This proof confirms: "I completed N cycles without defaulting"
- It reveals **nothing** about their wallet address, balance, or transaction history
- They can present this proof to any future ajo group as trustless, portable reputation

---

## Demo Flow (MVP flow include the following)

1. Open the Ajora web app in a browser — sign up with phone number, authenticate with fingerprint or device PIN
2. Create a new ajo group (5 members, weekly, ₦5,000 each — displayed in Naira)
3. Three members join and make contributions on Stellar testnet
4. AI agent sends a reminder to the two remaining members
5. One member defaults — the smart contract flags it on-chain
6. Payout is automatically triggered to the designated member
7. The payout recipient generates a ZK proof of completed participation
8. A new group verifies the ZK proof before accepting them as a member

---

## Tech Stack

### Blockchain

- **Stellar Network** — settlement and payment rails
- **Soroban Smart Contracts** — written in Rust, handles all group logic, contribution enforcement, and payout automation
- **USDC on Stellar** — stable unit of account for all on-chain fund management (testnet for MVP)

### Authentication and Wallets

- **Stellar Passkey Kit** — non-custodial wallet creation via WebAuthn (Face ID, fingerprint, or device PIN)
- **Backup device support** — users can register a second phone as an on-chain co-signer via cross-device WebAuthn (QR + Bluetooth). Both devices can sign transactions independently, with no seed phrase or recovery code needed.
- No seed phrases. No private key storage on our servers.

### ZK Layer

- ZK proof generation for contribution history verification
- Proves cycle completion and zero defaults — without revealing identity, wallet, or balance

### AI Agent

- Built on Claude API (Anthropic)
- Monitors on-chain contribution state each cycle
- Sends reminders, detects default risk patterns, triggers payout calls
- Generates human-readable cycle health summaries for group members

### Backend

- **Node.js / Express** — AI agent orchestration, notification delivery, group metadata
- **PostgreSQL** — user accounts, group state, contribution records

### Frontend

- **Next.js** + **Tailwind CSS** — mobile-first web app, works in any browser
- All amounts displayed in local currency (NGN / GHS)
- Passkey authentication as the primary and default flow

---

## Why Ajora

### 1. Real Problem, Real Users

This is not a hypothetical use case. Millions of West Africans run these savings groups today. The pain is immediate, understood, and deeply personal.

### 2. Three-Track Coverage

Ajora deliberately targets ZK, Agentic AI, and Open Integration — three of the four available tracks. It is not a single-track project with forced extras. Each component (ZK credit, AI agent, Stellar payments) is load-bearing.

### 3. Technically Sophisticated

- Soroban smart contracts in Rust
- Stellar Passkey Kit for non-custodial, seed-phrase-free onboarding
- ZK proof generation for portable, privacy-preserving reputation
- Autonomous AI agent integrated with on-chain state

### 4. Culturally Rooted

Built for West Africa, by a West African builder, solving a West African problem — using global-standard blockchain infrastructure. This is exactly the type of project the Stellar WA program exists to support.

### 5. Clear Path to Scale

The MVP is scoped for execution. The architecture extends naturally to:

- Live fiat on/off ramp via SEP-24 compliant Stellar anchor (first post-MVP milestone)
- Feature phone and USSD access (second post-MVP milestone)
- Collateral and penalty systems for default insurance
- Cross-border ajo groups for the West African diaspora
- On-chain micro-lending powered by ZK credit scores

---

## Deployed Contracts (Stellar Testnet)

All contracts are live on Stellar Testnet and can be verified on [Stellar Expert](https://stellar.expert/explorer/testnet).

| Contract | Address |
| -------- | ------- |
| Rotating Savings (ajo/esusu) | `CBJZDI7LJ3L7ZFQAP2NIIQ3Z4EHLOX27ARTMJD3LQCM3Q2VSXJAQ65D7` |
| Target Savings | `CDJX3LE5XFAGTA7KOF2OKGYQDOCNCWY2S6KHW7B36O6YCPFCK7ZRZI6S` |
| ZK Credit Verifier | `CCYOYAMU2WFPKDVQUT5ZYYHF45IRBOEIDR3SJZVBSVTXBMUOWCRCFLDZ` |

Network: `Test SDF Network ; September 2015`  
RPC: `https://soroban-testnet.stellar.org`

---

## MVP Scope (Hackathon Build)

| Feature                                                 | Status |
| ------------------------------------------------------- | ------ |
| Soroban smart contract — rotating savings (ajo/esusu)   | ✅ Built & deployed |
| Soroban smart contract — target savings pool            | ✅ Built & deployed |
| Soroban smart contract — ZK credit verifier             | ✅ Built & deployed |
| Passkey onboarding (non-custodial, no seed phrase)      | ✅ Built |
| Backup device — add second phone as co-signer on-chain  | ✅ Built |
| Contributions in testnet USDC                           | ✅ Built |
| Send USDC between wallets (biometric-signed)            | ✅ Built |
| Automated payout logic                                  | ✅ Built |
| Default detection and on-chain flagging                 | ✅ Built |
| ZK proof of contribution history                        | ✅ Built (Noir circuit) |
| Group dashboard UI (mobile-first)                       | ✅ Built |
| AI agent (reminders + payout trigger)                   | In scope |

---

## Revenue Model

Ajora charges a **1% platform fee on each payout**, deducted automatically by the smart contract at cycle close.

**Why 1% and not more:**
In a 10-person group where each member contributes ₦5,000/cycle, the payout is ₦50,000. A 1% fee = ₦500 — less than the cost of a single mobile transfer fee in Nigeria. It is invisible to users, scales naturally with group size, and does not punish recipients.

| Group Size | Contribution | Pool Payout | Ajora Fee (1%) |
| ---------- | ------------ | ----------- | -------------- |
| 5 members  | ₦5,000       | ₦25,000     | ₦250           |
| 10 members | ₦5,000       | ₦50,000     | ₦500           |
| 10 members | ₦20,000      | ₦200,000    | ₦2,000         |
| 20 members | ₦10,000      | ₦200,000    | ₦2,000         |

**Path to revenue at scale:**
A modest reach of 50,000 active group cycles per month — at an average pool of ₦50,000 — generates approximately **₦25 million (~$15,000 USD) in monthly platform fees**. No advertising, no data selling, no custodial risk. Revenue is purely transactional and fully on-chain.

**Post-MVP revenue expansion:**
- Fiat on/off ramp spread (SEP-24 anchor integration)
- Premium group tier for larger pools, custom cycle rules, and priority AI agent monitoring

---

## Future Vision (Post-Hackathon)

- **Live fiat on/off ramp** — SEP-24 anchor integration for real NGN/GHS flows (first milestone)
- **Feature phone access** — USSD and WhatsApp interface for users without smartphones (second milestone)
- **Collateral system** — members stake a small amount as default insurance
- **Portable ZK credit score** — usable across any DeFi protocol on Stellar
- **Micro-lending layer** — borrow against your ajo credit history
- **Cross-border groups** — Nigerian, Ghanaian, and diaspora members in one group
- **DAO governance** — group rules set and voted on by members

---

## Contact

**Team Name:** Ajora
**Track:** ZK · Agentic AI · Open Integration
**Email:** akalo.emmanuel18@gmail.com
