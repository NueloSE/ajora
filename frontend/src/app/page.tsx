"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchAllGroups, fetchAllPools, stroopsToUsdc } from "@/lib/soroban";

function useLiveStats() {
  const [stats, setStats] = useState<{
    activeGroups: number;
    totalSavedUsdc: string;
    cyclesCompleted: number;
  } | null>(null);

  useEffect(() => {
    Promise.all([fetchAllGroups(), fetchAllPools()])
      .then(([groups, pools]) => {
        // Active + Completed groups count as "active" on the landing page
        const activeGroups = groups.filter(g => g.status === "Active" || g.status === "Forming").length;

        // Total USDC saved = sum of (contribution × cycles run × members) across all groups & pools
        let totalStroops = BigInt(0);
        for (const g of groups) {
          totalStroops += g.contribution_amount * BigInt(g.current_cycle) * BigInt(g.members.length);
        }
        for (const p of pools) {
          totalStroops += p.contribution_amount * BigInt(p.current_cycle) * BigInt(p.members.length);
        }

        // Cycles completed = sum of current_cycle across everything
        const cyclesCompleted = [...groups, ...pools].reduce((n, x) => n + x.current_cycle, 0);

        const raw = stroopsToUsdc(totalStroops);
        const num = parseFloat(raw.replace(/,/g, ""));
        const totalSavedUsdc = num >= 1_000_000
          ? `$${(num / 1_000_000).toFixed(1)}M`
          : num >= 1_000
          ? `$${(num / 1_000).toFixed(1)}K`
          : `$${raw}`;

        setStats({ activeGroups, totalSavedUsdc, cyclesCompleted });
      })
      .catch(() => {}); // silently fail — landing page still works with placeholders
  }, []);

  return stats;
}

function Logo({ size = 36 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size,
      background: "var(--green)",
      borderRadius: size * 0.28,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 20 20" fill="none">
        <path d="M10 2L17 6V14L10 18L3 14V6L10 2Z" stroke="#E8970A" strokeWidth="1.5" fill="none"/>
        <path d="M10 7L14 9.5V14.5L10 17L6 14.5V9.5L10 7Z" fill="#E8970A" opacity="0.35"/>
      </svg>
    </div>
  );
}

export default function Landing() {
  const liveStats = useLiveStats();

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── Nav ── */}
      <nav style={{
        padding: "18px 40px", display: "flex",
        alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={34} />
          <span style={{ fontWeight: 800, fontSize: 18, color: "var(--ink)", letterSpacing: "-0.4px" }}>
            Ajora
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>Stellar Testnet</span>
          <Link href="/dashboard" style={{
            padding: "9px 22px",
            background: "var(--green)", color: "#fff",
            borderRadius: 8, fontWeight: 600, fontSize: 14, textDecoration: "none",
          }}>
            Open App →
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ maxWidth: 1060, margin: "0 auto", padding: "90px 40px 70px", textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(11,61,46,0.07)", border: "1px solid rgba(11,61,46,0.14)",
          borderRadius: 99, padding: "6px 16px", marginBottom: 40,
        }}>
          <div className="pulse-dot" />
          <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, letterSpacing: 0.3 }}>
            Live on Stellar Testnet
          </span>
        </div>

        <h1 style={{
          fontSize: "clamp(40px, 6.5vw, 76px)", fontWeight: 900,
          lineHeight: 1.08, letterSpacing: "-2.5px",
          color: "var(--ink)", marginBottom: 28,
        }}>
          Your savings circle,<br />
          <span style={{
            color: "var(--green)",
            borderBottom: "4px solid var(--amber)",
            paddingBottom: 2,
          }}>on the blockchain</span>
        </h1>

        <p style={{
          fontSize: 18, color: "var(--ink-soft)", lineHeight: 1.75,
          maxWidth: 520, margin: "0 auto 48px", fontWeight: 400,
        }}>
          Ajo, esusu, susu — the rotating savings tradition reimagined.
          Non-custodial, trustless, and ZK-powered so your credit history is yours alone.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/dashboard" style={{
            padding: "14px 40px",
            background: "var(--green)", color: "#fff",
            borderRadius: 10, fontWeight: 700, fontSize: 15,
            textDecoration: "none", letterSpacing: "-0.2px",
          }}>
            Start a group
          </Link>
          <Link href="/dashboard?tab=savings" style={{
            padding: "14px 40px",
            background: "transparent", color: "var(--ink)",
            border: "1.5px solid var(--border)",
            borderRadius: 10, fontWeight: 600, fontSize: 15, textDecoration: "none",
          }}>
            Target savings
          </Link>
        </div>
      </section>

      {/* ── Stats band ── */}
      <div style={{
        background: "var(--green)", padding: "32px 40px",
        display: "flex", justifyContent: "center",
        gap: "clamp(32px, 7vw, 96px)", flexWrap: "wrap",
      }}>
        {[
          {
            v: liveStats ? String(liveStats.activeGroups) : "—",
            l: "Active groups",
          },
          {
            v: liveStats ? liveStats.totalSavedUsdc : "—",
            l: "Total saved",
          },
          {
            v: liveStats ? liveStats.cyclesCompleted.toLocaleString() : "—",
            l: "Cycles completed",
          },
          {
            v: "0%",
            l: "Default rate",
          },
        ].map(s => (
          <div key={s.l} style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 28, fontWeight: 900, color: "var(--amber)", letterSpacing: "-1px",
              minWidth: 60,
            }}>
              {s.v}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4, fontWeight: 500 }}>
              {s.l}
            </div>
          </div>
        ))}
      </div>

      {/* ── Three modes ── */}
      <section style={{ maxWidth: 1060, margin: "0 auto", padding: "80px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, color: "var(--amber)", textTransform: "uppercase", marginBottom: 10 }}>
            What you can do
          </div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 42px)", fontWeight: 800, letterSpacing: "-1px", color: "var(--ink)" }}>
            Three modes of saving
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 18 }}>
          {[
            {
              num: "01", label: "Rotating Savings", sub: "Ajo · Esusu · Susu",
              desc: "Every member contributes each cycle. The full pot rotates to one member until everyone has received it.",
              accent: "var(--green)",
            },
            {
              num: "02", label: "Target Savings", sub: "Contribution mode",
              desc: "Save toward your own goal alongside others. Peer pressure, not payouts. Collect your full balance at maturity.",
              accent: "var(--amber-dim)",
            },
            {
              num: "03", label: "ZK Credit Proof", sub: "Privacy-preserving",
              desc: "Prove you completed N saving cycles to join a new group — without revealing your wallet or any personal info.",
              accent: "var(--ink)",
            },
          ].map(c => (
            <div key={c.num} style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 18, padding: "32px 28px", overflow: "hidden", position: "relative",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 4,
                background: c.accent,
              }} />
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "var(--ink-muted)", textTransform: "uppercase", marginBottom: 14 }}>
                {c.num} · {c.sub}
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", marginBottom: 14 }}>
                {c.label}
              </h3>
              <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.75 }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Passkey feature ── */}
      <section style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
        padding: "80px 40px",
      }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, color: "var(--amber)", textTransform: "uppercase", marginBottom: 12 }}>
              Non-custodial
            </div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 38px)", fontWeight: 800, letterSpacing: "-0.8px", lineHeight: 1.2, color: "var(--ink)", marginBottom: 18 }}>
              Your fingerprint<br />is your bank key
            </h2>
            <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.8, marginBottom: 28 }}>
              Ajora uses Stellar Passkey Kit — a WebAuthn-based wallet that lives on your device.
              No seed phrases, no browser extensions, no app installs.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                "Touch ID · Face ID · PIN",
                "Smart contract wallet on Stellar",
                "Your keys never leave your device",
              ].map(f => (
                <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{
                    width: 22, height: 22, background: "var(--green)", borderRadius: 99, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Mock auth card */}
          <div style={{
            background: "var(--green)", borderRadius: 22, padding: "36px 32px",
            display: "flex", flexDirection: "column", gap: 20,
          }}>
            <div style={{ textAlign: "center", paddingTop: 8 }}>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                Ajora
              </div>
              <div style={{
                width: 64, height: 64, borderRadius: 20, margin: "0 auto",
                background: "rgba(232,151,10,0.18)", border: "2px solid rgba(232,151,10,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
              }}>
                🔐
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12, padding: "14px 18px",
                display: "flex", alignItems: "center", gap: 14,
              }}>
                <span style={{ fontSize: 24 }}>☝️</span>
                <div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>Use biometrics</div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 }}>Touch ID or Face ID</div>
                </div>
              </div>
              <div style={{
                background: "var(--amber)", borderRadius: 12,
                padding: "14px 18px", textAlign: "center",
                fontWeight: 700, color: "var(--green)", fontSize: 14, letterSpacing: "-0.2px",
              }}>
                Create Wallet — No seed phrase
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <div className="pulse-dot" style={{ width: 6, height: 6 }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Stellar Passkey Kit</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "100px 40px", textAlign: "center" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 50px)", fontWeight: 900, letterSpacing: "-1.5px", color: "var(--ink)", marginBottom: 14 }}>
            Ready to save together?
          </h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 15, marginBottom: 36, lineHeight: 1.7 }}>
            Start a group in under 60 seconds. No bank account required.
          </p>
          <Link href="/dashboard" style={{
            padding: "15px 52px",
            background: "var(--amber)", color: "var(--green)",
            borderRadius: 10, fontWeight: 800, fontSize: 16, textDecoration: "none",
            display: "inline-block", letterSpacing: "-0.3px",
          }}>
            Launch Ajora
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: "1px solid var(--border)", padding: "24px 40px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={26} />
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>Ajora</span>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
          Stellar WA Build Weekend 2025 · Built with Noir ZK + Soroban
        </span>
      </footer>
    </div>
  );
}
