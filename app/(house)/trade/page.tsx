import type { Metadata } from "next";
import { RoomHeader } from "@/components/house/RoomHeader";
import { PaperWallet } from "@/components/sim/PaperWallet";
import { SimBanner } from "@/components/sim/SimBanner";
import { TradingFloor } from "@/components/trade/TradingFloor";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Trading Floor" };

const room = ROOMS.find((r) => r.href === "/trade")!;

export default function TradingFloorPage() {
  return (
    <>
      <SimBanner />
      <RoomHeader room={room}>
        <PaperWallet />
      </RoomHeader>
      <TradingFloor />
    </>
  );
}
