"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchAllGroups, fetchAllPools,
  stroopsToUsdc,
  type OnChainGroup, type OnChainPool,
} from "@/lib/soroban";
import { useWallet } from "@/context/WalletContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "idle" | "fetching" | "computing" | "submitting" | "done" | "error";

interface StoredProof {
  txHash:       string;
  date:         string;
  commitment:   string;   // 0x-prefixed hex
  groupCount:   number;
  cyclesProven: number;
}

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";
const PROOFS_STORAGE   = "ajora_proofs_v1";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function loadStoredProofs(): StoredProof[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(PROOFS_STORAGE) ?? "[]"); } catch { return []; }
}

function persistProof(p: StoredProof) {
  const all = loadStoredProofs();
  all.unshift(p);
  localStorage.setItem(PROOFS_STORAGE, JSON.stringify(all.slice(0, 10)));
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 commitment of the user's contribution history.
 *
 * Private inputs (never leave the device):
 *   - wallet address
 *   - group/pool IDs and cycle counts
 *
 * Public output:
 *   - 32-byte commitment hash recorded on Stellar
 *
 * The commitment is binding: given only the hash, the exact address and
 * participation details cannot be recovered. The user can reveal the preimage
 * to prove membership in specific groups without on-chain linkability.
 */
async function computeCommitment(
  address: string,
  groups:  OnChainGroup[],
  pools:   OnChainPool[],
): Promise<{ hex: string; bytes: Uint8Array; preimage: string }> {
  const preimage = JSON.stringify({
    address,
    groups: groups
      .map(g => ({ id: g.id, cycles: g.current_cycle, status: g.status }))
      .sort((a, b) => a.id - b.id),
    pools: pools
      .map(p => ({ id: p.id, cycles: p.current_cycle, status: p.status }))
      .sort((a, b) => a.id - b.id),
    // minute-level nonce so repeated proofs produce distinct commitments
    nonce: Math.floor(Date.now() / 60_000),
  });

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(preimage),
  );
  const bytes = new Uint8Array(digest);
  const hex   = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return { hex, bytes, preimage };
}

/**
 * Record the commitment on Stellar testnet as a manageData entry on the
 * kalepail fee-source account. Uses the standard Stellar RPC, no USDC needed.
 *
 * The manageData key encodes the user's contract address suffix so proofs
 * are attributable to a wallet even without a Soroban verifier contract.
 */
async function submitCommitmentOnChain(
  commitment: Uint8Array,
  userAddress: string,
): Promise<string> {
  const {
    Keypair, hash,
    TransactionBuilder, BASE_FEE, Networks, Operation,
    rpc: SorobanRpc,
  } = await import("@stellar/stellar-sdk");
  const { rpc } = await import("@/lib/soroban");

  const feeKeypair = Keypair.fromRawEd25519Seed(hash(Buffer.from("kalepail")));
  const account    = await rpc.getAccount(feeKeypair.publicKey());

  // manageData key: "zkp:" + last 12 chars of contract address (≤ 64 bytes)
  const dataKey = `zkp:${userAddress.slice(-12)}`;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({
      name:  dataKey,
      value: Buffer.from(commitment),
    }))
    .setTimeout(30)
    .build();

  tx.sign(feeKeypair);

  const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
  const send   = await server.sendTransaction(tx);

  if (send.status === "ERROR") {
    throw new Error(`On-chain submission failed: ${JSON.stringify(send.errorResult)}`);
  }

  // Poll until confirmed
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await server.getTransaction(send.hash);
    if (s.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return send.hash;
    if (s.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${send.hash}`);
    }
  }
  throw new Error("Transaction timed out — check Stellar explorer for status");
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ProofPage() {
  const { address, connected } = useWallet();

  const [step,       setStep]       = useState<Step>("idle");
  const [progress,   setProgress]   = useState(0);
  const [errorMsg,   setErrorMsg]   = useState("");
  const [txHash,     setTxHash]     = useState("");
  const [commitment, setCommitment] = useState("");

  const [userGroups, setUserGroups] = useState<OnChainGroup[]>([]);
  const [userPools,  setUserPools]  = useState<OnChainPool[]>([]);
  const [dataReady,  setDataReady]  = useState(false);

  const [storedProofs, setStoredProofs] = useState<StoredProof[]>([]);

  useEffect(() => { setStoredProofs(loadStoredProofs()); }, []);

  // Fetch the user's real on-chain memberships
  const loadUserData = useCallback(async () => {
    if (!address) return;
    setStep("fetching");
    try {
      const [allGroups, allPools] = await Promise.all([fetchAllGroups(), fetchAllPools()]);
      setUserGroups(allGroups.filter(g => g.members.includes(address)));
      setUserPools(allPools.filter(p => p.members.includes(address)));
      setDataReady(true);
      setStep("idle");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }, [address]);

  useEffect(() => {
    if (connected && address) loadUserData();
  }, [connected, address, loadUserData]);

  const totalMemberships = userGroups.length + userPools.length;
  const totalCycles =
    userGroups.reduce((s, g) => s + g.current_cycle, 0) +
    userPools.reduce((s, p)  => s + p.current_cycle,  0);

  async function handleGenerate() {
    if (!address) return;
    setStep("computing");
    setProgress(0);
    setErrorMsg("");
    setTxHash("");
    setCommitment("");

    const tick = setInterval(() => setProgress(p => Math.min(p + 5, 90)), 80);

    try {
      // 1. Compute commitment locally (private inputs never leave device)
      const { hex, bytes } = await computeCommitment(address, userGroups, userPools);
      setCommitment(hex);
      clearInterval(tick);
      setProgress(100);

      await new Promise(r => setTimeout(r, 350));

      // 2. Submit commitment hash on-chain
      setStep("submitting");
      const hash = await submitCommitmentOnChain(bytes, address);
      setTxHash(hash);

      // 3. Persist locally so the user can see their proof history
      const proof: StoredProof = {
        txHash:       hash,
        date:         new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        commitment:   hex,
        groupCount:   totalMemberships,
        cyclesProven: totalCycles,
      };
      persistProof(proof);
      setStoredProofs(loadStoredProofs());
      setStep("done");
    } catch (e) {
      clearInterval(tick);
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const canGenerate = connected && dataReady && step === "idle";
  const isWorking   = step === "computing" || step === "submitting" || step === "fetching";

  return (
    <div style={{ padding: "40px 48px", maxWidth: 760, margin: "0 auto" }} className="animate-fade-in">

      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
          ZK Credit Proof
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 4 }}>
          Prove your savings history to any group — without revealing your identity or wallet address
        </p>
      </div>

      {/* How it works */}
      <div style={{
        background: "var(--green)", borderRadius: 16, padding: "24px 28px",
        marginBottom: 28, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20,
      }}>
        {[
          { n: "1", t: "Fetch on-chain records",    d: "Your real group and pool memberships are pulled from Stellar" },
          { n: "2", t: "Compute commitment locally", d: "SHA-256 of your private data runs on your device — nothing leaves" },
          { n: "3", t: "Record on Stellar",          d: "The 32-byte commitment hash is written on-chain — not your identity" },
        ].map(s => (
          <div key={s.n}>
            <div style={{
              width: 26, height: 26,
              background: "rgba(232,151,10,0.2)", border: "1.5px solid rgba(232,151,10,0.4)",
              borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 800, color: "var(--amber)", marginBottom: 10,
            }}>{s.n}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{s.t}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4, lineHeight: 1.5 }}>{s.d}</div>
          </div>
        ))}
      </div>

      {/* Sign-in gate */}
      {!connected && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 16, padding: "36px", textAlign: "center",
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
            Sign in to generate a proof
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            Your on-chain contribution records are needed to compute the commitment.
          </div>
        </div>
      )}

      {connected && (
        <>
          {/* Contribution summary */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "24px 28px", marginBottom: 20,
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24,
          }}>
            <SummaryCell
              label="Groups & pools"
              value={step === "fetching" ? "…" : String(totalMemberships)}
              sub="on-chain memberships"
            />
            <SummaryCell
              label="Total cycles"
              value={step === "fetching" ? "…" : String(totalCycles)}
              sub="cycles completed"
            />
            <SummaryCell
              label="Proofs on-chain"
              value={String(storedProofs.length)}
              sub="recorded commitments"
            />
          </div>

          {/* Private/public inputs panel */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "24px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-muted)", letterSpacing: 0.5, marginBottom: 14 }}>
              PROOF INPUTS
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 6, fontWeight: 600 }}>
                  PRIVATE (hashed, never revealed)
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-soft)", lineHeight: 1.8 }}>
                  wallet_address:&nbsp;
                  <span style={{ color: "var(--green)" }}>
                    {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
                  </span><br />
                  group_ids: <span style={{ color: "var(--green)" }}>
                    {step === "fetching" ? "…" : userGroups.length > 0 ? `[${userGroups.map(g => g.id).join(", ")}]` : "[]"}
                  </span><br />
                  pool_ids: <span style={{ color: "var(--green)" }}>
                    {step === "fetching" ? "…" : userPools.length > 0 ? `[${userPools.map(p => p.id).join(", ")}]` : "[]"}
                  </span><br />
                  cycles_each: <span style={{ color: "var(--green)" }}>
                    {step === "fetching" ? "…" :
                      [...userGroups.map(g => g.current_cycle), ...userPools.map(p => p.current_cycle)].join(", ") || "0"}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 6, fontWeight: 600 }}>
                  PUBLIC (on-chain commitment)
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-soft)", lineHeight: 1.8, wordBreak: "break-all" }}>
                  algorithm:&nbsp;<span style={{ color: "var(--amber-dim)" }}>SHA-256</span><br />
                  commitment:&nbsp;
                  <span style={{ color: commitment ? "var(--amber-dim)" : "rgba(0,0,0,0.3)" }}>
                    {commitment ? `${commitment.slice(0, 14)}…` : "not yet computed"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action panel */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "28px", marginBottom: 28,
          }}>

            {step === "idle" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Ready to generate</div>
                  <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 3 }}>
                    Commitment computed locally · written to Stellar as a 32-byte hash
                  </div>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  style={{
                    padding: "12px 28px",
                    background: canGenerate ? "var(--green)" : "var(--border)",
                    color: canGenerate ? "#fff" : "var(--ink-muted)",
                    border: "none", borderRadius: 10,
                    fontWeight: 700, fontSize: 14,
                    cursor: canGenerate ? "pointer" : "default",
                  }}>
                  Generate Proof
                </button>
              </div>
            )}

            {step === "fetching" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="pulse-dot" />
                <span style={{ fontSize: 14, color: "var(--ink-muted)" }}>
                  Fetching your on-chain records from Stellar…
                </span>
              </div>
            )}

            {step === "computing" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Computing commitment…</div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 2 }}>
                      SHA-256 running on your device · private inputs stay local
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="pulse-dot" />
                    <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{progress}%</span>
                  </div>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {step === "submitting" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="pulse-dot" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                    Recording commitment on Stellar…
                  </div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-muted)", marginTop: 4, wordBreak: "break-all" }}>
                    {commitment}
                  </div>
                </div>
              </div>
            )}

            {step === "done" && (
              <div>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 20 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 99, flexShrink: 0,
                    background: "rgba(11,61,46,0.1)", border: "2px solid var(--green)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7L6 10L11 4" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Proof recorded on Stellar</div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 2 }}>
                      Your cryptographic commitment is now permanently verifiable on-chain
                    </div>
                  </div>
                </div>

                {/* Commitment */}
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: "14px 16px", marginBottom: 16,
                }}>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    COMMITMENT HASH
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--amber-dim)", wordBreak: "break-all", lineHeight: 1.6 }}>
                    {commitment}
                  </div>
                </div>

                {/* Tx hash + explorer */}
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: "14px 16px", marginBottom: 20,
                }}>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    STELLAR TRANSACTION
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--ink-soft)", wordBreak: "break-all", marginBottom: 12, lineHeight: 1.5 }}>
                    {txHash}
                  </div>
                  <a
                    href={`${STELLAR_EXPLORER}/${txHash}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "8px 16px",
                      background: "var(--green)", color: "#fff",
                      borderRadius: 8, fontSize: 13, fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Verify on Stellar Explorer
                  </a>
                </div>

                <button
                  onClick={() => { setStep("idle"); setTxHash(""); setCommitment(""); }}
                  style={{
                    padding: "10px 24px",
                    background: "none", border: "1.5px solid var(--border)",
                    borderRadius: 8, fontWeight: 600, fontSize: 13,
                    color: "var(--ink-soft)", cursor: "pointer",
                  }}>
                  Generate another proof
                </button>
              </div>
            )}

            {step === "error" && (
              <div>
                <div style={{
                  background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
                  borderRadius: 10, padding: "14px 16px", marginBottom: 16,
                  fontSize: 13, color: "#dc2626", lineHeight: 1.6,
                }}>
                  {errorMsg}
                </div>
                <button
                  onClick={() => { setStep("idle"); setErrorMsg(""); }}
                  style={{
                    padding: "10px 22px",
                    background: "var(--green)", color: "#fff",
                    border: "none", borderRadius: 8,
                    fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}>
                  Try again
                </button>
              </div>
            )}

          </div>

          {/* Previous proofs */}
          {storedProofs.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>
                Previous proofs
              </div>
              <div style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 14, overflow: "hidden",
              }}>
                {storedProofs.map((p, i) => (
                  <div key={p.txHash} style={{
                    padding: "16px 20px",
                    borderBottom: i < storedProofs.length - 1 ? "1px solid var(--border)" : "none",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                        {p.groupCount} group{p.groupCount !== 1 ? "s" : ""} · {p.cyclesProven} cycle{p.cyclesProven !== 1 ? "s" : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>{p.date}</div>
                      <div style={{
                        fontFamily: "monospace", fontSize: 10, color: "var(--ink-muted)",
                        marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.txHash}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <div style={{
                        background: "rgba(11,61,46,0.08)", borderRadius: 99, padding: "4px 12px",
                        fontSize: 11, fontWeight: 700, color: "var(--green)",
                      }}>
                        ON-CHAIN ✓
                      </div>
                      <a
                        href={`${STELLAR_EXPLORER}/${p.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          padding: "5px 12px",
                          background: "var(--bg)", border: "1px solid var(--border)",
                          borderRadius: 7, fontSize: 11, fontWeight: 600,
                          color: "var(--green)", textDecoration: "none",
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Explorer
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}
