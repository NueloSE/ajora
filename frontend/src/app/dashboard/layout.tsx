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
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L17 6V14L10 18L3 14V6L10 2Z" stroke="#E8970A" strokeWidth="1.5" fill="none"/>
                <path d="M10 7L14 9.5V14.5L10 17L6 14.5V9.5L10 7Z" fill="#E8970A" opacity="0.35"/>
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
