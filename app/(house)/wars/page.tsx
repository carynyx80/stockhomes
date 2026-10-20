import type { Metadata } from "next";
import { RoomHeader } from "@/components/house/RoomHeader";
import { PaperWallet } from "@/components/sim/PaperWallet";
import { SimBanner } from "@/components/sim/SimBanner";
import { Parlour } from "@/components/wars/Parlour";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Parlour" };

const room = ROOMS.find((r) => r.href === "/wars")!;

export default function ParlourPage() {
  return (
    <>
      <SimBanner />
      <RoomHeader room={room}>
        <PaperWallet />
      </RoomHeader>
      <Parlour />
    </>
  );
}
