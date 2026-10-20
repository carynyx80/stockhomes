import type { Metadata } from "next";
import { RoomPlaceholder } from "@/components/house/RoomPlaceholder";

export const metadata: Metadata = { title: "The Trading Floor" };

export default function TradingFloorPage() {
  return <RoomPlaceholder href="/trade" phase="Phase 3" />;
}
