"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchAllGroups, fetchAllPools,
  checkCredit,
  type OnChainGroup, type OnChainPool,
} from "@/lib/soroban";
import { submitVerifiedProof } from "@/lib/contracts";
import { useWallet } from "@/context/WalletContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step =
  | "idle"
  | "fetching"           // loading on-chain group data
  | "proving"            // calling /api/zk/prove
  | "submitting"         // calling submit_verified_proof on-chain
  | "done"
  | "error"
  | "no_cycles";         // no completed cycles — cannot prove

interface StoredProof {
  txHash:         string;
  date:           string;
  commitment:     string;    // 64-char hex (32 bytes)
  cyclesProven:   number;
  groupId:        number;
  verified:       boolean;
}

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";
const PROOFS_STORAGE   = "ajora_zk_proofs_v2";

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
// Page component
// ---------------------------------------------------------------------------

export default function ProofPage() {
  const { address, connected } = useWallet();

  const [step,        setStep]        = useState<Step>("idle");
  const [errorMsg,    setErrorMsg]    = useState("");
  const [txHash,      setTxHash]      = useState("");
  const [commitment,  setCommitment]  = useState("");    // 64-char hex
  const [proofHex,    setProofHex]    = useState("");    // first 32 chars shown
  const [cycles,      setCycles]      = useState(0);
  const [hasCredit,   setHasCredit]   = useState<boolean | null>(null);

  const [userGroups,  setUserGroups]  = useState<OnChainGroup[]>([]);
  const [userPools,   setUserPools]   = useState<OnChainPool[]>([]);
  const [dataReady,   setDataReady]   = useState(false);

  const [storedProofs, setStoredProofs] = useState<StoredProof[]>([]);

  useEffect(() => { setStoredProofs(loadStoredProofs()); }, []);

  // Fetch the user's on-chain memberships and credit status
  const loadUserData = useCallback(async () => {
    if (!address) return;
    setStep("fetching");
    try {
      const [allGroups, allPools] = await Promise.all([
        fetchAllGroups(),
        fetchAllPools(),
      ]);
      const myGroups = allGroups.filter(g => g.members.includes(address));
      const myPools  = allPools.filter(p => p.members.includes(address));
      setUserGroups(myGroups);
      setUserPools(myPools);

      // Check ZK verifier for any existing valid proof
      let creditFound = false;
      for (const g of myGroups) {
        if (await checkCredit(address, g.id, 1)) { creditFound = true; break; }
      }
      setHasCredit(creditFound);
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

  // The first group the user is a member of (used as the proof's group anchor)
  const primaryGroup = userGroups[0] ?? null;

  async function handleGenerate() {
    if (!address || !primaryGroup) return;
    setStep("proving");
    setErrorMsg("");
    setTxHash("");
    setCommitment("");
    setProofHex("");

    try {
      // ── Step 1: Generate ZK proof (server-side Node.js, not browser WASM) ──
      const resp = await fetch("/api/zk/prove", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          walletAddress: address,
          groupId:       primaryGroup.id,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        throw new Error(err.error ?? `API error ${resp.status}`);
      }

      const result = await resp.json() as {
        verified:        boolean;
        reason?:         string;
        commitment?:     string;
        proof?:          string;
        cyclesCompleted: number;
      };

      if (!result.verified) {
        setErrorMsg(result.reason ?? "Proof generation failed.");
        setStep("no_cycles");
        return;
      }

      const commitment64 = result.commitment!;
      const proofHexFull = result.proof!;
      setCommitment(commitment64);
      setProofHex(proofHexFull);
      setCycles(result.cyclesCompleted);

      // ── Step 2: Submit proof record to ZK verifier (passkey-signed tx) ──
      setStep("submitting");

      const hash = await submitVerifiedProof(
        address,
        primaryGroup.id,
        commitment64,
        result.cyclesCompleted,
        true,
      );
      setTxHash(hash);

      // ── Step 3: Persist locally ──
      const proof: StoredProof = {
        txHash,
        date:        new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        commitment:  commitment64,
        cyclesProven: result.cyclesCompleted,
        groupId:     primaryGroup.id,
        verified:    true,
      };
      persistProof({ ...proof, txHash: hash });
      setStoredProofs(loadStoredProofs());
      setHasCredit(true);
      setStep("done");

    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canGenerate = connected && dataReady && step === "idle" && !!primaryGroup;
  const isWorking   = step === "proving" || step === "submitting" || step === "fetching";

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
          { n: "1", t: "Fetch on-chain state",     d: "Your group memberships and default history are read from Stellar" },
          { n: "2", t: "Generate Noir proof",       d: "Barretenberg UltraHonk proves: cycles ≥ min AND pedersen_hash matches — private inputs never shared" },
          { n: "3", t: "Record on ZK verifier",     d: "Proof record is submitted to the on-chain ZK verifier contract via your passkey" },
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

      {/* Circuit info banner */}
      <div style={{
        background: "rgba(11,61,46,0.05)", border: "1px solid rgba(11,61,46,0.15)",
        borderRadius: 12, padding: "12px 16px", marginBottom: 24,
        display: "flex", gap: 12, alignItems: "center",
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="3" stroke="var(--green)" strokeWidth="1.4"/>
          <path d="M5 8h6M8 5v6" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <div style={{ fontSize: 12, color: "var(--green)", lineHeight: 1.5 }}>
          <strong>Noir circuit</strong> · ajora_credit v1.0.0-beta.9 ·
          {" "}<code style={{ fontFamily: "monospace", fontSize: 11 }}>pedersen_hash([wallet_address, cycles_completed])</code>
          {" "}· UltraHonk proving system
        </div>
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
            Your on-chain group membership is needed to produce the ZK proof.
          </div>
        </div>
      )}

      {connected && (
        <>
          {/* Summary stats */}
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
              label="Primary group"
              value={step === "fetching" ? "…" : primaryGroup ? `#${primaryGroup.id}` : "—"}
              sub={primaryGroup ? `cycle ${primaryGroup.current_cycle}` : "no group found"}
            />
            <SummaryCell
              label="ZK credit"
              value={hasCredit === null ? "…" : hasCredit ? "Valid ✓" : "None"}
              sub={hasCredit ? "proof on ZK verifier" : "generate below"}
            />
          </div>

          {/* Proof inputs panel */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "24px", marginBottom: 20,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-muted)", letterSpacing: 0.5, marginBottom: 14 }}>
              CIRCUIT INPUTS
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 6, fontWeight: 600 }}>
                  PRIVATE (never leave your device)
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-soft)", lineHeight: 1.9 }}>
                  wallet_address:&nbsp;
                  <span style={{ color: "var(--green)" }}>
                    {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
                  </span><br />
                  cycles_completed:&nbsp;
                  <span style={{ color: "var(--green)" }}>
                    {step === "fetching" ? "…" : cycles > 0 ? cycles : primaryGroup?.current_cycle ?? 0}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginBottom: 6, fontWeight: 600 }}>
                  PUBLIC (on-chain inputs)
                </div>
                <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-soft)", lineHeight: 1.9 }}>
                  group_commitment:&nbsp;
                  <span style={{ color: commitment ? "var(--amber-dim)" : "rgba(0,0,0,0.3)", wordBreak: "break-all" }}>
                    {commitment ? `${commitment.slice(0, 12)}…` : "not yet computed"}
                  </span><br />
                  min_cycles:&nbsp;
                  <span style={{ color: "var(--amber-dim)" }}>1</span><br />
                  hash_fn:&nbsp;
                  <span style={{ color: "var(--amber-dim)" }}>pedersen (BN254)</span>
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
                    {primaryGroup
                      ? `Will prove membership in group #${primaryGroup.id} · Barretenberg UltraHonk`
                      : "Join a group first to generate a credit proof"}
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
                  Fetching on-chain group data…
                </span>
              </div>
            )}

            {step === "proving" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div className="pulse-dot" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                      Generating Noir ZK proof…
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>
                      Running Barretenberg UltraHonk prover · this takes 5–20 seconds
                    </div>
                  </div>
                </div>
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 11,
                  color: "var(--ink-muted)", lineHeight: 1.6,
                }}>
                  <div>circuit: ajora_credit · noir 1.0.0-beta.9</div>
                  <div>proving system: UltraHonk (Barretenberg BN254)</div>
                  <div>private inputs: wallet_address, cycles_completed</div>
                  <div>public inputs: group_commitment, min_cycles</div>
                </div>
              </div>
            )}

            {step === "submitting" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div className="pulse-dot" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                      Recording proof on ZK verifier contract…
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 2 }}>
                      Your passkey will sign the Stellar transaction
                    </div>
                  </div>
                </div>
                {commitment && (
                  <div style={{
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, marginBottom: 4 }}>
                      COMMITMENT (pedersen hash)
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--amber-dim)", wordBreak: "break-all" }}>
                      {commitment}
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === "no_cycles" && (
              <div>
                <div style={{
                  background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
                  borderRadius: 10, padding: "16px 18px", marginBottom: 16,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>
                    Cannot generate proof
                  </div>
                  <div style={{ fontSize: 13, color: "#dc2626", lineHeight: 1.6 }}>
                    {errorMsg}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6, marginBottom: 16 }}>
                  <strong>What this means:</strong> The Noir circuit enforces{" "}
                  <code style={{ fontFamily: "monospace" }}>assert(cycles_completed &gt;= min_cycles)</code>.
                  A member with defaults or zero completed cycles cannot satisfy this constraint —
                  the prover will fail to generate a valid proof. Only honest members can produce a proof
                  accepted by the ZK verifier contract.
                </div>
                <button
                  onClick={() => { setStep("idle"); setErrorMsg(""); }}
                  style={{
                    padding: "10px 22px", background: "var(--green)", color: "#fff",
                    border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}>
                  Back
                </button>
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
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
                      ZK proof recorded on Stellar
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 2 }}>
                      {cycles} cycle{cycles !== 1 ? "s" : ""} proven ·
                      group #{primaryGroup?.id} ·
                      UltraHonk verified
                    </div>
                  </div>
                </div>

                {/* Proof data */}
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: "14px 16px", marginBottom: 12,
                }}>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    COMMITMENT (pedersen_hash output — 32 bytes)
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--amber-dim)", wordBreak: "break-all", lineHeight: 1.6 }}>
                    {commitment}
                  </div>
                </div>

                {proofHex && (
                  <div style={{
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: "14px 16px", marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                      ULTRAHONK PROOF (first 32 bytes shown)
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--ink-soft)", wordBreak: "break-all", lineHeight: 1.6 }}>
                      {proofHex.slice(0, 64)}…
                      <span style={{ color: "var(--ink-muted)", marginLeft: 8 }}>
                        ({proofHex.length / 2} bytes total)
                      </span>
                    </div>
                  </div>
                )}

                {/* Tx hash */}
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: "14px 16px", marginBottom: 20,
                }}>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    STELLAR TRANSACTION (submit_verified_proof)
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
                  onClick={() => { setStep("idle"); setTxHash(""); setCommitment(""); setProofHex(""); }}
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
                    padding: "10px 22px", background: "var(--green)", color: "#fff",
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
                        Group #{p.groupId} · {p.cyclesProven} cycle{p.cyclesProven !== 1 ? "s" : ""} · UltraHonk
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>{p.date}</div>
                      <div style={{
                        fontFamily: "monospace", fontSize: 10, color: "var(--ink-muted)",
                        marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {p.commitment.slice(0, 32)}…
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <div style={{
                        background: "rgba(11,61,46,0.08)", borderRadius: 99, padding: "4px 12px",
                        fontSize: 11, fontWeight: 700, color: "var(--green)",
                      }}>
                        {p.verified ? "VERIFIED ✓" : "REJECTED"}
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
