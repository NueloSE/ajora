"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { fetchUsdcBalance, stroopsToUsdc } from "@/lib/soroban";
import { transferUsdc } from "@/lib/contracts";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )},
  { href: "/dashboard/groups", label: "Rotating Savings", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M4 12a8 8 0 018-8 8 8 0 016 2.67" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M20 12a8 8 0 01-8 8 8 8 0 01-6-2.67" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M18 6.5V3.5h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 17.5v3h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/dashboard/savings", label: "Target Savings", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
    </svg>
  )},
  { href: "/dashboard/proof", label: "ZK Credit Proof", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L4 7v5c0 4.55 3.4 8.81 8 9.93C16.6 20.81 20 16.55 20 12V7L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )},
  { href: "/dashboard/backup", label: "Backup Device", icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="1.8"/>
      <circle cx="12" cy="18.5" r="1" fill="currentColor"/>
      <line x1="10" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )},
];

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";

function truncate(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function isValidStellarAddress(addr: string) {
  return /^[CG][A-Z2-7]{55}$/.test(addr.trim());
}

export default function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const path   = usePathname();
  const router = useRouter();
  const { name, displayName, address, phone, connected, signOut } = useWallet();

  const [copied,       setCopied]       = useState(false);
  const [balance,      setBalance]      = useState<string | null>(null);
  const [loadingBal,   setLoadingBal]   = useState(false);

  // Transfer modal state
  const [showSend,    setShowSend]    = useState(false);
  const [toAddress,   setToAddress]   = useState("");
  const [amount,      setAmount]      = useState("");
  const [sending,     setSending]     = useState(false);
  const [sendTxHash,  setSendTxHash]  = useState<string | null>(null);
  const [sendError,   setSendError]   = useState<string | null>(null);

  // Fetch balance whenever the connected address changes
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    setLoadingBal(true);
    fetchUsdcBalance(address)
      .then(b => setBalance(stroopsToUsdc(b)))
      .catch(() => setBalance(null))
      .finally(() => setLoadingBal(false));
  }, [address]);

  function handleSignOut() {
    signOut();
    router.push("/signin");
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function openSend() {
    setToAddress("");
    setAmount("");
    setSendTxHash(null);
    setSendError(null);
    setShowSend(true);
  }

  async function handleSend() {
    if (!address) return;
    const dest = toAddress.trim();
    const amt  = parseFloat(amount);

    if (!isValidStellarAddress(dest)) {
      setSendError("Invalid Stellar address. Must start with C or G and be 56 characters.");
      return;
    }
    if (!amt || amt <= 0) {
      setSendError("Enter a valid amount greater than 0.");
      return;
    }
    if (dest === address) {
      setSendError("Cannot send to your own wallet.");
      return;
    }

    setSending(true);
    setSendError(null);
    setSendTxHash(null);

    try {
      const hash = await transferUsdc(address, dest, amt);
      setSendTxHash(hash);
      // Refresh balance after transfer
      fetchUsdcBalance(address)
        .then(b => setBalance(stroopsToUsdc(b)))
        .catch(() => {});
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <aside
        className={`sidebar-root${mobileOpen ? " sidebar-open" : ""}`}
        style={{
          background: "var(--green)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Brand */}
        <div style={{ padding: "24px 24px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <div style={{
                width: 34, height: 34,
                background: "rgba(232,151,10,0.18)",
                border: "1.5px solid rgba(232,151,10,0.35)",
                borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="22" height="22" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="10.5" r="3.5" fill="#E8970A" />
                  <path d="M19.5 18.5 Q24 15 28.5 18.5 L29.5 24 H18.5 Z" fill="#E8970A" />
                  <circle cx="35" cy="28.5" r="3.5" fill="#E8970A" opacity="0.55" />
                  <path d="M30.5 36.5 Q35 33 39.5 36.5 L40.5 42 H29.5 Z" fill="#E8970A" opacity="0.55" />
                  <circle cx="13" cy="28.5" r="3.5" fill="#E8970A" opacity="0.3" />
                  <path d="M8.5 36.5 Q13 33 17.5 36.5 L18.5 42 H7.5 Z" fill="#E8970A" opacity="0.3" />
                  <path d="M22.5 14 Q28 21 32 25.5" stroke="#E8970A" strokeWidth="1" fill="none" strokeDasharray="2.5 2" opacity="0.35" />
                  <path d="M25.5 14 Q20 21 16 25.5" stroke="#E8970A" strokeWidth="1" fill="none" strokeDasharray="2.5 2" opacity="0.35" />
                </svg>
              </div>
              <span style={{ fontWeight: 800, fontSize: 17, color: "#fff", letterSpacing: "-0.4px" }}>Ajora</span>
            </Link>
            {/* Close button — only visible on mobile via CSS */}
            <button className="sidebar-close-btn" onClick={onMobileClose} aria-label="Close menu">
              ×
            </button>
          </div>
        </div>

        {/* User identity */}
        <div style={{ padding: "16px 16px 0" }}>
          {connected && address ? (
            <div style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10, padding: "12px 14px",
            }}>
              {/* Avatar + name */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 99,
                  background: "rgba(232,151,10,0.25)",
                  border: "1.5px solid rgba(232,151,10,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                }}>
                  {name
                    ? name.charAt(0).toUpperCase()
                    : phone
                      ? phone.replace(/\D/g, "").charAt(0) || "?"
                      : "?"}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, lineHeight: 1.2 }}>
                    {name || displayName}
                  </div>
                  {name && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>
                      {displayName}
                    </div>
                  )}
                </div>
              </div>

              {/* Smart Wallet address — copy + open in explorer */}
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <div
                  onClick={handleCopy}
                  title={copied ? "Copied!" : "Click to copy smart wallet address"}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", gap: 5,
                    background: "rgba(0,0,0,0.15)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 6, padding: "5px 8px",
                    cursor: "pointer", transition: "background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>
                    Wallet
                  </span>
                  <span style={{
                    fontSize: 11, color: copied ? "var(--amber)" : "rgba(255,255,255,0.6)",
                    fontFamily: "monospace", flex: 1, transition: "color 0.2s",
                  }}>
                    {copied ? "Copied!" : truncate(address)}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.4, flexShrink: 0 }}>
                    <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="white" strokeWidth="1.2"/>
                    <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="white" strokeWidth="1.2"/>
                  </svg>
                </div>
                <a
                  href={`https://stellar.expert/explorer/testnet/contract/${address}`}
                  target="_blank" rel="noopener noreferrer"
                  title="View on Stellar Expert"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 28, background: "rgba(0,0,0,0.15)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 6, flexShrink: 0, textDecoration: "none",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.45 }}>
                    <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M8 1h3m0 0v3m0-3L5.5 6.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </a>
              </div>

              {/* USDC Balance */}
              <div style={{
                background: "rgba(0,0,0,0.15)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 6, padding: "7px 8px",
                marginBottom: 8,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                    USDC Balance
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>
                    {loadingBal ? "…" : balance !== null ? `${balance}` : "—"}
                    <span style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>USDC</span>
                  </div>
                </div>
                <button
                  onClick={openSend}
                  title="Send USDC"
                  style={{
                    padding: "6px 12px",
                    background: "rgba(232,151,10,0.2)",
                    border: "1px solid rgba(232,151,10,0.35)",
                    borderRadius: 6, cursor: "pointer",
                    fontSize: 11, fontWeight: 700, color: "var(--amber)",
                  }}
                >
                  Send →
                </button>
              </div>

              {/* Status + sign out */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div className="pulse-dot" style={{ width: 6, height: 6 }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Testnet</span>
                </div>
                <button onClick={handleSignOut} style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 6, cursor: "pointer",
                  fontSize: 11, fontWeight: 600,
                  color: "rgba(255,255,255,0.7)",
                  padding: "4px 10px",
                  transition: "all 0.15s",
                }}>
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <Link href="/signin" style={{
              display: "block",
              background: "rgba(232,151,10,0.12)",
              border: "1px solid rgba(232,151,10,0.3)",
              borderRadius: 10, padding: "12px 14px",
              textDecoration: "none",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)", marginBottom: 3 }}>
                Sign in to start saving
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                Phone number · Biometrics
              </div>
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "20px 12px" }}>
          {NAV.map(({ href, label, icon }) => {
            const active = href === "/dashboard" ? path === href : path.startsWith(href);
            return (
              <Link key={href} href={href} onClick={onMobileClose} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 10, marginBottom: 2,
                textDecoration: "none",
                background: active ? "rgba(232,151,10,0.15)" : "transparent",
                border: active ? "1px solid rgba(232,151,10,0.25)" : "1px solid transparent",
                transition: "all 0.15s",
              }}>
                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, flexShrink: 0,
                  color: active ? "var(--amber)" : "rgba(255,255,255,0.45)",
                }}>
                  {icon}
                </span>
                <span style={{
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? "#fff" : "rgba(255,255,255,0.55)",
                  letterSpacing: "-0.1px",
                }}>
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom strip */}
        <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
            Stellar Testnet · Smart Wallet<br />
            Secured by Secure Enclave · No seed phrase
          </div>
        </div>
      </aside>

      {/* ── Send USDC modal ── */}
      {showSend && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(11,22,18,0.6)", backdropFilter: "blur(4px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--surface)", borderRadius: 20, padding: 36,
            width: "100%", maxWidth: 460,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px" }}>
                Send USDC
              </h2>
              <button
                onClick={() => setShowSend(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--ink-muted)", lineHeight: 1 }}
              >×</button>
            </div>

            {/* From address */}
            <div style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "12px 14px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>FROM</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink-soft)", wordBreak: "break-all" }}>
                {address}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                Balance: <span style={{ fontWeight: 700, color: "var(--ink)" }}>{balance ?? "—"} USDC</span>
              </div>
            </div>

            {!sendTxHash ? (
              <>
                {/* To address */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
                    Recipient address
                  </label>
                  <input
                    placeholder="C... or G... Stellar address"
                    value={toAddress}
                    onChange={e => { setToAddress(e.target.value); setSendError(null); }}
                    style={{
                      width: "100%", padding: "11px 14px",
                      border: `1.5px solid ${toAddress && !isValidStellarAddress(toAddress) ? "#dc2626" : "var(--border)"}`,
                      borderRadius: 10, fontSize: 13, fontFamily: "monospace",
                      color: "var(--ink)", background: "var(--bg)", outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  {toAddress && !isValidStellarAddress(toAddress) && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                      Must be a valid Stellar address (C... smart wallet or G... classic)
                    </div>
                  )}
                </div>

                {/* Amount */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
                    Amount (USDC)
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={e => { setAmount(e.target.value); setSendError(null); }}
                      style={{
                        width: "100%", padding: "11px 54px 11px 14px",
                        border: "1.5px solid var(--border)", borderRadius: 10,
                        fontSize: 15, fontWeight: 700,
                        color: "var(--ink)", background: "var(--bg)", outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                    <span style={{
                      position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                      fontSize: 12, fontWeight: 600, color: "var(--ink-muted)",
                    }}>USDC</span>
                  </div>
                  {balance && (
                    <button
                      onClick={() => setAmount(balance)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 11, color: "var(--green)", fontWeight: 600, padding: "4px 0",
                      }}>
                      Max: {balance} USDC
                    </button>
                  )}
                </div>

                {sendError && (
                  <div style={{
                    background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
                    borderRadius: 8, padding: "10px 14px", marginBottom: 16,
                    fontSize: 12, color: "#dc2626", lineHeight: 1.5,
                  }}>
                    {sendError}
                  </div>
                )}

                <div style={{
                  background: "rgba(232,151,10,0.07)", border: "1px solid rgba(232,151,10,0.2)",
                  borderRadius: 8, padding: "10px 14px", marginBottom: 20,
                  fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5,
                }}>
                  Your biometric (fingerprint / Face ID) will be required to authorise this transfer.
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setShowSend(false)}
                    style={{
                      flex: 1, padding: "12px",
                      background: "none", border: "1.5px solid var(--border)",
                      borderRadius: 10, fontWeight: 600, fontSize: 14,
                      color: "var(--ink-soft)", cursor: "pointer",
                    }}>
                    Cancel
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={sending || !toAddress || !amount}
                    style={{
                      flex: 2, padding: "12px",
                      background: sending || !toAddress || !amount ? "var(--border)" : "var(--green)",
                      color: sending || !toAddress || !amount ? "var(--ink-muted)" : "#fff",
                      border: "none", borderRadius: 10,
                      fontWeight: 700, fontSize: 14,
                      cursor: sending || !toAddress || !amount ? "default" : "pointer",
                    }}>
                    {sending ? "Waiting for biometric…" : "Send USDC →"}
                  </button>
                </div>
              </>
            ) : (
              /* Success state */
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 99, margin: "0 auto 16px",
                  background: "rgba(11,61,46,0.1)", border: "2px solid var(--green)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M4 11L9 16L18 6" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>
                  Transfer complete
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 20 }}>
                  {amount} USDC sent to {truncate(toAddress)}
                </div>
                <div style={{
                  background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: "12px 14px", marginBottom: 20, textAlign: "left",
                }}>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    TRANSACTION
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--ink-soft)", wordBreak: "break-all", marginBottom: 10 }}>
                    {sendTxHash}
                  </div>
                  <a
                    href={`${STELLAR_EXPLORER}/${sendTxHash}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 14px",
                      background: "var(--green)", color: "#fff",
                      borderRadius: 7, fontSize: 12, fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10L10 2M10 2H5M10 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    View on Explorer
                  </a>
                </div>
                <button
                  onClick={() => setShowSend(false)}
                  style={{
                    padding: "10px 28px",
                    background: "none", border: "1.5px solid var(--border)",
                    borderRadius: 8, fontWeight: 600, fontSize: 13,
                    color: "var(--ink-soft)", cursor: "pointer",
                  }}>
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
