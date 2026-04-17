"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  fetchAllGroups, fetchAllPools, fetchUsdcBalance,
  stroopsToUsdc,
  type OnChainGroup, type OnChainPool,
} from "@/lib/soroban";
import { useWallet } from "@/context/WalletContext";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardHome() {
  const { address, connected, displayName, name } = useWallet();

  const [groups,  setGroups]  = useState<OnChainGroup[]>([]);
  const [pools,   setPools]   = useState<OnChainPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAllGroups(), fetchAllPools()])
      .then(([gs, ps]) => { setGroups(gs); setPools(ps); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!address) { setBalance(null); return; }
    fetchUsdcBalance(address)
      .then(b => setBalance(stroopsToUsdc(b)))
      .catch(() => setBalance(null));
  }, [address]);

  const myGroups = address ? groups.filter(g => g.members.includes(address)) : [];
  const myPools  = address ? pools.filter(p => p.members.includes(address))  : [];
  const hasMemberships = myGroups.length > 0 || myPools.length > 0;

  const activeGroups  = groups.filter(g => g.status === "Active");
  const formingGroups = groups.filter(g => g.status === "Forming");
  const maturedPools  = pools.filter(p => p.status === "Matured");

  // Show first name only
  const firstName = name?.split(" ")[0] || displayName?.split(" ")[0] || null;

  return (
    <div className="page-pad animate-fade-in">

      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px" }}>
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 4 }}>
          {connected
            ? "Your live savings overview on Stellar Testnet"
            : "Sign in to see your groups and pools"}
        </div>
      </div>

      {/* ── Sign-in prompt when not connected ── */}
      {!connected && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 16, padding: "24px 28px", marginBottom: 32,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 5 }}>
              Sign in with your phone number
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              No seed phrase. No wallet address. Your device handles the rest.
            </div>
          </div>
          <a href="/signin" style={{
            padding: "11px 24px", flexShrink: 0,
            background: "var(--green)", color: "#fff",
            borderRadius: 10, fontWeight: 700, fontSize: 14,
            textDecoration: "none",
          }}>
            Sign In
          </a>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="stats-grid">
        <StatCard
          label="USDC Balance"
          value={connected ? (balance ?? (loading ? "—" : "0")) : "—"}
          unit="USDC"
          accent="var(--green)"
          sub="in your smart wallet"
        />
        <StatCard
          label="My Groups"
          value={connected ? (loading ? "—" : String(myGroups.length)) : "—"}
          sub={myGroups.length === 1 ? "active membership" : "active memberships"}
        />
        <StatCard
          label="My Pools"
          value={connected ? (loading ? "—" : String(myPools.length)) : "—"}
          sub={myPools.length === 1 ? "savings pool" : "savings pools"}
        />
        <StatCard
          label="On Stellar"
          value={loading ? "—" : String(groups.length + pools.length)}
          sub={`${activeGroups.length} active · ${maturedPools.length} matured`}
          accent="var(--ink-soft)"
        />
      </div>

      {/* ── My Savings section ── */}
      {connected && !loading && hasMemberships && (
        <section style={{ marginBottom: 40 }}>
          <SectionHeader title="My Savings" href={myGroups.length > 0 ? "/dashboard/groups" : "/dashboard/savings"} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {myGroups.map(g => (
              <MyGroupCard key={`g-${g.id}`} g={g} address={address!} />
            ))}
            {myPools.map(p => (
              <MyPoolCard key={`p-${p.id}`} p={p} />
            ))}
          </div>
        </section>
      )}

      {/* ── Quick actions when user has no memberships ── */}
      {connected && !loading && !hasMemberships && (
        <div style={{
          background: "var(--green)", borderRadius: 20,
          padding: "28px 32px", marginBottom: 40,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 20, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 6, letterSpacing: "-0.3px" }}>
              Start saving with your community
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
              Join a rotating savings group or create a target savings pool — entirely on Stellar.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/dashboard/groups" style={{
              padding: "10px 20px",
              background: "rgba(232,151,10,0.2)", border: "1px solid rgba(232,151,10,0.4)",
              borderRadius: 9, color: "var(--amber)", fontWeight: 700, fontSize: 13,
              textDecoration: "none",
            }}>
              Rotating Groups →
            </Link>
            <Link href="/dashboard/savings" style={{
              padding: "10px 20px",
              background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 9, color: "#fff", fontWeight: 700, fontSize: 13,
              textDecoration: "none",
            }}>
              Target Pools →
            </Link>
          </div>
        </div>
      )}

      {/* ── Rotating savings preview ── */}
      <section style={{ marginBottom: 36 }}>
        <SectionHeader title="Rotating Savings" href="/dashboard/groups" />
        {loading ? (
          <LoadingSkeleton />
        ) : groups.length === 0 ? (
          <EmptyCard
            icon="⟳"
            msg="No rotating groups yet"
            sub="Create the first group on Stellar"
            href="/dashboard/groups"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groups.slice(0, 3).map(g => (
              <GroupPreviewCard key={g.id} g={g} myAddress={address} />
            ))}
          </div>
        )}
      </section>

      {/* ── Target savings preview ── */}
      <section>
        <SectionHeader title="Target Savings" href="/dashboard/savings" />
        {loading ? (
          <LoadingSkeleton />
        ) : pools.length === 0 ? (
          <EmptyCard
            icon="◎"
            msg="No savings pools yet"
            sub="Create a target savings pool"
            href="/dashboard/savings"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pools.slice(0, 3).map(p => (
              <PoolPreviewCard key={p.id} p={p} myAddress={address} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px", margin: 0 }}>
        {title}
      </h2>
      <Link href={href} style={{ fontSize: 13, color: "var(--green)", fontWeight: 600, textDecoration: "none" }}>
        See all →
      </Link>
    </div>
  );
}

function StatCard({ label, value, sub, accent, unit }: {
  label: string; value: string; sub?: string; accent?: string; unit?: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "20px 22px",
    }}>
      <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: accent || "var(--ink)", letterSpacing: "-1px", lineHeight: 1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-muted)" }}>{unit}</span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 5 }}>{sub}</div>
      )}
    </div>
  );
}

/** Card for groups the signed-in user is a member of */
function MyGroupCard({ g, address }: { g: OnChainGroup; address: string }) {
  const pct = g.total_cycles > 0 ? Math.round((g.current_cycle / g.total_cycles) * 100) : 0;
  const payoutIdx   = g.payout_order.indexOf(address);
  const payoutCycle = payoutIdx >= 0 ? payoutIdx + 1 : null;
  const isMyTurn    = payoutCycle !== null && payoutCycle === g.current_cycle;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px",
      borderLeft: `4px solid ${isMyTurn ? "var(--amber)" : "var(--green)"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>Group #{g.id}</span>
            <span style={{
              background: g.status === "Active" ? "rgba(11,61,46,0.1)" : "rgba(74,99,88,0.1)",
              borderRadius: 99, padding: "2px 8px",
              fontSize: 10, fontWeight: 700,
              color: g.status === "Active" ? "var(--green)" : "var(--ink-soft)",
            }}>
              {g.status.toUpperCase()}
            </span>
            {isMyTurn && (
              <span style={{
                background: "rgba(232,151,10,0.15)", border: "1px solid rgba(232,151,10,0.35)",
                borderRadius: 99, padding: "2px 8px",
                fontSize: 10, fontWeight: 700, color: "var(--amber)",
              }}>
                YOUR TURN
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>
            {g.members.length}/{g.max_members} members · {stroopsToUsdc(g.contribution_amount)} USDC/cycle
            {g.status === "Active" && ` · Cycle ${g.current_cycle}/${g.total_cycles}`}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>Pot</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>
            {stroopsToUsdc(g.contribution_amount * BigInt(g.members.length))} USDC
          </div>
        </div>
      </div>

      {payoutCycle !== null && (
        <div style={{
          marginTop: 10, borderRadius: 8, padding: "7px 12px",
          background: isMyTurn ? "rgba(232,151,10,0.1)" : "rgba(11,61,46,0.05)",
          border: `1px solid ${isMyTurn ? "rgba(232,151,10,0.25)" : "rgba(11,61,46,0.1)"}`,
          fontSize: 12, fontWeight: 600,
          color: isMyTurn ? "var(--amber)" : "var(--green)",
        }}>
          {isMyTurn
            ? "You receive the payout this cycle!"
            : `Your payout: Cycle ${payoutCycle} of ${g.total_cycles}`}
        </div>
      )}

      {g.status === "Active" && (
        <div className="progress-bar" style={{ marginTop: 12 }}>
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <Link href="/dashboard/groups" style={{
          fontSize: 12, color: "var(--green)", fontWeight: 600, textDecoration: "none",
        }}>
          View Group →
        </Link>
      </div>
    </div>
  );
}

/** Card for pools the signed-in user is a member of */
function MyPoolCard({ p }: { p: OnChainPool }) {
  const pct = p.total_cycles > 0 ? Math.round((p.current_cycle / p.total_cycles) * 100) : 0;
  const isMatured  = p.status === "Matured";
  const totalValue = stroopsToUsdc(p.contribution_amount * BigInt(p.total_cycles));

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px",
      borderLeft: `4px solid ${isMatured ? "var(--amber)" : "var(--green)"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>Pool #{p.id}</span>
            {isMatured ? (
              <span style={{
                background: "rgba(196,125,8,0.1)", border: "1px solid rgba(196,125,8,0.3)",
                borderRadius: 99, padding: "2px 8px",
                fontSize: 10, fontWeight: 700, color: "var(--amber-dim)",
              }}>READY TO WITHDRAW</span>
            ) : (
              <span style={{
                background: "rgba(11,61,46,0.1)", borderRadius: 99, padding: "2px 8px",
                fontSize: 10, fontWeight: 700, color: "var(--green)",
              }}>{p.status.toUpperCase()}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>
            {p.members.length}/{p.max_members} members · {stroopsToUsdc(p.contribution_amount)} USDC/cycle
            {p.status === "Active" && ` · Cycle ${p.current_cycle}/${p.total_cycles}`}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>Target</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{totalValue} USDC</div>
        </div>
      </div>

      {isMatured && (
        <div style={{
          marginTop: 10, borderRadius: 8, padding: "7px 12px",
          background: "rgba(196,125,8,0.08)", border: "1px solid rgba(196,125,8,0.2)",
          fontSize: 12, fontWeight: 600, color: "var(--amber-dim)",
        }}>
          Pool matured — withdraw your savings from the Target Savings page
        </div>
      )}

      <div className="progress-bar" style={{ marginTop: 12 }}>
        <div className="progress-bar-fill" style={{
          width: `${pct}%`,
          background: isMatured ? "var(--amber)" : undefined,
        }} />
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <Link href="/dashboard/savings" style={{
          fontSize: 12, fontWeight: 600, textDecoration: "none",
          color: isMatured ? "var(--amber-dim)" : "var(--green)",
        }}>
          {isMatured ? "Withdraw →" : "View Pool →"}
        </Link>
      </div>
    </div>
  );
}

/** Compact read-only preview card for the global group list */
function GroupPreviewCard({ g, myAddress }: { g: OnChainGroup; myAddress: string | null }) {
  const pct      = g.total_cycles > 0 ? Math.round((g.current_cycle / g.total_cycles) * 100) : 0;
  const isMember = myAddress ? g.members.includes(myAddress) : false;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px",
      borderLeft: isMember ? "4px solid var(--amber)" : "4px solid var(--green)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>Group #{g.id}</span>
            {isMember && (
              <span style={{
                background: "rgba(232,151,10,0.12)", border: "1px solid rgba(232,151,10,0.3)",
                borderRadius: 99, padding: "2px 8px",
                fontSize: 10, fontWeight: 700, color: "var(--amber)",
              }}>YOU</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>
            {g.status} · {g.members.length}/{g.max_members} members · {stroopsToUsdc(g.contribution_amount)} USDC
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>Pot</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
            {stroopsToUsdc(g.contribution_amount * BigInt(g.members.length))} USDC
          </div>
        </div>
      </div>
      {g.status === "Active" && (
        <div className="progress-bar" style={{ marginTop: 12 }}>
          <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Compact read-only preview card for the global pool list */
function PoolPreviewCard({ p, myAddress }: { p: OnChainPool; myAddress: string | null }) {
  const pct      = p.total_cycles > 0 ? Math.round((p.current_cycle / p.total_cycles) * 100) : 0;
  const isMember = myAddress ? p.members.includes(myAddress) : false;
  const isMatured = p.status === "Matured";
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "18px 20px",
      borderLeft: isMatured ? "4px solid var(--amber-dim)" : "4px solid var(--green)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>Pool #{p.id}</span>
            {isMember && (
              <span style={{
                background: "rgba(232,151,10,0.12)", border: "1px solid rgba(232,151,10,0.3)",
                borderRadius: 99, padding: "2px 8px",
                fontSize: 10, fontWeight: 700, color: "var(--amber)",
              }}>YOU</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 3 }}>
            {p.status} · {p.members.length}/{p.max_members} members · {stroopsToUsdc(p.contribution_amount)} USDC
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--ink-muted)" }}>Target</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
            {stroopsToUsdc(p.contribution_amount * BigInt(p.total_cycles))} USDC
          </div>
        </div>
      </div>
      <div className="progress-bar" style={{ marginTop: 12 }}>
        <div className="progress-bar-fill" style={{
          width: `${pct}%`,
          background: isMatured ? "var(--amber)" : undefined,
        }} />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 14, padding: "20px",
      display: "flex", alignItems: "center", gap: 16,
    }}>
      <div style={{ flex: 1, height: 12, background: "var(--border)", borderRadius: 6, opacity: 0.6 }} />
      <div style={{ width: 80, height: 12, background: "var(--border)", borderRadius: 6, opacity: 0.4 }} />
    </div>
  );
}

function EmptyCard({ icon, msg, sub, href }: {
  icon: string; msg: string; sub: string; href: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px dashed var(--border)",
      borderRadius: 14, padding: "24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 22, opacity: 0.3 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-soft)" }}>{msg}</div>
          <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{sub}</div>
        </div>
      </div>
      <Link href={href} style={{
        padding: "8px 16px",
        background: "var(--green)", color: "#fff",
        borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: "none",
      }}>
        Create →
      </Link>
    </div>
  );
}
