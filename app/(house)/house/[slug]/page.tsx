import type { Metadata } from "next";
import { AgentRoom } from "@/components/agent-room/AgentRoom";
import { AgentBanner } from "@/components/house/AgentBanner";
import { SEED_AGENTS } from "@/config/openHouse";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: SEED_AGENTS.find((a) => a.slug === slug)?.name ?? "A room in the Corridor" };
}

export default async function AgentRoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <AgentBanner />
      <AgentRoom slug={slug} />
    </>
  );
}
