"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { getCredential } from "@/lib/passkey";

type Step = "phone" | "biometric" | "done";
type Mode = "signup" | "signin";

function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

const SYNC_INSTRUCTIONS: Record<"ios" | "android" | "desktop", { title: string; steps: string[]; note: string }> = {
  ios: {
    title: "Enable iCloud Keychain sync",
    steps: [
      "Open Settings → tap your name at the top",
      "Tap iCloud → Passwords & Keychain",
      "Make sure \"Sync this iPhone\" is turned ON",
    ],
    note: "Your passkey will sync to all your Apple devices signed into the same Apple ID. If you lose this phone, sign in on a new iPhone with the same Apple ID and your Ajora wallet will be there.",
  },
  android: {
    title: "Enable Google Password Manager sync",
    steps: [
      "Open Settings → Google → Autofill",
      "Or open Chrome → Settings → Passwords",
      "Make sure passkey sync is enabled",
    ],
    note: "Your passkey will sync to all your Android devices signed into the same Google account. Signing in on a new device just requires your Google account.",
  },
  desktop: {
    title: "Sync passkeys across your devices",
    steps: [
      "On Mac: System Settings → Apple ID → iCloud → Passwords",
      "On Windows: Settings → Accounts → Windows Hello",
      "Or use a password manager that supports passkeys (1Password, Bitwarden)",
    ],
    note: "Desktop passkeys may be device-bound unless you use iCloud Keychain or a supported password manager. We recommend adding your phone as a backup device.",
  },
};

const inputStyle = (hasError: boolean) => ({
  width: "100%", padding: "13px 14px 13px 42px",
  border: `1.5px solid ${hasError ? "#dc2626" : "var(--border)"}`,
  borderRadius: 12, fontSize: 15,
  color: "var(--ink)", background: "var(--bg)", outline: "none",
  boxSizing: "border-box" as const,
});

const labelStyle = {
  fontSize: 12, fontWeight: 700, color: "var(--ink-soft)",
  letterSpacing: 0.5, textTransform: "uppercase" as const,
  display: "block", marginBottom: 8,
};

export default function SignInPage() {
  const router = useRouter();
  const { signUp, signIn, connected, loading: authLoading } = useWallet();

  const [step,         setStep]         = useState<Step>("phone");
  const [mode,         setMode]         = useState<Mode>("signup");
  const [phone,        setPhone]        = useState("");
  const [name,         setName]         = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [statusMsg,    setStatusMsg]    = useState("");
  const [showSyncTip,  setShowSyncTip]  = useState(false);
  const [platform,     setPlatform]     = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    if (!authLoading && connected) router.replace("/dashboard");
  }, [authLoading, connected, router]);

  // If a credential exists on this device (even after sign-out), default to sign-in
  useEffect(() => {
    const cred = getCredential();
    if (cred) {
      setMode("signin");
      setPhone(cred.phone);
      setName(cred.name ?? "");
    }
  }, []);

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) { setError("Enter a valid phone number"); return; }
    if (mode === "signup" && !name.trim()) { setError("Enter your name to continue"); return; }
    setError("");
    setStep("biometric");
  }

  async function handleBiometric() {
    setLoading(true);
    setError("");
    setStatusMsg(mode === "signup" ? "Setting up your wallet on Stellar…" : "Verifying your identity…");
    try {
      if (mode === "signup") {
        await signUp(phone, name.trim());
      } else {
        await signIn(phone);
      }
      setStep("done");
      setStatusMsg("Done! Redirecting…");
      if (mode === "signup") {
        // Show platform-specific sync education before redirect
        setPlatform(detectPlatform());
        setShowSyncTip(true);
        return; // redirect happens when user dismisses the modal
      }
      await new Promise(r => setTimeout(r, 800));
      router.push("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoading(false);
      setStep("phone");
      if (msg.includes("No account found on this device")) {
        setMode("signup");
        setError("No account found on this device. Create one using the button above.");
      } else if (msg.includes("NotAllowedError") || msg.toLowerCase().includes("cancel")) {
        setError("Verification was cancelled. Please try again.");
      } else {
        setError(msg);
      }
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 52, height: 52, margin: "0 auto 16px",
            background: "var(--green)", borderRadius: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="34" height="34" viewBox="0 0 48 48" fill="none">
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
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", marginBottom: 6 }}>
            Welcome to Ajora
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>
            Your savings group, fully protected on Stellar
          </p>
        </div>

        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 20, padding: "32px 28px",
        }} className="animate-slide-up">

          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit}>

              {/* Mode toggle */}
              <div style={{
                display: "flex", background: "var(--bg)",
                borderRadius: 10, padding: 4, marginBottom: 28, gap: 4,
              }}>
                {(["signup", "signin"] as Mode[]).map(m => (
                  <button key={m} type="button"
                    onClick={() => { setMode(m); setError(""); }}
                    style={{
                      flex: 1, padding: "9px",
                      background: mode === m ? "var(--green)" : "transparent",
                      color: mode === m ? "#fff" : "var(--ink-soft)",
                      border: "none", borderRadius: 8,
                      fontWeight: 600, fontSize: 13, cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {m === "signup" ? "Create account" : "Sign in"}
                  </button>
                ))}
              </div>

              {/* Name — only on signup */}
              {mode === "signup" && (
                <div style={{ marginBottom: 18 }}>
                  <label style={labelStyle}>Your name</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", color: "var(--ink-muted)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <input
                      type="text"
                      placeholder="Martin Machiebe"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      autoFocus
                      style={inputStyle(false)}
                    />
                  </div>
                </div>
              )}

              {/* Phone */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Phone number</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", color: "var(--ink-muted)" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <circle cx="12" cy="18.5" r="1" fill="currentColor"/>
                      <line x1="10" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <input
                    type="tel"
                    placeholder="+234 801 234 5678"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    autoFocus={mode === "signin"}
                    style={inputStyle(!!error)}
                  />
                </div>
                {error && (
                  <p style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>{error}</p>
                )}
              </div>

              <button type="submit" style={{
                width: "100%", padding: "14px",
                background: "var(--green)", color: "#fff",
                border: "none", borderRadius: 12,
                fontWeight: 700, fontSize: 15, cursor: "pointer",
              }}>
                Continue →
              </button>

              <p style={{ textAlign: "center", fontSize: 12, color: "var(--ink-muted)", marginTop: 16, lineHeight: 1.6 }}>
                {mode === "signup"
                  ? "Your wallet is secured by your device — no seed phrase, nothing stored on our servers."
                  : "Your identity is confirmed by your device biometrics."}
              </p>
            </form>
          )}

          {(step === "biometric" || step === "done") && (
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 72, height: 72, margin: "0 auto 20px",
                background: loading ? "rgba(11,61,46,0.06)" : "rgba(11,61,46,0.1)",
                border: `2px solid ${step === "done" ? "var(--green)" : "rgba(11,61,46,0.3)"}`,
                borderRadius: 99,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: step === "done" ? 0 : 32,
                transition: "all 0.3s",
              }}>
                {step === "done" ? (
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <path d="M6 14L11 19L22 8" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : loading ? (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="var(--green)" strokeWidth="2" opacity="0.2"/>
                    <path d="M12 3a9 9 0 019 9" stroke="var(--green)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="var(--green)" strokeWidth="1.8"/>
                    <path d="M8 11V7a4 4 0 018 0v4" stroke="var(--green)" strokeWidth="1.8" strokeLinecap="round"/>
                    <circle cx="12" cy="16" r="1.5" fill="var(--green)"/>
                  </svg>
                )}
              </div>

              <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px", marginBottom: 8 }}>
                {step === "done" ? `Welcome${name ? `, ${name.split(" ")[0]}` : ""}!`
                  : loading
                    ? (mode === "signup" ? "Setting up your wallet…" : "Verifying…")
                    : (mode === "signup" ? "Confirm your identity" : "Authenticate")}
              </h2>

              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24, lineHeight: 1.6 }}>
                {step === "done"
                  ? "Your Stellar wallet is ready. Redirecting to your dashboard…"
                  : loading
                    ? statusMsg
                    : mode === "signup"
                      ? "Your device will prompt you for biometrics (Touch ID, Face ID). Your private key never leaves your device."
                      : "Use the same biometrics you registered with to confirm your identity."}
              </p>

              {!loading && step !== "done" && (
                <>
                  <button onClick={handleBiometric} style={{
                    width: "100%", padding: "14px",
                    background: "var(--green)", color: "#fff",
                    border: "none", borderRadius: 12,
                    fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 12,
                  }}>
                    {mode === "signup" ? "Create wallet" : "Verify identity"}
                  </button>
                  <button onClick={() => { setStep("phone"); setError(""); }} style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 12, color: "var(--ink-muted)", marginTop: 4,
                    display: "block", width: "100%",
                  }}>
                    ← Go back
                  </button>
                </>
              )}

              {loading && (
                <div className="progress-bar" style={{ maxWidth: 240, margin: "0 auto" }}>
                  <div className="progress-bar-fill" style={{ width: "75%" }} />
                </div>
              )}
            </div>
          )}
        </div>

      {/* ── Platform sync education modal — shown once after first registration ── */}
      {showSyncTip && (() => {
        const info = SYNC_INSTRUCTIONS[platform];
        return (
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(11,22,18,0.6)", backdropFilter: "blur(4px)",
            zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}>
            <div style={{
              background: "var(--surface)", borderRadius: 20, padding: "32px 28px",
              width: "100%", maxWidth: 420,
            }} className="animate-slide-up">
              {/* Header */}
              <div style={{
                width: 44, height: 44, borderRadius: 12, margin: "0 auto 16px",
                background: "rgba(11,61,46,0.1)", border: "2px solid rgba(11,61,46,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 1L12.5 7H19L13.5 11L16 17L10 13L4 17L6.5 11L1 7H7.5L10 1Z" stroke="var(--green)" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.3px", marginBottom: 6 }}>
                  One last step — back up your wallet
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.5 }}>
                  Your passkey lives on this device. Enable sync so you don&apos;t lose access if you lose your phone.
                </div>
              </div>

              {/* Platform instructions */}
              <div style={{
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "16px 18px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {info.title}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {info.steps.map((s, i) => (
                    <li key={i} style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7 }}>{s}</li>
                  ))}
                </ol>
              </div>

              <div style={{
                background: "rgba(232,151,10,0.07)", border: "1px solid rgba(232,151,10,0.2)",
                borderRadius: 10, padding: "10px 14px", marginBottom: 20,
                fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6,
              }}>
                {info.note}
              </div>

              <button
                onClick={() => { setShowSyncTip(false); router.push("/dashboard"); }}
                style={{
                  width: "100%", padding: "13px",
                  background: "var(--green)", color: "#fff",
                  border: "none", borderRadius: 12,
                  fontWeight: 700, fontSize: 15, cursor: "pointer",
                }}
              >
                Got it, take me to my wallet →
              </button>
              <button
                onClick={() => { setShowSyncTip(false); router.push("/dashboard"); }}
                style={{
                  width: "100%", padding: "8px",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: "var(--ink-muted)", marginTop: 6,
                }}
              >
                Skip for now
              </button>
            </div>
          </div>
        );
      })()}

        {/* Trust badges */}
        {step === "phone" && (
          <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 28, flexWrap: "wrap" }}>
            {[
              { icon: (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              ), label: "No seed phrase" },
              { icon: (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3L4 7v5c0 4.55 3.4 8.81 8 9.93C16.6 20.81 20 16.55 20 12V7L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ), label: "Not stored on servers" },
              { icon: (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="1.8"/>
                  <path d="M12 12h9M17 12v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              ), label: "Your device, your key" },
            ].map(b => (
              <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "flex", color: "var(--ink-muted)" }}>{b.icon}</span>
                <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
