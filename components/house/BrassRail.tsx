"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ROOMS } from "@/lib/rooms";

function Finial({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={`absolute -bottom-[5px] h-3 w-3 rounded-full border border-wine/30 bg-brass ${
        side === "left" ? "left-2" : "right-2"
      }`}
      style={{ boxShadow: "inset -2px -2px 0 rgba(78,10,15,.25), inset 1px 1px 0 rgba(242,232,213,.6)" }}
    />
  );
}

export function BrassRail() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 bg-beige/95 backdrop-blur-[2px]">
      <div className="relative border-b-2 border-brass">
        <Finial side="left" />
        <Finial side="right" />
        <nav
          aria-label="Rooms"
          className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6"
        >
          <Link href="/" className="display text-xl text-oxblood sm:text-2xl" aria-label="Stoxhomes, the foyer">
            STOXHOMES
          </Link>

          <ul className="hidden items-center gap-6 xl:flex">
            {ROOMS.map((room) => {
              const active = pathname.startsWith(room.href);
              return (
                <li key={room.href}>
                  <Link
                    href={room.href}
                    aria-current={active ? "page" : undefined}
                    className={`editorial relative text-[15px] transition-colors ${
                      active ? "text-oxblood" : "text-ink/70 hover:text-oxblood"
                    }`}
                  >
                    {room.name}
                    {active && (
                      <span aria-hidden className="absolute -bottom-[19px] left-0 right-0 h-[3px] bg-oxblood" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="editorial flex items-center gap-2 text-oxblood xl:hidden"
            aria-expanded={open}
            aria-controls="room-drawer"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Rooms"}
            <span aria-hidden className="numeric text-xs text-brass">
              {open ? "×" : ROOMS[ROOMS.length - 1].numeral}
            </span>
          </button>
        </nav>
      </div>

      {open && (
        <div id="room-drawer" className="border-b border-sand bg-beige xl:hidden">
          <ul className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
            {ROOMS.map((room) => {
              const active = pathname.startsWith(room.href);
              return (
                <li key={room.href} className="border-b border-sand/60 last:border-0">
                  <Link
                    href={room.href}
                    aria-current={active ? "page" : undefined}
                    className="flex items-baseline gap-4 py-3"
                  >
                    <span className="numeric w-8 text-xs text-brass">{room.numeral}</span>
                    <span className={`editorial text-xl ${active ? "text-oxblood" : "text-ink"}`}>{room.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </header>
  );
}
