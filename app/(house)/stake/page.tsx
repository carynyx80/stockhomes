import type { Metadata } from "next";
import { RoomPlaceholder } from "@/components/house/RoomPlaceholder";

export const metadata: Metadata = { title: "The Study" };

export default function StudyPage() {
  return <RoomPlaceholder href="/stake" phase="a later phase" />;
}
