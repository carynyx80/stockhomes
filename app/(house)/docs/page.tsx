import type { Metadata } from "next";
import { RoomHeader } from "@/components/house/RoomHeader";
import { RiskDisclosure } from "@/components/house/RiskDisclosure";
import { BOT, CONTRACTS, TOKEN } from "@/config/stoxhomes";
import { tokenAddress } from "@/lib/env";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Library" };

const room = ROOMS.find((r) => r.href === "/docs")!;

const EXPLORER = "https://robinhoodchain.blockscout.com";
const M = CONTRACTS.mainnet!;
const CONTRACT_ROWS: [string, string | null][] = [
  [`${TOKEN.ticker} token`, tokenAddress()],
  ["Burn address", BOT.deadAddress],
  ["Pons V2 launch factory", M.ponsFactory],
  ["Pons V2 fee hook", M.ponsMemeHook],
  ["Pons V2 fee escrow", M.ponsFeeEscrow],
  ["Uniswap Universal Router 2.1.2", M.uniswapUniversalRouter],
  ["Uniswap V4 Quoter", M.uniswapV4Quoter],
  ["Chainlink ETH / USD", M.chainlinkEthUsd],
];

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
            <p className="mt-3 leading-relaxed text-ink/80">The trading fee schedule is published here before trading opens.</p>
            <h3 className="editorial mt-6 text-xl text-wine">Buyback and burn</h3>
            <p className="mt-2 leading-relaxed text-ink/80">
              {TOKEN.ticker} earns creator fees on its Pons pool. An automated keeper checks every{" "}
              <span className="numeric">{BOT.cronIntervalMinutes}</span> minutes. Once claimable fees are worth at least{" "}
              <span className="numeric">${BOT.claimThresholdUsd}</span>, it claims them, spends{" "}
              <span className="numeric">{BOT.burnShareBps / 100}%</span> of exactly what it received buying {TOKEN.ticker}{" "}
              on the token&rsquo;s Uniswap pool, and sends every token bought to the dead address. Every burn is listed,
              with its transaction, in the Fireplace.
            </p>
          </section>
          <section id="risks" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">Risks</h2>
            <RiskDisclosure />
          </section>
          <section id="contracts" className="scroll-mt-24">
            <h2 className="editorial text-3xl text-oxblood">Contracts</h2>
            <p className="mt-3 leading-relaxed text-ink/80">
              Robinhood Chain mainnet (chain ID <span className="numeric">4663</span>). Each address was checked against its
              verified source on the explorer before being listed here.
            </p>
            <dl className="mt-4 divide-y divide-sand/70 rounded border border-sand">
              {CONTRACT_ROWS.map(([label, address]) => (
                <div key={label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between">
                  <dt className="text-sm text-ink/70">{label}</dt>
                  <dd>
                    {address ? (
                      <a
                        href={`${EXPLORER}/address/${address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="numeric break-all text-xs text-wine underline-offset-4 hover:underline"
                      >
                        {address}
                      </a>
                    ) : (
                      <span className="text-xs text-ink/55">Published at launch</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
