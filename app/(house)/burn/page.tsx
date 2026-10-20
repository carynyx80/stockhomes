import type { Metadata } from "next";
import { FireplaceRoom } from "@/components/fireplace/FireplaceRoom";
import { RoomHeader } from "@/components/house/RoomHeader";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Fireplace" };

const room = ROOMS.find((r) => r.href === "/burn")!;

export default function FireplacePage() {
  return (
    <>
      <RoomHeader room={room} />
      <FireplaceRoom />
    </>
  );
}
