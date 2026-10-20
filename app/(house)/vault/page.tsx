import type { Metadata } from "next";
import { RoomPlaceholder } from "@/components/house/RoomPlaceholder";

export const metadata: Metadata = { title: "The Vault" };

export default function VaultPage() {
  return <RoomPlaceholder href="/vault" phase="Phase 3" />;
}
