/** The oxblood front door: four raised panels, a brass letterbox and knob. 200 × 400 viewBox. */

function Panel({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="var(--wine)" opacity=".32" />
      <rect x={x + 9} y={y + 9} width={w - 18} height={h - 18} fill="var(--oxblood)" />
      <rect x={x + 9} y={y + 9} width={w - 18} height={h - 18} fill="none" stroke="var(--wine)" strokeOpacity=".55" strokeWidth="2" />
      <path d={`M${x + 9} ${y + h - 9} V${y + 9} H${x + w - 9}`} fill="none" stroke="var(--beige)" strokeOpacity=".14" strokeWidth="2" />
    </g>
  );
}

export function DoorLeaf() {
  return (
    <svg viewBox="0 0 200 400" className="h-full w-full" preserveAspectRatio="none" aria-hidden focusable="false">
      <rect width="200" height="400" fill="var(--oxblood)" />
      <rect x="194" width="6" height="400" fill="var(--wine)" opacity=".55" />
      <rect width="200" height="5" fill="var(--beige)" opacity=".08" />
      <Panel x={24} y={26} w={68} h={156} />
      <Panel x={108} y={26} w={68} h={156} />
      <Panel x={24} y={226} w={68} h={150} />
      <Panel x={108} y={226} w={68} h={150} />
      {/* letterbox */}
      <rect x="68" y="196" width="64" height="14" rx="2" fill="var(--brass)" />
      <rect x="74" y="201" width="52" height="4" rx="1" fill="var(--wine)" />
      {/* knob */}
      <g data-knob style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx="176" cy="204" r="12" fill="var(--brass)" />
        <circle cx="176" cy="204" r="12" fill="none" stroke="var(--wine)" strokeOpacity=".35" strokeWidth="2" />
        <circle cx="176" cy="204" r="5" fill="var(--wine)" opacity=".2" />
        <circle cx="172" cy="200" r="3.5" fill="var(--beige)" className="knob-shine" />
      </g>
    </svg>
  );
}
