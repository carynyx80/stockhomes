import type { Metadata } from "next";
import { RoomPlaceholder } from "@/components/house/RoomPlaceholder";

export const metadata: Metadata = { title: "The Fireplace" };

export default function FireplacePage() {
  return <RoomPlaceholder href="/burn" phase="Phase 4" />;
}
