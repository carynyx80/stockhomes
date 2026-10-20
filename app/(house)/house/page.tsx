import type { Metadata } from "next";
import { Corridor } from "@/components/corridor/Corridor";
import { AgentBanner } from "@/components/house/AgentBanner";
import { RoomHeader } from "@/components/house/RoomHeader";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Corridor" };

const room = ROOMS.find((r) => r.href === "/house")!;

export default function CorridorPage() {
  return (
    <>
      <AgentBanner />
      <RoomHeader room={room} />
      <Corridor />
    </>
  );
}
