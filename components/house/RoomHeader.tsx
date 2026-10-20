import type { Room } from "@/lib/rooms";

export function RoomHeader({ room, children }: { room: Room; children?: React.ReactNode }) {
  return (
    <div className="border-b border-sand pb-8 pt-10 sm:pt-14">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">
        Room <span className="numeric">{room.numeral}</span>
      </p>
      <h1 className="editorial mt-3 text-5xl leading-none text-oxblood sm:text-6xl">{room.name}</h1>
      <p className="mt-4 max-w-xl text-base text-ink/75 sm:text-lg">{room.blurb}</p>
      {children}
    </div>
  );
}
