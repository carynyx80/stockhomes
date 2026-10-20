import type { Metadata } from "next";
import { RoomHeader } from "@/components/house/RoomHeader";
import { RiskDisclosure } from "@/components/house/RiskDisclosure";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Library" };

const room = ROOMS.find((r) => r.href === "/docs")!;

export default function LibraryPage() {
  return (
    <>
      <RoomHeader room={room} />
      <div className="grid gap-10 pt-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Library sections" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="editorial flex flex-wrap gap-x-5 gap-y-2 text-lg text-wine lg:flex-col">
            <li><a href="#how-it-works" className="hover:text-oxblood">How it works</a></li>
            <li><a href="#fees" className="hover:text-oxblood">Fees</a></li>
            <li><a href="#risks" className="hover:text-oxblood">Risks</a></li>
            <li><a href="#contracts" className="hover:text-oxblood">Contracts</a></li>
          </ul>
        </nav>
        <div className="flex max-w-2xl flex-col gap-12">
          <section id="how-it-works" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">How it works</h2>
            <p className="mt-3 leading-relaxed text-ink/80">
              Each city is a perpetual market tracking an index of home prices. Go long if you think prices will
              rise, short if you think they will fall. Positions are margined and settled in USDG, and the House
              liquidity pool in the Vault takes the other side.
            </p>
          </section>
          <section id="fees" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">Fees</h2>
            <p className="mt-3 leading-relaxed text-ink/80">The fee schedule is published here before trading opens.</p>
          </section>
          <section id="risks" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">Risks</h2>
            <RiskDisclosure />
          </section>
          <section id="contracts" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">Contracts</h2>
            <p className="mt-3 leading-relaxed text-ink/80">
              Contract addresses are listed here only after they have been verified on the Robinhood Chain explorer.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
