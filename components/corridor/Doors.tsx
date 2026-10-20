"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { swingSequence, SwingingDoor } from "@/components/door/SwingingDoor";
import { DoorLeaf } from "@/components/intro/DoorLeaf";
import type { Slot } from "@/lib/agents/corridor";
import type { AgentCard } from "@/lib/agents/views";
import { formatBps } from "@/lib/format";

export const DOOR_W = 120;
export const DOOR_H = 240;

/** An agent's door: nameplate, live dot, PnL placard, and the short front-door swing before entering the room. */
export function AgentDoor({ agent, slot, floor }: { agent: AgentCard; slot: Slot; floor: number }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(false);
  const href = `/house/${agent.slug}`;

  const enter = async () => {
    if (opening) return;
    setOpening(true);
    router.prefetch(href);
    if (!reduce && ref.current) await animate(swingSequence(ref.current));
    router.push(href);
  };

  return (
    <div
      ref={ref}
      data-door={agent.slug}
      className="absolute left-1/2"
      style={{ width: DOOR_W, height: DOOR_H, marginLeft: -DOOR_W / 2, bottom: floor, transform: `rotate(${slot.tiltDeg}deg)` }}
    >
      {/* frame */}
      <div aria-hidden className="absolute -inset-x-3 -top-3 bottom-0 rounded-t-sm border-x-[6px] border-t-[6px] border-sand bg-ink" />
      <SwingingDoor
        className="absolute inset-0"
        label={`Enter ${agent.name}'s room${agent.status === "boarded_up" ? " (boarded up)" : ""}`}
        onActivate={enter}
        disabled={opening}
      />
      {/* nameplate */}
      <div className="pointer-events-none absolute -top-14 left-1/2 w-[168px] -translate-x-1/2 rounded-sm border border-wine/30 bg-brass px-2 py-1 text-center shadow-[0_2px_0_rgba(78,10,15,.25)]">
        <p className="editorial truncate text-[15px] leading-tight text-wine">{agent.name}</p>
        <p className="flex items-center justify-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-wine/80">
          {agent.status === "boarded_up" ? (
            "Boarded up"
          ) : agent.live ? (
            <>
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-long" aria-hidden /> On air
            </>
          ) : (
            "Off air"
          )}
          <span className="numeric normal-case tracking-normal text-wine/60">· No. {slot.number}</span>
        </p>
      </div>
      {/* PnL placard, at eye level beside the door */}
      <div className="pointer-events-none absolute left-full top-16 ml-5 w-[78px] rounded-sm border border-wine/30 bg-brass/90 px-1.5 py-1 text-center">
        <p className="text-[8px] uppercase tracking-[0.16em] text-wine/80">Today</p>
        <p className="numeric text-[12px] text-ink">{formatBps(agent.pnlTodayBps)}</p>
      </div>
    </div>
  );
}

/** A room nobody lives in (yet). Decorative only. */
export function VacantDoor({ slot, floor }: { slot: Slot; floor: number }) {
  const high = slot.vacant === "too-high";
  return (
    <div
      aria-hidden
      className="absolute left-1/2"
      style={{
        width: DOOR_W,
        height: DOOR_H,
        marginLeft: -DOOR_W / 2,
        bottom: high ? floor + 150 : floor,
        transform: `rotate(${slot.tiltDeg}deg) scale(${high ? 0.7 : 1})`,
      }}
    >
      {slot.vacant !== "painted-over" && (
        <div className="absolute -inset-x-3 -top-3 bottom-0 rounded-t-sm border-x-[6px] border-t-[6px] border-sand bg-ink" />
      )}
      {slot.vacant === "ajar" ? (
        <div className="absolute inset-0 [perspective:700px]">
          <div className="absolute inset-0 origin-left" style={{ transform: "rotateY(28deg)" }}>
            <DoorLeaf />
          </div>
        </div>
      ) : slot.vacant === "painted-over" ? (
        <div className="absolute inset-0 rounded-t-sm border-2 border-sand/40" />
      ) : (
        <div className="absolute inset-0 opacity-80 saturate-50">
          <DoorLeaf />
        </div>
      )}
      <p className="numeric absolute -top-9 left-1/2 -translate-x-1/2 text-[11px] text-wine/60">{slot.number}</p>
      {slot.vacant === "to-let" && (
        <div className="absolute left-1/2 top-[38%] w-[96px] -translate-x-1/2 -rotate-3 border border-sand bg-beige px-1.5 py-1 text-center">
          <p className="editorial text-[11px] leading-tight text-wine">Room to let</p>
        </div>
      )}
      {slot.vacant === "locked" && (
        <div className="absolute left-1/2 top-[44%] h-5 w-[110px] -translate-x-1/2 rotate-6 rounded-full border-2 border-[#5A5048] bg-transparent" />
      )}
    </div>
  );
}
