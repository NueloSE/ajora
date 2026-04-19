// ---------------------------------------------------------------------------
// AjoraLogo — A3 "Person Silhouettes" brand mark
// Three people arranged in a triangle, connected by dashed arcs,
// with the shared savings pool implied at the center.
//
// Usage:
//   <AjoraLogo size={34} />                    — amber container (sidebar / nav)
//   <AjoraLogo size={52} variant="green" />    — green container (sign-in / onboarding)
// ---------------------------------------------------------------------------

interface AjoraLogoProps {
  size?: number;
  variant?: "amber" | "green";
}

export default function AjoraLogo({ size = 34, variant = "amber" }: AjoraLogoProps) {
  const radius = size * 0.16;   // border-radius
  const iconSize = size * 0.72; // SVG fits inside container with padding

  const containerStyle: React.CSSProperties =
    variant === "green"
      ? {
          width: size, height: size,
          background: "var(--green)",
          borderRadius: radius,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }
      : {
          width: size, height: size,
          background: "rgba(232,151,10,0.18)",
          border: "1.5px solid rgba(232,151,10,0.35)",
          borderRadius: radius,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        };

  return (
    <div style={containerStyle}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Person 1 — top, primary payout recipient, full brightness */}
        <circle cx="24" cy="10.5" r="3.5" fill="#E8970A" />
        <path d="M19.5 18.5 Q24 15 28.5 18.5 L29.5 24 H18.5 Z" fill="#E8970A" />

        {/* Person 2 — bottom-right, medium brightness */}
        <circle cx="35" cy="28.5" r="3.5" fill="#E8970A" opacity="0.55" />
        <path d="M30.5 36.5 Q35 33 39.5 36.5 L40.5 42 H29.5 Z" fill="#E8970A" opacity="0.55" />

        {/* Person 3 — bottom-left, waiting their turn */}
        <circle cx="13" cy="28.5" r="3.5" fill="#E8970A" opacity="0.3" />
        <path d="M8.5 36.5 Q13 33 17.5 36.5 L18.5 42 H7.5 Z" fill="#E8970A" opacity="0.3" />

        {/* Connecting arcs — the trust network */}
        <path d="M22.5 14 Q28 21 32 25.5" stroke="#E8970A" strokeWidth="1" fill="none" strokeDasharray="2.5 2" opacity="0.35" />
        <path d="M25.5 14 Q20 21 16 25.5" stroke="#E8970A" strokeWidth="1" fill="none" strokeDasharray="2.5 2" opacity="0.35" />
      </svg>
    </div>
  );
}
