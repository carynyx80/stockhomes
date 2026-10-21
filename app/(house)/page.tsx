import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ContractAddress } from "@/components/token/ContractAddress";
import { BRAND, SETTLEMENT, TRADING } from "@/config/stoxhomes";
import { ROOMS } from "@/lib/rooms";

export default function Foyer() {
  return (
    <>
      <section className="grid gap-8 border-b border-sand pb-14 pt-14 sm:pt-20 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">The Foyer</p>
          <h1 className="display mt-4 text-[clamp(3.25rem,11vw,8.5rem)] text-oxblood">
            Every city
            <br />
            has a price.
          </h1>
        </div>
        <div className="max-w-md lg:pb-3">
          <Logo className="mb-6 w-64 sm:w-80" priority />
          <p className="editorial text-2xl leading-snug text-wine sm:text-3xl">{BRAND.tagline}</p>
          <p className="mt-4 text-ink/75">
            Perpetuals on home prices in New York, Miami, London, Dubai and more. Up to{" "}
            <span className="numeric">{TRADING.maxLeverage}x</span>, settled in{" "}
            <span className="numeric">{SETTLEMENT.symbol}</span>.
          </p>
          <Link href="/trade" className="btn-oxblood mt-6 inline-block">
            Step onto the Trading Floor
          </Link>
          <div className="mt-5">
            <ContractAddress full />
          </div>
        </div>
      </section>

      <section aria-labelledby="rooms-heading" className="pt-12">
        <h2 id="rooms-heading" className="editorial text-3xl text-oxblood">
          The rooms
        </h2>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ROOMS.map((room) => (
            <li key={room.href}>
              <Link
                href={room.href}
                className="group panel relative flex h-full flex-col rounded-t-[999px] px-6 pb-6 pt-14 transition-colors hover:border-brass"
              >
                <span
                  aria-hidden
                  className="numeric absolute left-1/2 top-5 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-brass text-[11px] text-brass"
                >
                  {room.numeral}
                </span>
                <span className="editorial mt-4 text-center text-2xl text-oxblood group-hover:text-wine">
                  {room.name}
                </span>
                <span className="mt-3 text-center text-sm leading-relaxed text-ink/70">{room.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
