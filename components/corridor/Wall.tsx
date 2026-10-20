import type { Slot } from "@/lib/agents/corridor";

/** One bay of hallway wall: wallpaper, chair rail, wainscoting, floorboards, runner rug and a brass sconce. 300 × 540. */

const PAPERS = [
  { ground: "#E9DCC0", motif: "var(--sand)", stripe: "#E2D2B2" },
  { ground: "#E6D2B4", motif: "#BFA07A", stripe: "#DCC6A4" },
  { ground: "#E4CDB0", motif: "var(--brass)", stripe: "#D9BE9C" },
];

export function WallDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        {PAPERS.map((p, i) => (
          <pattern key={i} id={`wallpaper-${i}`} width="50" height="60" patternUnits="userSpaceOnUse">
            <rect width="50" height="60" fill={p.ground} />
            <rect x="23" width="4" height="60" fill={p.stripe} />
            {i === 0 && <path d="M12 12 L18 22 L12 32 L6 22 Z M38 40 L44 50 L38 60 L32 50 Z M38 -20 L44 -10 L38 0 L32 -10 Z" fill={p.motif} opacity=".5" />}
            {i === 1 && (
              <g fill={p.motif} opacity=".5">
                <circle cx="12" cy="18" r="5" />
                <circle cx="38" cy="44" r="2.5" />
              </g>
            )}
            {i === 2 && <path d="M12 8 C20 16 20 24 12 30 C4 24 4 16 12 8 Z M38 36 v16" stroke={p.motif} fill="none" strokeWidth="1.6" opacity=".6" />}
          </pattern>
        ))}
        <radialGradient id="sconce-glow">
          <stop offset="0%" stopColor="#F6D9A0" stopOpacity=".95" />
          <stop offset="100%" stopColor="#F6D9A0" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function Wall({ slot }: { slot: Slot }) {
  return (
    <svg viewBox="0 0 300 540" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <rect width="300" height="300" fill={`url(#wallpaper-${slot.wallpaper})`} />
      {/* picture rail */}
      <rect y="40" width="300" height="5" fill="var(--sand)" />
      {/* chair rail + wainscoting */}
      <rect y="296" width="300" height="12" fill="var(--wine)" opacity=".85" />
      <rect y="308" width="300" height="160" fill="#DDC9A6" />
      <rect x="18" y="326" width="70" height="124" fill="none" stroke="var(--sand)" strokeWidth="3" />
      <rect x="212" y="326" width="70" height="124" fill="none" stroke="var(--sand)" strokeWidth="3" />
      <rect y="460" width="300" height="10" fill="var(--sand)" />
      {/* floorboards */}
      <rect y="470" width="300" height="70" fill="#8A5A3B" />
      {[490, 512].map((y) => (
        <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="#6E4630" strokeWidth="1.5" />
      ))}
      {/* the runner */}
      <rect y="492" width="300" height="34" fill="var(--oxblood)" />
      <rect y="495" width="300" height="3" fill="var(--brass)" opacity=".8" />
      <rect y="520" width="300" height="3" fill="var(--brass)" opacity=".8" />
      <path d={Array.from({ length: 10 }, (_, k) => `M${k * 30 + 8} 509 l7 -6 l7 6 l-7 6 z`).join(" ")} fill="var(--wine)" />
      {/* sconce at the bay's edge, shared with the next bay */}
      <g transform="translate(0 150)">
        {slot.sconceLit && <circle cx="0" cy="0" r="46" fill="url(#sconce-glow)" className="sconce-glow" />}
        <rect x="-3" y="4" width="6" height="26" fill="var(--brass)" />
        <path d="M-14 4 h28 l-6 -18 h-16 z" fill={slot.sconceLit ? "#F6E3B8" : "#BCA88A"} stroke="var(--brass)" strokeWidth="2" />
      </g>
    </svg>
  );
}
