import type { Metadata } from "next";
import Link from "next/link";
import { RoomHeader } from "@/components/house/RoomHeader";
import { SOCIALS } from "@/config/stoxhomes";
import { ROOMS } from "@/lib/rooms";

export const metadata: Metadata = { title: "The Gallery · Leaderboard" };

const room = ROOMS.find((r) => r.href === "/leaderboard")!;

const BOARDS = [
  { title: "Top profit", note: "Biggest realised PnL" },
  { title: "Best return", note: "Highest return on margin" },
  { title: "Most volume", note: "Largest size traded" },
];

/** An empty gilt frame: the portraits arrive with the leaderboard. */
function Frame({ rank }: { rank: number }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative aspect-[3/4] w-full rounded-sm border-[6px] border-brass bg-parchment/70 p-2 shadow-[inset_0_0_0_2px_var(--wine),0_6px_14px_rgba(78,10,15,.12)]">
        <div className="flex h-full w-full items-center justify-center border border-brass/50 bg-beige/70">
          <svg viewBox="0 0 60 70" className="h-1/2 w-1/2 text-sand" aria-hidden>
            <circle cx="30" cy="24" r="13" fill="currentColor" />
            <path d="M6 70c2-16 12-24 24-24s22 8 24 24z" fill="currentColor" />
          </svg>
        </div>
      </div>
      <div className="numeric rounded-sm bg-brass px-3 py-0.5 text-xs text-wine">No. {rank}</div>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <>
      <RoomHeader room={room} />

      <section className="mt-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">The leaderboard</p>
        <h2 className="display mt-3 text-[clamp(2.75rem,8vw,5.5rem)] leading-none text-oxblood">Coming soon</h2>
        <p className="mx-auto mt-5 max-w-xl text-ink/75">
          The frames are hung and waiting. Soon the Gallery will rank every trader on the Trading Floor, and the best get
          their portrait on the wall.
        </p>
      </section>

      <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-4 sm:gap-8">
        {[2, 1, 3].map((rank) => (
          <div key={rank} className={rank === 1 ? "-mt-2 sm:-mt-6" : "mt-4"}>
            <Frame rank={rank} />
          </div>
        ))}
      </div>

      <ul className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-3">
        {BOARDS.map((b) => (
          <li key={b.title} className="panel p-4 text-center">
            <p className="editorial text-xl text-oxblood">{b.title}</p>
            <p className="mt-1 text-sm text-ink/65">{b.note}</p>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
        <Link href="/trade" className="btn-oxblood">
          Start trading on testnet
        </Link>
        <a href={SOCIALS.x.url} target="_blank" rel="noopener noreferrer" className="editorial text-wine underline-offset-4 hover:text-oxblood hover:underline">
          Follow {SOCIALS.x.handle} for the launch
        </a>
      </div>
    </>
  );
}
