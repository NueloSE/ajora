"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchAllPools, fetchAllGroups, fetchUsdcBalance,
  hasZkProofOnChain,
  type OnChainPool, stroopsToUsdc,
} from "@/lib/soroban";
import { createPool, joinPool, withdrawFromPool } from "@/lib/contracts";
import { useWallet } from "@/context/WalletContext";

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";

type Filter = "all" | "active" | "forming" | "matured";

export default function SavingsPage() {
  const { address } = useWallet();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [pools,      setPools]      = useState<OnChainPool[]>([]);
  const [groups,     setGroups]     = useState<import("@/lib/soroban").OnChainGroup[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [txHash,     setTxHash]     = useState<string | null>(null);
  const [txError,    setTxError]    = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Join modal + ZK gate
  const [joinTarget, setJoinTarget] = useState<OnChainPool | null>(null);
  const [zkChecking, setZkChecking] = useState(false);
  const [zkBlocked,  setZkBlocked]  = useState(false);

  const [form, setForm] = useState({
    name: "", amount: "10", members: "5", cycles: "6", cycleDays: "30",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, gs] = await Promise.all([fetchAllPools(), fetchAllGroups()]);
      setPools(ps);
      setGroups(gs);
    } catch (e) {
      console.error("Failed to fetch pools:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-open join modal when ?join=X is in the URL
  useEffect(() => {
    const joinId = searchParams.get("join");
    if (!joinId || pools.length === 0) return;
    const target = pools.find(p => p.id === Number(joinId));
    if (target && target.status === "Forming") {
      openJoinModal(target);
      router.replace("/dashboard/savings", { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pools]);

  const filtered = pools.filter(p =>
    filter === "all"     ? true :
    filter === "active"  ? p.status === "Active" :
    filter === "forming" ? p.status === "Forming" :
    p.status === "Matured"
  );

  /**
   * ZK proof gate before joining a pool.
   * If user has been in any prior group or pool, they must have an on-chain proof.
   */
  async function openJoinModal(pool: OnChainPool) {
    if (!address) return;
    setZkChecking(true);
    setZkBlocked(false);
    setTxError(null);
    setJoinTarget(pool);

    try {
      const hasPriorHistory =
        groups.some(g => g.members.includes(address)) ||
        pools.some(p => p.id !== pool.id && p.members.includes(address));

      if (hasPriorHistory) {
        const hasProof = await hasZkProofOnChain(address);
        if (!hasProof) {
          setZkBlocked(true);
          setZkChecking(false);
          return;
        }
      }
    } catch {
      // If the check itself fails, allow join — don't penalise for network issues
    }

    setZkChecking(false);
  }

  async function handleCreate() {
    if (!address) return;
    setSubmitting(true);
    setTxError(null);
    setTxHash(null);
    try {
      const amountStroops = BigInt(Math.round(Number(form.amount) * 10_000_000));
      const balance = await fetchUsdcBalance(address);
      if (balance < amountStroops) {
        const have = stroopsToUsdc(balance);
        setTxError(
          `Insufficient USDC. You have ${have} USDC but this pool requires ${form.amount} USDC per cycle. ` +
          `Fund your smart wallet (${address.slice(0, 6)}…${address.slice(-4)}) with testnet USDC to continue.`
        );
        setSubmitting(false);
        return;
      }
      const hash = await createPool(
        address,
        Number(form.amount),
        Number(form.cycleDays),
        Number(form.cycles),
        Number(form.members),
      );
      setTxHash(hash);
      setShowCreate(false);
      await loadData();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoin(poolId: number) {
    if (!address) return;
    setTxError(null);
    setTxHash(null);
    try {
      const hash = await joinPool(address, poolId);
      setTxHash(hash);
      setJoinTarget(null);
      await loadData();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleWithdraw(poolId: number) {
    if (!address) return;
    setTxError(null);
    setTxHash(null);
    try {
      const hash = await withdrawFromPool(address, poolId);
      setTxHash(hash);
      await loadData();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="page-pad animate-fade-in">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", margin: 0 }}>
            Target Savings
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 4, marginBottom: 0 }}>
            Save toward your goal with group accountability
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          padding: "11px 22px",
          background: "var(--green)", color: "#fff",
          border: "none", borderRadius: 10,
          fontWeight: 700, fontSize: 14, cursor: "pointer", flexShrink: 0,
        }}>
          + New Pool
        </button>
      </div>

      {/* Summary strip */}
      <div style={{
        background: "var(--green)", borderRadius: 16,
        padding: "20px 24px", marginBottom: 24,
        display: "flex", gap: 32, flexWrap: "wrap",
      }}>
        {[
          { l: "Total pools", v: loading ? "—" : String(pools.length) },
          { l: "Active",      v: loading ? "—" : String(pools.filter(p => p.status === "Active").length) },
          { l: "Forming",     v: loading ? "—" : String(pools.filter(p => p.status === "Forming").length) },
          { l: "Matured",     v: loading ? "—" : String(pools.filter(p => p.status === "Matured").length) },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>{s.l}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Tx feedback */}
      {txHash && (
        <div style={{
          background: "rgba(11,61,46,0.07)", border: "1px solid rgba(11,61,46,0.2)",
          borderRadius: 10, padding: "12px 16px", marginBottom: 20,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>Transaction confirmed</span>
          <a href={`${STELLAR_EXPLORER}/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
            View on Explorer →
          </a>
        </div>
      )}
      {txError && (
        <div style={{
          background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
          borderRadius: 10, padding: "12px 16px", marginBottom: 20,
          fontSize: 13, color: "#dc2626",
        }}>
          {txError}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {(["all", "active", "forming", "matured"] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 16px",
            background: filter === f ? "var(--green)" : "var(--surface)",
            color: filter === f ? "#fff" : "var(--ink-soft)",
            border: `1px solid ${filter === f ? "var(--green)" : "var(--border)"}`,
            borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            {f === "all" ? "All pools" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Pools list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-muted)", fontSize: 14 }}>
          Loading from Stellar…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filtered.map(p => (
            <PoolCard
              key={p.id}
              pool={p}
              myAddress={address}
              onJoin={() => openJoinModal(p)}
              onWithdraw={() => handleWithdraw(p.id)}
            />
          ))}
        </div>
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(11,22,18,0.55)", backdropFilter: "blur(4px)",
          zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 20, padding: 36,
            width: "100%", maxWidth: 480,
          }} className="animate-slide-up">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.4px", margin: 0 }}>
                New Savings Pool
              </h2>
              <button onClick={() => setShowCreate(false)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: "var(--ink-muted)", lineHeight: 1,
              }}>×</button>
            </div>

            <div style={{
              background: "rgba(232,151,10,0.07)", border: "1px solid rgba(232,151,10,0.2)",
              borderRadius: 10, padding: "12px 16px", marginBottom: 20,
              fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6,
            }}>
              Everyone saves their own money. At maturity each member withdraws exactly what they contributed.
            </div>

            {txError && (
              <div style={{
                background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
                borderRadius: 8, padding: "10px 14px", marginBottom: 16,
                fontSize: 12, color: "#dc2626",
              }}>{txError}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { key: "name",      label: "Pool name",                     placeholder: "e.g. School Fees 2025" },
                { key: "amount",    label: "Contribution per cycle (USDC)", placeholder: "10" },
                { key: "members",   label: "Max members",                   placeholder: "5" },
                { key: "cycles",    label: "Total cycles",                  placeholder: "6" },
                { key: "cycleDays", label: "Cycle duration (days)",         placeholder: "30" },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
                    {label}
                  </label>
                  <input
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{
                      width: "100%", padding: "11px 14px",
                      border: "1.5px solid var(--border)", borderRadius: 10,
                      fontSize: 14, color: "var(--ink)", background: "var(--bg)", outline: "none",
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
              <button onClick={() => setShowCreate(false)} style={{
                flex: 1, padding: "12px",
                background: "none", border: "1.5px solid var(--border)",
                borderRadius: 10, fontWeight: 600, fontSize: 14,
                color: "var(--ink-soft)", cursor: "pointer",
              }}>Cancel</button>
              <button
                onClick={handleCreate}
                disabled={submitting}
                style={{
                  flex: 2, padding: "12px",
                  background: submitting ? "var(--ink-soft)" : "var(--green)", color: "#fff",
                  border: "none", borderRadius: 10,
                  fontWeight: 700, fontSize: 14, cursor: submitting ? "wait" : "pointer",
                }}
              >
                {!address ? "Connect Wallet First" : submitting ? "Submitting…" : "Create Pool on Stellar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ZK-blocked modal ── */}
      {joinTarget && zkBlocked && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(11,22,18,0.6)", backdropFilter: "blur(4px)",
          zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 20, padding: 36,
            width: "100%", maxWidth: 440, textAlign: "center",
          }} className="animate-slide-up">
            <div style={{
              width: 52, height: 52, borderRadius: 99, margin: "0 auto 20px",
              background: "rgba(220,38,38,0.08)", border: "2px solid rgba(220,38,38,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 10 }}>
              ZK Proof Required
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.6, marginBottom: 24 }}>
              You have previous savings history on record. To protect other members, you must generate a
              ZK credit proof before joining a new pool.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setJoinTarget(null); setZkBlocked(false); }}
                style={{
                  flex: 1, padding: "11px",
                  background: "none", border: "1.5px solid var(--border)",
                  borderRadius: 10, fontWeight: 600, fontSize: 14,
                  color: "var(--ink-soft)", cursor: "pointer",
                }}>
                Cancel
              </button>
              <Link href="/dashboard/proof" style={{
                flex: 2, padding: "11px",
                background: "var(--green)", color: "#fff",
                border: "none", borderRadius: 10,
                fontWeight: 700, fontSize: 14, cursor: "pointer",
                textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                Generate Proof →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Join confirm modal ── */}
      {joinTarget && !zkBlocked && !zkChecking && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(11,22,18,0.55)", backdropFilter: "blur(4px)",
          zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 20, padding: 36,
            width: "100%", maxWidth: 440,
          }} className="animate-slide-up">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>
                Join Pool #{joinTarget.id}
              </h2>
              <button onClick={() => setJoinTarget(null)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: "var(--ink-muted)", lineHeight: 1,
              }}>×</button>
            </div>

            {/* Pool summary */}
            <div style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "16px 18px", marginBottom: 20,
            }}>
              {[
                ["Contribution / cycle", `${stroopsToUsdc(joinTarget.contribution_amount)} USDC`],
                ["Total target",         `${stroopsToUsdc(joinTarget.contribution_amount * BigInt(joinTarget.total_cycles))} USDC`],
                ["Total cycles",         String(joinTarget.total_cycles)],
                ["Members",              `${joinTarget.members.length} / ${joinTarget.max_members}`],
                ["Admin",                `${joinTarget.admin.slice(0, 6)}…${joinTarget.admin.slice(-4)}`],
              ].map(([l, v]) => (
                <div key={l} style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 13, padding: "5px 0",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ color: "var(--ink-muted)" }}>{l}</span>
                  <span style={{ color: "var(--ink)", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* ZK badge — only shown when user had prior history and passed */}
            {(groups.some(g => g.members.includes(address ?? "")) ||
              pools.some(p => p.id !== joinTarget.id && p.members.includes(address ?? ""))) && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "rgba(11,61,46,0.07)", border: "1px solid rgba(11,61,46,0.15)",
                borderRadius: 8, padding: "10px 14px", marginBottom: 16,
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                  ZK proof verified — no prior defaults on record
                </span>
              </div>
            )}

            {txError && (
              <div style={{
                background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
                borderRadius: 8, padding: "10px 14px", marginBottom: 16,
                fontSize: 12, color: "#dc2626",
              }}>{txError}</div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setJoinTarget(null); setTxError(null); }} style={{
                flex: 1, padding: "12px",
                background: "none", border: "1.5px solid var(--border)",
                borderRadius: 10, fontWeight: 600, fontSize: 14,
                color: "var(--ink-soft)", cursor: "pointer",
              }}>Cancel</button>
              <button
                onClick={() => handleJoin(joinTarget.id)}
                disabled={submitting}
                style={{
                  flex: 2, padding: "12px",
                  background: submitting ? "var(--ink-soft)" : "var(--green)", color: "#fff",
                  border: "none", borderRadius: 10,
                  fontWeight: 700, fontSize: 14, cursor: submitting ? "wait" : "pointer",
                }}>
                {submitting ? "Joining…" : "Confirm Join →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZK checking overlay */}
      {zkChecking && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(11,22,18,0.4)", backdropFilter: "blur(2px)",
          zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 16, padding: "28px 36px",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <div className="pulse-dot" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
              Verifying ZK proof on Stellar…
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pool card ────────────────────────────────────────────────────────────────

function PoolCard({ pool, myAddress, onJoin, onWithdraw }: {
  pool: OnChainPool;
  myAddress: string | null;
  onJoin: () => void;
  onWithdraw: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const url = `${window.location.origin}/dashboard/savings?join=${pool.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const pct       = pool.total_cycles > 0 ? Math.round((pool.current_cycle / pool.total_cycles) * 100) : 0;
  const isMember  = myAddress ? pool.members.includes(myAddress) : false;
  const isFull    = pool.members.length >= pool.max_members;
  const isMatured = pool.status === "Matured";
  const contrib   = stroopsToUsdc(pool.contribution_amount);
  const target    = stroopsToUsdc(pool.contribution_amount * BigInt(pool.total_cycles));

  const statusColor: Record<string, string> = {
    Active:    "var(--green)",
    Forming:   "var(--ink-soft)",
    Matured:   "var(--amber-dim)",
    Cancelled: "#dc2626",
  };

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "26px 28px",
      borderLeft: `4px solid ${statusColor[pool.status] ?? "var(--border)"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px" }}>
              Pool #{pool.id}
            </span>
            <span style={{
              background: isMatured ? "rgba(196,125,8,0.1)" : "rgba(11,61,46,0.1)",
              border: `1px solid ${isMatured ? "rgba(196,125,8,0.3)" : "rgba(11,61,46,0.2)"}`,
              borderRadius: 99, padding: "3px 10px",
              fontSize: 10, fontWeight: 700,
              color: statusColor[pool.status] ?? "var(--ink-soft)",
              letterSpacing: 0.5,
            }}>
              {isMatured ? "MATURED — WITHDRAW" : pool.status.toUpperCase()}
            </span>
            {isMember && (
              <span style={{
                background: "rgba(232,151,10,0.12)", border: "1px solid rgba(232,151,10,0.3)",
                borderRadius: 99, padding: "3px 10px",
                fontSize: 10, fontWeight: 700, color: "var(--amber)",
              }}>YOU</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 5, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              {pool.members.length}/{pool.max_members} members
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              {contrib} USDC / cycle
            </span>
            {pool.status === "Active" && (
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Cycle {pool.current_cycle}/{pool.total_cycles}
              </span>
            )}
            {pool.status === "Forming" && (
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Waiting for {pool.max_members - pool.members.length} more
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Total target</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
            {target} USDC
          </div>
        </div>
      </div>

      <div className="progress-bar" style={{ marginBottom: 18 }}>
        <div className="progress-bar-fill" style={{
          width: `${pct}%`,
          background: isMatured ? "var(--amber)" : undefined,
        }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>
          admin: {pool.admin.slice(0, 6)}…{pool.admin.slice(-4)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {/* Share button for forming pools */}
          {pool.status === "Forming" && (
            <button onClick={handleShare} title="Copy invite link" style={{
              padding: "8px 14px", display: "flex", alignItems: "center", gap: 6,
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 8, fontSize: 12, fontWeight: 600,
              color: copied ? "var(--green)" : "var(--ink-soft)", cursor: "pointer",
              transition: "color 0.2s",
            }}>
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M8 1H2a1 1 0 00-1 1v7M4 3h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  Share
                </>
              )}
            </button>
          )}

          {pool.status === "Forming" && !isMember && !isFull && (
            <button onClick={onJoin} style={{
              padding: "9px 20px",
              background: "var(--green)", color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              Join Pool →
            </button>
          )}
          {pool.status === "Forming" && isFull && (
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Full — activating soon</span>
          )}
          {isMatured && isMember && (
            <button onClick={onWithdraw} style={{
              padding: "9px 18px",
              background: "var(--amber)", color: "var(--green)",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}>
              Withdraw
            </button>
          )}
          {isMember && !isMatured && (
            <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, padding: "9px 0" }}>
              Member
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{
      textAlign: "center", padding: "64px 32px",
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 20,
    }}>
      <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3 }}>◎</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
        No savings pools yet
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-muted)", marginBottom: 24, maxWidth: 340, margin: "0 auto 24px" }}>
        Create a target savings pool — each member saves toward their own goal with on-chain accountability.
      </div>
      <button onClick={onCreate} style={{
        padding: "12px 28px",
        background: "var(--green)", color: "#fff",
        border: "none", borderRadius: 10,
        fontWeight: 700, fontSize: 14, cursor: "pointer",
      }}>
        Create the First Pool
      </button>
    </div>
  );
}
