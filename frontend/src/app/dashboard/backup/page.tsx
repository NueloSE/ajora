"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { addBackupDevice } from "@/lib/passkey";

const STELLAR_EXPLORER = "https://stellar.expert/explorer/testnet/tx";

export default function BackupPage() {
  const { address, name, keyId } = useWallet();

  const [step,    setStep]    = useState<"idle" | "registering" | "signing" | "done" | "error">("idle");
  const [msg,     setMsg]     = useState("");
  const [txHash,  setTxHash]  = useState<string | null>(null);
  const [newKid,  setNewKid]  = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const activationLink = address && newKid
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/backup/activate?wallet=${address}&kid=${encodeURIComponent(newKid)}`
    : null;

  async function handleAddBackup() {
    if (!address || !keyId) return;
    setStep("registering");
    setMsg("Step 1 of 2 — Register the backup passkey\nYour browser will open a passkey dialog. Choose \"Use another device\" to register your backup phone.");
    try {
      setMsg("Step 1 of 2 — Waiting for passkey registration…\nChoose \"Use another device\" in the browser dialog to register your backup phone.");
      // addBackupDevice internally does:
      // 1. createKey() → browser dialog (cross-device QR or local)
      // 2. add_signer tx → first biometric = NEW key registration, second = EXISTING key auth
      setStep("signing");
      setMsg("Step 2 of 2 — Authorize on-chain\nYour current passkey will now sign the transaction to add the new device. Follow the biometric prompt.");
      const { newKeyIdBase64, txHash: hash } = await addBackupDevice(
        address,
        keyId,
        name || "User",
      );
      setNewKid(newKeyIdBase64);
      setTxHash(hash);
      setStep("done");
      // Generate QR code for the activation link
      const link = `${window.location.origin}/backup/activate?wallet=${address}&kid=${encodeURIComponent(newKeyIdBase64)}`;
      import("qrcode").then(QRCode => {
        QRCode.toDataURL(link, { width: 220, margin: 2, color: { dark: "#0b3d2e", light: "#ffffff" } })
          .then(url => setQrDataUrl(url))
          .catch(() => {/* QR optional, silently ignore */});
      }).catch(() => {/* package missing, ignore */});
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  function handleCopyLink() {
    if (!activationLink) return;
    navigator.clipboard.writeText(activationLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div className="page-pad animate-fade-in">
      <div style={{ maxWidth: 560 }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.5px", margin: 0 }}>
            Backup Device
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-muted)", marginTop: 6, marginBottom: 0 }}>
            Add a second device so you can access your wallet if you lose your phone.
          </p>
        </div>

        {/* How it works explainer */}
        {step === "idle" && (
          <>
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "24px 26px", marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 14 }}>
                How it works
              </div>
              {[
                {
                  n: "1",
                  title: "Register a new passkey",
                  desc: "Your browser opens a passkey dialog. Tap \"Use another device\" and scan the QR code with your backup phone. That phone's Secure Enclave creates a new private key.",
                },
                {
                  n: "2",
                  title: "Authorize on-chain",
                  desc: "Your current phone signs a transaction that adds the new passkey as an authorized signer on your Stellar Smart Wallet. Both phones can now sign transactions independently.",
                },
                {
                  n: "3",
                  title: "Activate on backup phone",
                  desc: "A link is generated. Open it on your backup phone — it stores your wallet address and backup key ID so that phone knows which wallet to control.",
                },
              ].map(s => (
                <div key={s.n} style={{ display: "flex", gap: 14, marginBottom: s.n === "3" ? 0 : 16 }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 99, flexShrink: 0,
                    background: "var(--green)", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800,
                  }}>{s.n}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 3 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-muted)", lineHeight: 1.6 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              background: "rgba(232,151,10,0.07)", border: "1px solid rgba(232,151,10,0.2)",
              borderRadius: 12, padding: "14px 18px", marginBottom: 24,
              fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6,
            }}>
              Have both devices nearby before you start. The cross-device QR code requires Bluetooth
              to be enabled on both phones and works best when they&apos;re within a meter of each other.
            </div>

            <button
              onClick={handleAddBackup}
              disabled={!address || !keyId}
              style={{
                padding: "13px 32px",
                background: !address || !keyId ? "var(--border)" : "var(--green)",
                color: !address || !keyId ? "var(--ink-muted)" : "#fff",
                border: "none", borderRadius: 12,
                fontWeight: 700, fontSize: 15,
                cursor: !address || !keyId ? "default" : "pointer",
              }}
            >
              Add Backup Device →
            </button>
          </>
        )}

        {/* In-progress state */}
        {(step === "registering" || step === "signing") && (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 16, padding: "32px 28px", textAlign: "center",
          }}>
            <div className="pulse-dot" style={{ margin: "0 auto 20px", width: 12, height: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 10 }}>
              {step === "registering" ? "Registering backup passkey…" : "Authorizing on-chain…"}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.7, whiteSpace: "pre-line" }}>
              {msg}
            </div>
          </div>
        )}

        {/* Error state */}
        {step === "error" && (
          <div>
            <div style={{
              background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)",
              borderRadius: 12, padding: "16px 18px", marginBottom: 20,
              fontSize: 13, color: "#dc2626", lineHeight: 1.6,
            }}>
              {msg}
            </div>
            <button
              onClick={() => { setStep("idle"); setMsg(""); }}
              style={{
                padding: "11px 24px",
                background: "none", border: "1.5px solid var(--border)",
                borderRadius: 10, fontWeight: 600, fontSize: 13,
                color: "var(--ink-soft)", cursor: "pointer",
              }}
            >
              ← Try again
            </button>
          </div>
        )}

        {/* Success state */}
        {step === "done" && activationLink && (
          <div>
            {/* Success banner */}
            <div style={{
              background: "rgba(11,61,46,0.07)", border: "1px solid rgba(11,61,46,0.2)",
              borderRadius: 16, padding: "20px 22px", marginBottom: 24,
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 99, flexShrink: 0,
                background: "rgba(11,61,46,0.12)", border: "2px solid var(--green)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 9L7.5 13.5L15 5" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--green)", marginBottom: 2 }}>
                  Backup passkey added to your wallet
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                  Now send the activation link to your backup phone.
                </div>
              </div>
            </div>

            {/* QR Code */}
            {qrDataUrl && (
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: "var(--ink-soft)",
                  marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5,
                }}>
                  Scan with your backup phone
                </div>
                <div style={{
                  display: "inline-block",
                  padding: 12,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="Activation QR code" width={220} height={220} style={{ display: "block" }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 8 }}>
                  Opens the activation page automatically
                </div>
              </div>
            )}

            {/* Transaction link */}
            {txHash && (
              <div style={{ marginBottom: 20 }}>
                <a href={`${STELLAR_EXPLORER}/${txHash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                  View add_signer transaction on Explorer →
                </a>
              </div>
            )}

            {/* Activation link */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "20px 22px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Activation link — send this to your backup phone
              </div>
              <div style={{
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "10px 12px", marginBottom: 12,
                fontSize: 11, fontFamily: "monospace", color: "var(--ink-soft)",
                wordBreak: "break-all", lineHeight: 1.6,
              }}>
                {activationLink}
              </div>
              <button
                onClick={handleCopyLink}
                style={{
                  padding: "10px 20px",
                  background: copied ? "rgba(11,61,46,0.08)" : "var(--green)",
                  color: copied ? "var(--green)" : "#fff",
                  border: copied ? "1px solid var(--green)" : "none",
                  borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {copied ? "Copied!" : "Copy activation link"}
              </button>
            </div>

            <div style={{
              background: "rgba(232,151,10,0.07)", border: "1px solid rgba(232,151,10,0.2)",
              borderRadius: 10, padding: "12px 16px",
              fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6,
            }}>
              Send this link to your backup phone via AirDrop, WhatsApp, or email.
              The backup phone opens the link, taps &quot;Activate&quot;, and is ready to use Ajora.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
