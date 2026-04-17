"use client";

// This page is intentionally NOT behind the dashboard auth gate.
// Phone B opens it via a link from Phone A. It has no existing session.

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

function truncate(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ActivateContent() {
  const params = useSearchParams();
  const router = useRouter();

  const wallet = params.get("wallet") ?? "";
  const kid    = params.get("kid")    ?? "";

  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [error,  setError]  = useState("");

  const isInvalidLink = !wallet || !kid;

  function handleActivate() {
    if (!wallet || !kid) return;

    try {
      // Store a minimal session so this device knows which wallet to control
      // and which passkey credential ID to use when signing transactions.
      // The user's name/phone will be filled in on first sign-in if needed.
      const existing = localStorage.getItem("ajora_session");
      let phone = "";
      let name  = "";
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          phone = parsed.phone ?? "";
          name  = parsed.name  ?? "";
        } catch { /* ignore */ }
      }

      const session = {
        phone,
        name,
        contractId:  wallet,
        keyIdBase64: kid,
        signedOut:   false,
      };
      localStorage.setItem("ajora_session", JSON.stringify(session));
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate. Please try again.");
      setStatus("error");
    }
  }

  if (isInvalidLink || status === "error") {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>⚠</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
          Invalid link
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24 }}>
          {error || "This link is missing required information."}
        </div>
        <Link href="/" style={{
          fontSize: 13, color: "var(--green)", fontWeight: 600, textDecoration: "none",
        }}>
          Go to Ajora →
        </Link>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 52, height: 52, borderRadius: 99, margin: "0 auto 20px",
          background: "rgba(11,61,46,0.1)", border: "2px solid var(--green)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M4 11L9 16L18 6" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>
          This device is activated!
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          Your wallet ({truncate(wallet)}) is now accessible from this device.
          Your backup passkey is used to sign transactions — your biometrics are your key.
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            padding: "13px 32px",
            background: "var(--green)", color: "#fff",
            border: "none", borderRadius: 12,
            fontWeight: 700, fontSize: 15, cursor: "pointer",
          }}
        >
          Open my wallet →
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Wallet info */}
      <div style={{
        background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "14px 16px", marginBottom: 24,
      }}>
        <div style={{ fontSize: 11, color: "var(--ink-muted)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>
          Wallet to activate
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--ink)", wordBreak: "break-all" }}>
          {wallet || "—"}
        </div>
      </div>

      <div style={{
        background: "rgba(11,61,46,0.06)", border: "1px solid rgba(11,61,46,0.15)",
        borderRadius: 10, padding: "12px 16px", marginBottom: 24,
        fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6,
      }}>
        Tapping the button below stores your wallet ID and backup key on this device.
        The first time you sign a transaction, your biometrics will confirm the backup passkey is here.
      </div>

      <button
        onClick={handleActivate}
        disabled={!wallet || !kid}
        style={{
          width: "100%", padding: "14px",
          background: !wallet || !kid ? "var(--border)" : "var(--green)",
          color: !wallet || !kid ? "var(--ink-muted)" : "#fff",
          border: "none", borderRadius: 12,
          fontWeight: 700, fontSize: 15,
          cursor: !wallet || !kid ? "default" : "pointer",
        }}
      >
        Activate this device →
      </button>
    </>
  );
}

export default function BackupActivatePage() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, margin: "0 auto 14px",
            background: "var(--green)", borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L17 6V14L10 18L3 14V6L10 2Z" stroke="#E8970A" strokeWidth="1.5" fill="none"/>
              <path d="M10 7L14 9.5V14.5L10 17L6 14.5V9.5L10 7Z" fill="#E8970A" opacity="0.5"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", marginBottom: 6 }}>
            Activate Ajora on this device
          </h1>
          <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            Your primary device has added you as a backup signer.
          </p>
        </div>

        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 20, padding: "28px 24px",
        }} className="animate-slide-up">
          <Suspense fallback={<div style={{ textAlign: "center", color: "var(--ink-muted)", fontSize: 13 }}>Loading…</div>}>
            <ActivateContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
