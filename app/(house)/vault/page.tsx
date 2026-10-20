import type { Metadata } from "next";
import { RoomHeader } from "@/components/house/RoomHeader";
import { PaperWallet } from "@/components/sim/PaperWallet";
import { SimBanner } from "@/components/sim/SimBanner";
import { VaultRoom } from "@/components/vault/VaultRoom";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Vault" };

const room = ROOMS.find((r) => r.href === "/vault")!;

export default function VaultPage() {
  return (
    <>
      <SimBanner />
      <RoomHeader room={room}>
        <PaperWallet />
      </RoomHeader>
      <VaultRoom />
    </>
  );
}
