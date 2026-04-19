"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { useWallet } from "@/context/WalletContext";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { connected, loading } = useWallet();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !connected) {
      router.replace("/signin");
    }
  }, [loading, connected, router]);

  // Show nothing while checking auth state to avoid flash
  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "var(--bg)",
      }}>
        <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</div>
      </div>
    );
  }

  if (!connected) return null;

  return (
    <div className="dashboard-root">
      {/* Backdrop overlay — tapping it closes the mobile sidebar */}
      <div
        className={`sidebar-overlay${mobileOpen ? " sidebar-overlay-open" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <main style={{ flex: 1, background: "var(--bg)", overflow: "auto", minWidth: 0 }}>
        {/* Mobile top bar — hidden on desktop via CSS */}
        <div className="mobile-topbar">
          {/* Brand mark */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28,
              background: "rgba(232,151,10,0.18)",
              border: "1.5px solid rgba(232,151,10,0.35)",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
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
            <span style={{ fontWeight: 800, fontSize: 16, color: "#fff", letterSpacing: "-0.4px" }}>
              Ajora
            </span>
          </div>

          {/* Hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8,
              width: 38, height: 38,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {children}
      </main>
    </div>
  );
}
