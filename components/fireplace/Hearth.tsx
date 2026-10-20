/**
 * The hearth. Flames flicker continuously, flare when `flare` is set (a new burn), and go to embers when `lit` is false.
 * Pure SVG + CSS; prefers-reduced-motion freezes the flicker (see globals.css).
 */
export function Hearth({ lit, flare }: { lit: boolean; flare: boolean }) {
  return (
    <svg viewBox="0 0 600 520" className="h-auto w-full" role="img" aria-label={lit ? "A fire burning in the hearth" : "A cold hearth"}>
      <defs>
        <radialGradient id="hearth-glow" cx="50%" cy="78%" r="55%">
          <stop offset="0%" stopColor="#F6D9A0" stopOpacity=".9" />
          <stop offset="45%" stopColor="var(--brass)" stopOpacity=".45" />
          <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="firebox">
          <path d="M140 480 V250 Q140 160 300 160 Q460 160 460 250 V480 Z" />
        </clipPath>
      </defs>

      {/* surround */}
      <rect x="20" y="70" width="560" height="420" fill="var(--parchment)" stroke="var(--sand)" strokeWidth="2" />
      <rect x="44" y="104" width="64" height="372" fill="none" stroke="var(--sand)" strokeWidth="2" />
      <rect x="492" y="104" width="64" height="372" fill="none" stroke="var(--sand)" strokeWidth="2" />
      {/* mantel shelf */}
      <rect x="0" y="40" width="600" height="34" fill="var(--wine)" />
      <rect x="0" y="74" width="600" height="6" fill="var(--brass)" />
      <rect x="10" y="80" width="580" height="10" fill="var(--wine)" opacity=".35" />

      {/* firebox */}
      <path d="M126 486 V248 Q126 146 300 146 Q474 146 474 248 V486 Z" fill="var(--sand)" />
      <path d="M140 480 V250 Q140 160 300 160 Q460 160 460 250 V480 Z" fill="var(--ink)" />
      <g clipPath="url(#firebox)">
        {/* soot-dark brick courses */}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1="140" x2="460" y1={200 + i * 32} y2={200 + i * 32} stroke="var(--wine)" strokeOpacity=".35" />
        ))}
        <rect x="140" y="160" width="320" height="320" fill="url(#hearth-glow)" className={`hearth-glow ${lit ? "" : "opacity-10"}`} />

        {/* flames, back to front */}
        <g className={`hearth-flames ${flare ? "is-flaring" : ""} ${lit ? "" : "is-out"}`}>
          <path className="flame flame-a" d="M300 430 C230 420 220 340 262 290 C270 330 290 330 284 290 C280 250 300 220 318 196 C318 250 352 262 350 300 C372 288 372 262 366 248 C410 300 400 420 300 430 Z" fill="var(--short)" />
          <path className="flame flame-b" d="M300 430 C252 424 246 360 276 322 C282 350 296 350 294 322 C292 292 306 268 318 252 C320 290 344 300 340 330 C356 322 356 304 352 294 C382 334 372 424 300 430 Z" fill="var(--brass)" />
          <path className="flame flame-c" d="M300 430 C270 426 268 386 286 362 C292 380 302 378 300 360 C300 340 310 326 316 316 C318 342 334 350 330 372 C344 384 336 428 300 430 Z" fill="#F6D9A0" />
        </g>

        {/* embers */}
        <g className={`hearth-embers ${lit ? "" : "is-out"}`} fill="#F6D9A0">
          <circle className="ember ember-1" cx="270" cy="400" r="2.5" />
          <circle className="ember ember-2" cx="320" cy="390" r="2" />
          <circle className="ember ember-3" cx="340" cy="405" r="1.8" />
          <circle className="ember ember-4" cx="290" cy="395" r="1.6" />
        </g>

        {/* logs and grate */}
        <g>
          <rect x="196" y="420" width="210" height="30" rx="15" fill="#3A2219" transform="rotate(-6 300 435)" />
          <rect x="200" y="424" width="200" height="28" rx="14" fill="#2C1912" transform="rotate(7 300 438)" />
          <circle cx="206" cy="432" r="11" fill="#5A3A2A" />
          <circle cx="394" cy="444" r="10" fill="#5A3A2A" />
        </g>
        <g stroke="var(--brass)" strokeWidth="5" strokeLinecap="round">
          <line x1="180" x2="420" y1="462" y2="462" />
          {[200, 240, 280, 320, 360, 400].map((x) => (
            <line key={x} x1={x} x2={x} y1="450" y2="474" />
          ))}
        </g>
      </g>

      {/* hearth stone */}
      <rect x="40" y="486" width="520" height="30" fill="var(--sand)" />
      <rect x="40" y="486" width="520" height="5" fill="var(--wine)" opacity=".18" />
    </svg>
  );
}
