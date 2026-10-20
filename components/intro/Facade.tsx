/**
 * The townhouse front, drawn in a 1000 × 1300 viewBox. The door itself is not here: it is an HTML
 * button laid over the opening (see DOOR in geometry.ts) so it can swing with a real 3D transform.
 */

const PLASTER = "#E9DCC0";
const SHADE = "#D9C6A2";

function GroundWindow({ x }: { x: number }) {
  const y = 780;
  const w = 170;
  const h = 300;
  return (
    <g>
      {/* lintel with keystone */}
      <rect x={x - 14} y={y - 34} width={w + 28} height={22} fill="var(--sand)" />
      <path d={`M${x + w / 2 - 16} ${y - 40} h32 l-6 30 h-20 z`} fill={SHADE} stroke="var(--brass)" strokeOpacity=".35" />
      {/* frame */}
      <rect x={x - 8} y={y - 8} width={w + 16} height={h + 16} fill="var(--sand)" />
      {/* warm room behind the glass */}
      <rect x={x} y={y} width={w} height={h} fill="var(--wine)" />
      <rect x={x} y={y} width={w} height={h} fill="url(#roomlight)" className="window-flicker" style={{ animationDelay: x > 500 ? "-1.7s" : "0s" }} />
      {/* half-drawn curtains */}
      <path d={`M${x} ${y} h46 q-10 150 8 ${h} h-54 z`} fill="var(--oxblood)" opacity=".85" />
      <path d={`M${x + w} ${y} h-46 q10 150 -8 ${h} h54 z`} fill="var(--oxblood)" opacity=".85" />
      {/* glazing bars: 2 × 3 panes */}
      <g stroke="var(--parchment)" strokeWidth="6">
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
        <line x1={x} y1={y + h / 3} x2={x + w} y2={y + h / 3} />
        <line x1={x} y1={(y + (2 * h) / 3)} x2={x + w} y2={y + (2 * h) / 3} />
      </g>
      {/* sill */}
      <rect x={x - 18} y={y + h + 8} width={w + 36} height={16} fill={SHADE} />
      <rect x={x - 18} y={y + h + 24} width={w + 36} height={4} fill="var(--wine)" opacity=".18" />
    </g>
  );
}

function UpperWindow({ x }: { x: number }) {
  const y = 270;
  const w = 180;
  const h = 290;
  return (
    <g>
      <rect x={x - 14} y={y - 30} width={w + 28} height={20} fill="var(--sand)" />
      <rect x={x - 8} y={y - 8} width={w + 16} height={h + 16} fill="var(--sand)" />
      <rect x={x} y={y} width={w} height={h} fill="var(--wine)" opacity=".92" />
      {/* a faint reflection */}
      <path d={`M${x + 20} ${y + h} L${x + w - 30} ${y} h22 L${x + 42} ${y + h} z`} fill="var(--beige)" opacity=".06" />
      <g stroke="var(--parchment)" strokeWidth="6">
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
        <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} />
      </g>
      {/* window box */}
      <rect x={x - 10} y={y + h + 8} width={w + 20} height={14} fill={SHADE} />
    </g>
  );
}

export function Facade() {
  return (
    <svg
      viewBox="0 0 1000 1300"
      className="absolute inset-0 h-full w-full"
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id="roomlight" cx="50%" cy="62%" r="70%">
          <stop offset="0%" stopColor="#F6D9A0" />
          <stop offset="45%" stopColor="var(--brass)" />
          <stop offset="100%" stopColor="var(--oxblood)" stopOpacity=".2" />
        </radialGradient>
        <radialGradient id="fanlight" cx="50%" cy="100%" r="90%">
          <stop offset="0%" stopColor="#F6D9A0" />
          <stop offset="100%" stopColor="var(--brass)" stopOpacity=".55" />
        </radialGradient>
        <pattern id="rustication" width="1000" height="44" patternUnits="userSpaceOnUse">
          <line x1="0" y1="43" x2="1000" y2="43" stroke={SHADE} strokeWidth="2" />
        </pattern>
      </defs>

      {/* parapet and cornice */}
      <rect x="60" y="70" width="880" height="60" fill={SHADE} />
      <rect x="40" y="130" width="920" height="22" fill="var(--sand)" />
      <rect x="40" y="152" width="920" height="6" fill="var(--wine)" opacity=".15" />
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={68 + i * 40} y={158} width={18} height={16} fill={SHADE} />
      ))}

      {/* walls */}
      <rect x="60" y="158" width="880" height="1032" fill={PLASTER} />
      <rect x="60" y="680" width="880" height="510" fill="url(#rustication)" />
      {/* side quoins */}
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i} fill={SHADE}>
          <rect x="60" y={180 + i * 84} width={i % 2 ? 30 : 46} height="40" />
          <rect x={i % 2 ? 910 : 894} y={180 + i * 84} width={i % 2 ? 30 : 46} height="40" />
        </g>
      ))}

      <UpperWindow x={150} />
      <UpperWindow x={670} />

      {/* string course between floors */}
      <rect x="60" y="610" width="880" height="18" fill="var(--sand)" />
      <rect x="60" y="628" width="880" height="4" fill="var(--wine)" opacity=".14" />

      <GroundWindow x={95} />
      <GroundWindow x={735} />

      {/* door surround: pilasters, entablature, fanlight */}
      <rect x="362" y="726" width="38" height="464" fill={SHADE} />
      <rect x="600" y="726" width="38" height="464" fill={SHADE} />
      <rect x="348" y="700" width="304" height="28" fill="var(--sand)" />
      <rect x="338" y="690" width="324" height="12" fill={SHADE} />
      <path d="M400 790 V745 A100 45 0 0 1 600 745 V790 Z" fill="var(--wine)" />
      <path d="M400 790 V745 A100 45 0 0 1 600 745 V790 Z" fill="url(#fanlight)" className="window-flicker" />
      <g stroke="var(--parchment)" strokeWidth="4" fill="none">
        <path d="M400 790 V745 A100 45 0 0 1 600 745 V790" strokeWidth="8" stroke="var(--sand)" />
        <line x1="500" y1="790" x2="500" y2="700" />
        <line x1="500" y1="790" x2="430" y2="712" />
        <line x1="500" y1="790" x2="570" y2="712" />
      </g>
      {/* brass house plate */}
      <rect x="402" y="646" width="196" height="40" rx="3" fill="var(--brass)" />
      <rect x="406" y="650" width="188" height="32" rx="2" fill="none" stroke="var(--wine)" strokeOpacity=".35" />
      <text
        x="500"
        y="675"
        textAnchor="middle"
        fontFamily="var(--font-gloock), Georgia, serif"
        fontSize="25"
        letterSpacing="1.5"
        fill="var(--wine)"
      >
        STOXHOMES
      </text>
      {/* the dark opening behind the door */}
      <rect x="400" y="790" width="200" height="400" fill="var(--ink)" />

      {/* sign bracket */}
      <line x1="652" y1="862" x2="726" y2="862" stroke="var(--wine)" strokeWidth="4" />
      <line x1="666" y1="862" x2="666" y2="878" stroke="var(--wine)" strokeWidth="2" />
      <line x1="712" y1="862" x2="712" y2="878" stroke="var(--wine)" strokeWidth="2" />

      {/* steps and pavement */}
      <rect x="352" y="1190" width="296" height="26" fill={SHADE} />
      <rect x="332" y="1216" width="336" height="26" fill="var(--sand)" />
      <rect x="312" y="1242" width="376" height="26" fill={SHADE} />
      <g fill="var(--wine)" opacity=".16">
        <rect x="352" y="1212" width="296" height="4" />
        <rect x="332" y="1238" width="336" height="4" />
        <rect x="312" y="1264" width="376" height="4" />
      </g>
      <rect x="0" y="1268" width="1000" height="32" fill="var(--sand)" />
      {/* boot scraper and railings */}
      <g stroke="var(--wine)" strokeWidth="5" opacity=".8">
        {[90, 130, 170, 210, 250, 290, 710, 750, 790, 830, 870, 910].map((x) => (
          <line key={x} x1={x} y1="1268" x2={x} y2="1190" />
        ))}
        <line x1="80" y1="1196" x2="300" y2="1196" />
        <line x1="700" y1="1196" x2="920" y2="1196" />
      </g>
      <g fill="var(--brass)">
        {[90, 130, 170, 210, 250, 290, 710, 750, 790, 830, 870, 910].map((x) => (
          <path key={x} d={`M${x - 6} 1192 L${x} 1176 L${x + 6} 1192 Z`} />
        ))}
      </g>
    </svg>
  );
}
