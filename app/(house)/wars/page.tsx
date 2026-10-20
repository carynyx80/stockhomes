import type { Metadata } from "next";
import { RoomPlaceholder } from "@/components/house/RoomPlaceholder";

export const metadata: Metadata = { title: "The Parlour" };

export default function ParlourPage() {
  return <RoomPlaceholder href="/wars" phase="Phase 3" />;
}
