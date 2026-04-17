"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to an error reporting service in production
    console.error(error);
  }, [error]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>

        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 99, margin: "0 auto 24px",
          background: "rgba(220,38,38,0.08)",
          border: "2px solid rgba(220,38,38,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 9v4M12 17h.01" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Heading */}
        <h1 style={{
          fontSize: 20, fontWeight: 800, color: "var(--ink)",
          letterSpacing: "-0.4px", marginBottom: 10,
        }}>
          Something went wrong
        </h1>
        <p style={{
          fontSize: 13, color: "var(--ink-muted)", lineHeight: 1.6, marginBottom: 28,
        }}>
          An unexpected error occurred. Your wallet and funds are safe — this is a display error only.
        </p>

        {/* Error detail (digest only, no raw message in prod) */}
        {error.digest && (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px 14px", marginBottom: 24,
            fontSize: 11, fontFamily: "monospace", color: "var(--ink-muted)",
          }}>
            Error ID: {error.digest}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              padding: "11px 24px",
              background: "var(--green)", color: "#fff",
              border: "none", borderRadius: 10,
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link href="/dashboard" style={{
            padding: "11px 24px",
            background: "none",
            border: "1.5px solid var(--border)",
            borderRadius: 10, fontWeight: 600, fontSize: 14,
            color: "var(--ink-soft)", textDecoration: "none",
            display: "inline-flex", alignItems: "center",
          }}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
