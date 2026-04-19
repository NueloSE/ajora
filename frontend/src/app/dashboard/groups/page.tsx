"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchAllGroups, fetchUsdcBalance, hasZkProofOnChain, type OnChainGroup, stroopsToUsdc, REPUTATION_ID } from "@/lib/soroban";
import { createGroup, joinGroup, contribute } from "@/lib/contracts";
import { useWallet } from "@/context/WalletContext";
import { saveGroupName as saveGroupNameRemote, fetchGroupNames } from "@/lib/registry";

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";

type Filter = "all" | "active" | "forming";


function statusTag(s: string): string {
  switch (s) {
    case "Forming":   return "FORMING";
    case "Active":    return "ACTIVE";
    case "Completed": return "COMPLETED";
    default:          return s.toUpperCase();
  }
}

export default function GroupsPage() {
  const { address } = useWallet();
  const searchParams  = useSearchParams();
  const router        = useRouter();

  const [groups,      setGroups]      = useState<OnChainGroup[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState<Filter>("all");
  const [showCreate,  setShowCreate]  = useState(false);
  const [joinTarget,  setJoinTarget]  = useState<OnChainGroup | null>(null); // group pending ZK check
  const [zkChecking,  setZkChecking]  = useState(false);
  const [zkBlocked,   setZkBlocked]   = useState(false);  // true = user has history but no proof
  const [txHash,      setTxHash]      = useState<string | null>(null);
  const [txError,     setTxError]     = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);

  const [groupNames, setGroupNames] = useState<Record<number, string>>({});

  const [form, setForm] = useState({
    name: "", amount: "10", members: "4", cycleDays: "30", minScore: "0",
  });

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const gs = await fetchAllGroups();
      setGroups(gs);
    } catch {
      // Retry once after 3s — testnet RPC can have brief outages
      await new Promise(r => setTimeout(r, 3000));
      try {
        const gs = await fetchAllGroups();
        setGroups(gs);
      } catch (e) {
        console.error("Failed to fetch groups:", e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => { fetchGroupNames().then(setGroupNames).catch(() => {}); }, []);

  // Auto-open join modal when ?join=X is in the URL (from a share link).
  // Fetches the specific group directly so it doesn't depend on the full list loading.
  useEffect(() => {
    const joinId = searchParams.get("join");
    if (!joinId) return;
    const id = Number(joinId);
    if (!id) return;

    async function openFromLink() {
      // Try from already-loaded groups first
      const fromList = groups.find(g => g.id === id);
      if (fromList) {
        openJoinModal(fromList);
        router.replace("/dashboard/groups", { scroll: false });
        return;
      }
      // Otherwise fetch the single group directly
      try {
        const { fetchGroup } = await import("@/lib/soroban");
        const g = await fetchGroup(id);
        if (g) {
          // Merge into groups list so the card also appears
          setGroups(prev => prev.some(x => x.id === id) ? prev : [...prev, g]);
          openJoinModal(g);
          router.replace("/dashboard/groups", { scroll: false });
        }
      } catch {
        // Silently fail — user sees the groups list normally
      }
    }

    openFromLink();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filtered = groups.filter(g =>
    filter === "all" ? true :
    filter === "active" ? g.status === "Active" :
    g.status === "Forming"
  );

  async function handleCreate() {
    if (!address) return;
    setSubmitting(true);
    setTxError(null);
    setTxHash(null);
    try {
      const minScore = Number(form.minScore);
      // Always wire reputation when available — even Open groups (minScore=0) need
      // it so that defaults count against score and re-entry ordering works correctly
      const repContract = REPUTATION_ID || null;
      const hash = await createGroup(
        address,
        Number(form.amount),
        Number(form.cycleDays),
        Number(form.members),
        minScore,
        repContract,
      );
      setTxHash(hash);
      setShowCreate(false);
      const refreshed = await fetchAllGroups();
      setGroups(refreshed);
      setLoading(false);
      // Save name to Supabase so all users see it
      if (form.name.trim()) {
        const newId = refreshed.length > 0 ? refreshed[refreshed.length - 1].id : 1;
        await saveGroupNameRemote(newId, form.name.trim());
        const updatedNames = await fetchGroupNames();
        setGroupNames(updatedNames);
        setForm(f => ({ ...f, name: "" }));
      }
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Opening the join modal runs a ZK proof gate:
   *   - If the user has never been in any group → no proof needed (first group)
   *   - If the user has prior memberships → must have a ZK commitment on-chain
   * This prevents people who defaulted in a previous group from quietly joining a new one.
   */
  async function openJoinModal(group: OnChainGroup) {
    if (!address) return;
    setZkChecking(true);
    setZkBlocked(false);
    setTxError(null);
    setJoinTarget(group);

    try {
      const hasPriorGroups = groups.some(
        g => g.id !== group.id && g.members.includes(address)
      );

      if (hasPriorGroups) {
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

  async function handleJoin(groupId: number) {
    if (!address) return;
    setTxError(null);
    setTxHash(null);
    try {
      const hash = await joinGroup(address, groupId);
      setTxHash(hash);
      setJoinTarget(null);
      await loadGroups();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Map on-chain error codes to human-readable messages
      if (msg.includes("14") || msg.toLowerCase().includes("reputation")) {
        setTxError("Reputation check failed — your score is too low or you have unpaid debts. Check your reputation on the dashboard.");
      } else if (msg.toLowerCase().includes("locked")) {
        setTxError("Your account is locked due to repeated defaults. Check your reputation on the dashboard for the unlock date.");
      } else {
        setTxError(msg);
      }
    }
  }

  async function handleContribute(groupId: number, contributionAmount: bigint) {
    if (!address) return;
    setTxError(null);
    setTxHash(null);
    try {
      // Check USDC balance before triggering biometric prompt
      const balance = await fetchUsdcBalance(address);
      if (balance < contributionAmount) {
        const have = stroopsToUsdc(balance);
        const need = stroopsToUsdc(contributionAmount);
        setTxError(
          `Insufficient USDC balance. You have ${have} USDC but need ${need} USDC. ` +
          `Fund your smart wallet (${address.slice(0, 6)}…${address.slice(-4)}) with testnet USDC to continue.`
        );
        return;
      }
      const hash = await contribute(address, groupId);
      setTxHash(hash);
      await loadGroups();
    } catch (e) {
      setTxError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ padding: "40px 48px", maxWidth: 860, margin: "0 auto" }} className="animate-fade-in">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
            Rotating Savings
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 4 }}>
            Pool contributions, rotate payouts — ajo style
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          padding: "11px 22px",
          background: "var(--green)", color: "#fff",
          border: "none", borderRadius: 10,
          fontWeight: 700, fontSize: 14, cursor: "pointer",
        }}>
          + New Group
        </button>
      </div>

      {/* Tx feedback */}
      {txHash && (
        <div style={{
          background: "rgba(11,61,46,0.07)", border: "1px solid rgba(11,61,46,0.2)",
          borderRadius: 10, padding: "12px 16px", marginBottom: 20,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>
            Transaction confirmed
          </span>
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
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {(["all", "active", "forming"] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 18px",
            background: filter === f ? "var(--green)" : "var(--surface)",
            color: filter === f ? "#fff" : "var(--ink-soft)",
            border: `1px solid ${filter === f ? "var(--green)" : "var(--border)"}`,
            borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            {f === "all" ? "All groups" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Groups list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-muted)", fontSize: 14 }}>
          Loading from Stellar…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filtered.map(g => (
            <GroupCard
              key={g.id}
              group={g}
              groupName={groupNames[g.id] ?? null}
              myAddress={address}
              onJoin={() => openJoinModal(g)}
              onContribute={() => handleContribute(g.id, g.contribution_amount)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.4px" }}>
                New Rotating Group
              </h2>
              <button onClick={() => setShowCreate(false)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: "var(--ink-muted)", lineHeight: 1,
              }}>×</button>
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
                { key: "name",      label: "Group name",                    placeholder: "e.g. Lagos Circle" },
                { key: "amount",    label: "Contribution per cycle (USDC)", placeholder: "10" },
                { key: "members",   label: "Max members",                   placeholder: "4" },
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

              {/* Minimum reputation score selector */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
                  Member eligibility
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { value: "0",  label: "Open",    desc: "Anyone can join, including re-entry members" },
                    { value: "60", label: "Standard", desc: "Score ≥ 60 required — no prior uncured defaults" },
                    { value: "80", label: "Trusted",  desc: "Score ≥ 80 required — trusted members only" },
                  ].map(opt => (
                    <label key={opt.value} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                      padding: "10px 14px",
                      border: `1.5px solid ${form.minScore === opt.value ? "var(--green)" : "var(--border)"}`,
                      borderRadius: 10, background: form.minScore === opt.value ? "rgba(11,61,46,0.05)" : "var(--bg)",
                    }}>
                      <input
                        type="radio" name="minScore" value={opt.value}
                        checked={form.minScore === opt.value}
                        onChange={e => setForm(f => ({ ...f, minScore: e.target.value }))}
                        style={{ marginTop: 2, accentColor: "var(--green)" }}
                      />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 2 }}>{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
              <button onClick={() => setShowCreate(false)} style={{
                flex: 1, padding: "12px",
                background: "none", border: "1.5px solid var(--border)",
                borderRadius: 10, fontWeight: 600, fontSize: 14,
                color: "var(--ink-soft)", cursor: "pointer",
              }}>
                Cancel
              </button>
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
                {!address ? "Connect Wallet First" : submitting ? "Submitting…" : "Create Group on Stellar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ZK-blocked modal: user has prior groups but no on-chain proof ── */}
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
              You have previous savings groups on record. To protect other members, you must generate a
              ZK credit proof showing you completed your prior cycles without defaulting before joining a new group.
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

      {/* ── Join confirm modal: ZK passed, confirm and sign ── */}
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
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>
                Join Group #{joinTarget.id}
              </h2>
              <button onClick={() => setJoinTarget(null)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 20, color: "var(--ink-muted)", lineHeight: 1,
              }}>×</button>
            </div>

            {/* Group summary */}
            <div style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "16px 18px", marginBottom: 20,
            }}>
              {[
                ["Contribution / cycle", `${stroopsToUsdc(joinTarget.contribution_amount)} USDC`],
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

            {/* ZK badge — only shown when user had prior groups and passed */}
            {groups.some(g => g.id !== joinTarget.id && g.members.includes(address ?? "")) && (
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

function GroupCard({ group, groupName, myAddress, onJoin, onContribute }: {
  group: OnChainGroup;
  groupName: string | null;
  myAddress: string | null;
  onJoin: () => void;
  onContribute: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const url = `${window.location.origin}/dashboard/groups?join=${group.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const pct = group.total_cycles > 0
    ? Math.round((group.current_cycle / group.total_cycles) * 100)
    : 0;
  const isMember  = myAddress ? group.members.includes(myAddress) : false;
  const _isAdmin  = myAddress === group.admin;
  const isFull    = group.members.length >= group.max_members;
  const contribution = stroopsToUsdc(group.contribution_amount);
  const pot = stroopsToUsdc(group.contribution_amount * BigInt(group.members.length));

  // Payout position: 1-based index in payout_order
  const payoutIndex = myAddress ? group.payout_order.indexOf(myAddress) : -1;
  const payoutCycle = payoutIndex >= 0 ? payoutIndex + 1 : null;

  // Who gets paid this cycle (shown in Active groups)
  const currentRecipient = group.status === "Active" && group.payout_order.length > 0
    ? group.payout_order[group.current_cycle - 1] ?? null
    : null;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "26px 28px",
      borderLeft: `4px solid var(--green)`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px" }}>
              {groupName ?? `Group #${group.id}`}
            </span>
            {groupName && (
              <span style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 500 }}>
                #{group.id}
              </span>
            )}
            <span style={{
              background: group.status === "Active"
                ? "rgba(11,61,46,0.1)" : "rgba(74,99,88,0.1)",
              borderRadius: 99, padding: "3px 10px",
              fontSize: 10, fontWeight: 700,
              color: group.status === "Active" ? "var(--green)" : "var(--ink-soft)",
              letterSpacing: 0.5,
            }}>
              {statusTag(group.status)}
            </span>
            {isMember && (
              <span style={{
                background: "rgba(232,151,10,0.12)", border: "1px solid rgba(232,151,10,0.3)",
                borderRadius: 99, padding: "3px 10px",
                fontSize: 10, fontWeight: 700, color: "var(--amber)",
              }}>YOU</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              {group.members.length}/{group.max_members} members
            </span>
            {group.status === "Active" && (
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                Cycle {group.current_cycle}/{group.total_cycles}
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
              {contribution} USDC / cycle
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>Pot size</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
            {pot} USDC
          </div>
        </div>
      </div>

      {group.status === "Active" && (
        <div className="progress-bar" style={{ marginBottom: 18 }}>
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Payout info row */}
      {(payoutCycle !== null || currentRecipient) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          {payoutCycle !== null && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(232,151,10,0.09)", border: "1px solid rgba(232,151,10,0.25)",
              borderRadius: 8, padding: "6px 12px",
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" stroke="var(--amber)" strokeWidth="1.4"/>
                <path d="M6 3v3l2 1" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700 }}>
                Your payout: Cycle {payoutCycle} of {group.total_cycles}
              </span>
            </div>
          )}
          {currentRecipient && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(11,61,46,0.06)", border: "1px solid rgba(11,61,46,0.15)",
              borderRadius: 8, padding: "6px 12px",
            }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1l1.5 3H11l-2.8 2 1.1 3.4L6 7.6 2.7 9.4 3.8 6 1 4h3.5L6 1z" fill="var(--green)" opacity="0.8"/>
              </svg>
              <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                Current payout:{" "}
                {myAddress === currentRecipient
                  ? "You!"
                  : `${currentRecipient.slice(0, 6)}…${currentRecipient.slice(-4)}`}
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>
          admin: {group.admin.slice(0, 6)}…{group.admin.slice(-4)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          {/* Share button — always visible for Forming groups */}
          {group.status === "Forming" && (
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

          {group.status === "Forming" && !isMember && !isFull && (
            <button onClick={onJoin} style={{
              padding: "9px 20px",
              background: "var(--green)", color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              Join Group →
            </button>
          )}
          {group.status === "Forming" && isFull && (
            <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Full — activating soon</span>
          )}
          {group.status === "Active" && isMember && (
            <button onClick={onContribute} style={{
              padding: "9px 20px",
              background: "var(--green)", color: "#fff",
              border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
              Contribute →
            </button>
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
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "center", opacity: 0.3, color: "var(--ink-muted)" }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path d="M4 12a8 8 0 018-8 8 8 0 016 2.67" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M20 12a8 8 0 01-8 8 8 8 0 01-6-2.67" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M18 6.5V3.5h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 17.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
        No groups yet on Stellar
      </div>
      <div style={{ fontSize: 14, color: "var(--ink-muted)", marginBottom: 24, maxWidth: 340, margin: "0 auto 24px" }}>
        Be the first to create a rotating savings group — your group will live entirely on-chain.
      </div>
      <button onClick={onCreate} style={{
        padding: "12px 28px",
        background: "var(--green)", color: "#fff",
        border: "none", borderRadius: 10,
        fontWeight: 700, fontSize: 14, cursor: "pointer",
      }}>
        Create the First Group
      </button>
    </div>
  );
}
