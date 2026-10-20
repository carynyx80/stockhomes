import { hashString, uniform } from "@/lib/sim/prng";

/**
 * A simple deterministic portrait from the agent's visual seed, in a gilded frame. Idles gently and moves its
 * mouth while "speaking". (Phase B replaces this with fully generated characters.)
 */
const SKIN = ["#E8C3A0", "#C99671", "#8D5A3B", "#5E3A26", "#F0D2B6"];
const COAT = ["var(--oxblood)", "var(--wine)", "#2F4A5D", "var(--long)", "#5A3A6B", "#7A5A2B"];
const HAIR = ["#1E1412", "#5A3A26", "#B08A4A", "#8A8A8A", "#3A2219"];

export function Portrait({ seed, name, speaking }: { seed: string; name: string; speaking: boolean }) {
  const h = hashString(seed);
  const pick = <T,>(arr: T[], lane: number) => arr[Math.floor(uniform(h, lane, lane) * arr.length)];
  const skin = pick(SKIN, 1);
  const coat = pick(COAT, 2);
  const hair = pick(HAIR, 3);
  const hat = uniform(h, 4, 4) > 0.55;
  const specs = uniform(h, 5, 5) > 0.6;
  return (
    <figure className={`mx-auto w-full max-w-[260px] ${speaking ? "is-speaking" : ""}`}>
      <div className="rounded-sm border-[10px] border-brass p-1.5 shadow-[inset_0_0_0_2px_rgba(78,10,15,.35),0_4px_0_rgba(78,10,15,.18)]">
        <svg viewBox="0 0 200 240" className="block w-full bg-parchment" role="img" aria-label={`Portrait of ${name}`}>
          <rect width="200" height="240" fill="#E3CFA9" />
          <circle cx="100" cy="95" r="85" fill="#EFE0C2" />
          <g className="portrait-idle">
            <path d="M30 240 C35 170 165 170 170 240 Z" fill={coat} />
            <path d="M88 178 L100 200 L112 178 Z" fill="var(--beige)" />
            <rect x="88" y="138" width="24" height="34" rx="8" fill={skin} />
            <ellipse cx="100" cy="112" rx="42" ry="50" fill={skin} />
            <path d="M58 104 C60 62 140 62 142 104 C130 84 70 84 58 104 Z" fill={hair} />
            {hat && (
              <g fill="var(--ink)">
                <rect x="56" y="62" width="88" height="10" rx="3" />
                <rect x="72" y="22" width="56" height="44" rx="4" />
                <rect x="72" y="52" width="56" height="6" fill="var(--brass)" />
              </g>
            )}
            <circle cx="84" cy="110" r="4" fill="var(--ink)" />
            <circle cx="116" cy="110" r="4" fill="var(--ink)" />
            {specs && (
              <g fill="none" stroke="var(--brass)" strokeWidth="3">
                <circle cx="84" cy="110" r="11" />
                <circle cx="116" cy="110" r="11" />
                <path d="M95 110 h10" />
              </g>
            )}
            <ellipse className="portrait-mouth" cx="100" cy="138" rx="10" ry="4" fill="var(--wine)" />
          </g>
        </svg>
      </div>
      <figcaption className="editorial mt-2 text-center text-lg text-oxblood">{name}</figcaption>
    </figure>
  );
}
