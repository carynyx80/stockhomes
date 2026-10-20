import { RoomHeader } from "./RoomHeader";
import { ROOMS } from "@/lib/rooms";

/** Temporary body for rooms that get furnished in a later phase. */
export function RoomPlaceholder({ href, phase }: { href: string; phase: string }) {
  const room = ROOMS.find((r) => r.href === href)!;
  return (
    <>
      <RoomHeader room={room} />
      <div className="panel mt-10 flex flex-col gap-2 p-6 sm:p-8">
        <p className="editorial text-2xl text-wine">Dust sheets still on the furniture.</p>
        <p className="text-ink/70">This room is furnished in {phase}.</p>
      </div>
    </>
  );
}
